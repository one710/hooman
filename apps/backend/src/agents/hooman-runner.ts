/**
 * Hooman agent run via Vercel AI SDK (generateText + tools). No personas; MCP and skills attached to main flow.
 */
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { getHoomanModel } from "./model-provider.js";
import { generateText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { listSkillsFromFs } from "../capabilities/skills/skills-cli.js";
import { readSkillTool } from "../capabilities/skills/skills-tool.js";
import type { SkillEntry } from "../capabilities/skills/skills-cli.js";
import type {
  AuditLogEntry,
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types.js";
import { getConfig, getFullStaticAgentInstructionsAppend } from "../config.js";
import type { MCPConnectionsStore } from "../capabilities/mcp/connections-store.js";
import { createOAuthProvider } from "../capabilities/mcp/oauth-provider.js";
import { filterToolNames } from "../capabilities/mcp/tool-filter.js";
import { env } from "../env.js";
import createDebug from "debug";

const debug = createDebug("hooman:hooman-runner");
const DEBUG_TOOL_LOG_MAX = 500; // max chars for args/result in logs
const AUDIT_TOOL_PAYLOAD_MAX = 250; // max chars for tool args/result in audit log

function truncateForLog(value: unknown): string {
  const s =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value);
  if (s.length <= DEBUG_TOOL_LOG_MAX) return s;
  return `${s.slice(0, DEBUG_TOOL_LOG_MAX)}… (${s.length} chars total)`;
}

function truncateForAudit(value: unknown): string {
  const s =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value);
  if (s.length <= AUDIT_TOOL_PAYLOAD_MAX) return s;
  return `${s.slice(0, AUDIT_TOOL_PAYLOAD_MAX)}… (${s.length} chars total)`;
}

const DEFAULT_MCP_CWD = env.MCP_STDIO_DEFAULT_CWD;

export type AgentInputItem = {
  role: "user" | "assistant" | "system";
  content: string;
};

function buildSkillsMetadataSection(
  skillIds: string[],
  skillsById: Map<string, SkillEntry>,
): string {
  if (skillIds.length === 0) return "";
  const lines: string[] = [];
  for (const id of skillIds) {
    const skill = skillsById.get(id);
    if (!skill) continue;
    const desc = skill.description?.trim() || "No description.";
    lines.push(`- **${skill.name}**: ${desc}`);
  }
  if (lines.length === 0) return "";
  return `\n\nAvailable skills (use when relevant):\n${lines.join("\n")}`;
}

export interface RunChatOptions {
  channelContext?: string;
  apiKey?: string;
  model?: string;
  maxTurns?: number;
  sessionId?: string;
  attachments?: Array<{
    name: string;
    contentType: string;
    data: string;
  }>;
}

export interface RunChatResult {
  finalOutput: string;
  history: AgentInputItem[];
  newItems: Array<{
    type: string;
    agent?: { name: string };
    sourceAgent?: { name: string };
    targetAgent?: { name: string };
  }>;
}

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

function buildUserContentParts(
  text: string,
  attachments?: RunChatOptions["attachments"],
): Array<
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "file"; data: string; mediaType: string }
> {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string; mediaType?: string }
    | { type: "file"; data: string; mediaType: string }
  > = [{ type: "text", text }];
  if (attachments?.length) {
    for (const a of attachments) {
      const data = typeof a.data === "string" ? a.data.trim() : "";
      if (!data) continue;
      const contentType = a.contentType.toLowerCase().split(";")[0].trim();
      const dataUrl = `data:${contentType};base64,${data}`;
      if (
        IMAGE_MIME_TYPES.includes(
          contentType as (typeof IMAGE_MIME_TYPES)[number],
        )
      ) {
        parts.push({
          type: "image",
          image: dataUrl,
          mediaType: contentType,
        });
      } else {
        parts.push({
          type: "file",
          data: dataUrl,
          mediaType: contentType,
        });
      }
    }
  }
  return parts;
}

export interface DiscoveredTool {
  name: string;
  description?: string;
  connectionId: string;
  connectionName: string;
}

/** MCP clients to close after run. */
export interface HoomanRunnerSession {
  runChat(
    thread: AgentInputItem[],
    newUserMessage: string,
    options?: RunChatOptions,
  ): Promise<RunChatResult>;
  closeMcp: () => Promise<void>;
  discoveredTools: DiscoveredTool[];
}

export type AuditLogAppender = {
  appendAuditEntry(
    entry: Omit<AuditLogEntry, "id" | "timestamp">,
  ): Promise<void>;
};

export async function createHoomanRunner(options?: {
  connections?: MCPConnection[];
  mcpConnectionsStore?: MCPConnectionsStore;
  apiKey?: string;
  model?: string;
  auditLog?: AuditLogAppender;
  sessionId?: string;
}): Promise<HoomanRunnerSession> {
  const config = getConfig();
  const model = getHoomanModel(config, {
    apiKey: options?.apiKey ?? config.OPENAI_API_KEY,
    model: options?.model,
  });

  const allConnections: MCPConnection[] = options?.connections ?? [];

  const [allSkills, mcpClients] = await Promise.all([
    listSkillsFromFs(),
    (async () => {
      const clients: Array<{
        client: Awaited<ReturnType<typeof createMCPClient>>;
        id: string;
      }> = [];
      for (const c of allConnections) {
        try {
          if (c.type === "stdio") {
            const stdio = c as MCPConnectionStdio;
            const hasArgs = Array.isArray(stdio.args) && stdio.args.length > 0;
            debug(
              "Connecting to Stdio MCP: %s (command: %s, args: %j)",
              c.id,
              stdio.command,
              stdio.args,
            );
            const transport = new Experimental_StdioMCPTransport({
              command: stdio.command,
              args: hasArgs ? stdio.args : [],
              env: stdio.env,
              cwd: stdio.cwd?.trim() || DEFAULT_MCP_CWD,
            });
            const client = await createMCPClient({ transport });
            debug("Connected to %s", c.id);
            clients.push({ client, id: c.id });
          } else if (c.type === "streamable_http") {
            const http = c as MCPConnectionStreamableHttp;
            const hasOAuth =
              http.oauth?.redirect_uri && options?.mcpConnectionsStore;
            debug(
              "Connecting to HTTP MCP: %s (url: %s, headers: %j)",
              c.id,
              http.url,
              http.headers,
            );
            const client = await createMCPClient({
              transport: {
                type: "http",
                url: http.url,
                headers: http.headers,
                ...(hasOAuth && {
                  authProvider: createOAuthProvider(
                    c.id,
                    options.mcpConnectionsStore!,
                    http,
                  ),
                }),
              },
            });
            debug("Connected to %s", c.id);
            clients.push({ client, id: c.id });
          } else if (c.type === "hosted") {
            const hosted = c as MCPConnectionHosted;
            const hasOAuth =
              hosted.oauth?.redirect_uri && options?.mcpConnectionsStore;
            debug(
              "Connecting to Hosted MCP: %s (server_url: %s, headers: %j)",
              c.id,
              hosted.server_url,
              hosted.headers,
            );
            const client = await createMCPClient({
              transport: {
                type: "http",
                url: hosted.server_url,
                headers: hosted.headers,
                ...(hasOAuth && {
                  authProvider: createOAuthProvider(
                    c.id,
                    options.mcpConnectionsStore!,
                    hosted,
                  ),
                }),
              },
            });
            debug("Connected to %s", c.id);
            clients.push({ client, id: c.id });
          }
        } catch (err) {
          debug("MCP connection %s failed to connect: %o", c.id, err);
        }
      }
      return clients;
    })(),
  ]);

  const skillsById = new Map<string, SkillEntry>(
    allSkills.map((s) => [s.id, s]),
  );
  const allSkillIds = allSkills.map((s) => s.id);
  const skillsSection = buildSkillsMetadataSection(allSkillIds, skillsById);

  /** Some APIs (e.g. AWS Bedrock) limit tool names to 64 chars. Prefix with short connection id and truncate if needed. */
  const MAX_TOOL_NAME_LEN = 64;
  const SHORT_CONN_ID_LEN = 8;
  const mcpTools: Record<string, unknown> = {};
  const discoveredTools: DiscoveredTool[] = [];
  for (const { client, id } of mcpClients) {
    try {
      const toolSet = await client.tools();
      const toolNames = Object.keys(toolSet);
      const conn = allConnections.find((c) => c.id === id);
      const connName = (conn as { name?: string })?.name || conn?.id || id;
      const filtered = filterToolNames(toolNames, conn?.tool_filter);
      debug(
        "MCP client %s tool discovery: %d tools found, %d after filter (%j)",
        id,
        toolNames.length,
        filtered.length,
        filtered,
      );
      const shortId = id.replace(/-/g, "").slice(0, SHORT_CONN_ID_LEN);
      const maxNameLen = MAX_TOOL_NAME_LEN - shortId.length - 1;
      const allowed = new Set(filtered);
      for (const [name, t] of Object.entries(toolSet)) {
        if (!allowed.has(name)) continue;
        const safeName =
          name.length <= maxNameLen ? name : name.slice(0, maxNameLen);
        const prefixed = `${shortId}_${safeName}`;
        mcpTools[prefixed] = t;
        discoveredTools.push({
          name,
          description: (t as { description?: string }).description,
          connectionId: id,
          connectionName: connName,
        });
      }
    } catch (err) {
      debug("MCP client %s tools() failed: %o", id, err);
    }
  }

  const tools = {
    read_skill: readSkillTool,
    ...mcpTools,
  };

  const { AGENT_INSTRUCTIONS: instructions } = config;
  const userInstructions = (instructions ?? "").trim();
  const sessionInstructions = options?.sessionId
    ? `\n\nYour current sessionId is: ${options.sessionId}. Use this for session-scoped memory tools.\n`
    : "";

  const fullSystem =
    userInstructions +
    getFullStaticAgentInstructionsAppend() +
    skillsSection +
    sessionInstructions;

  async function closeMcp(): Promise<void> {
    for (const { client, id } of mcpClients) {
      try {
        debug("Closing MCP client: %s", id);
        await client.close();
      } catch (e) {
        debug("MCP client %s close error: %o", id, e);
      }
    }
  }

  return {
    discoveredTools,
    async runChat(thread, newUserMessage, runOptions) {
      const input: ModelMessage[] = [];
      if (runOptions?.channelContext?.trim()) {
        input.push({
          role: "user",
          content: `[Channel context] This message originated from an external channel. Your reply will be delivered there automatically; compose a clear response.\n${runOptions.channelContext.trim()}\n\n---`,
        });
      }
      for (const item of thread) {
        if (item.role === "user") {
          input.push({ role: "user", content: item.content });
        } else if (item.role === "assistant") {
          input.push({ role: "assistant", content: item.content });
        } else if (item.role === "system") {
          input.push({ role: "system", content: item.content });
        }
      }
      const lastUserContent = buildUserContentParts(
        newUserMessage,
        runOptions?.attachments,
      );
      input.push({
        role: "user",
        content:
          lastUserContent.length === 1 && lastUserContent[0].type === "text"
            ? lastUserContent[0].text
            : lastUserContent,
      });

      const maxSteps = runOptions?.maxTurns ?? getConfig().MAX_TURNS ?? 999;
      const result = await generateText({
        model,
        system: fullSystem,
        messages: input,
        tools,
        stopWhen: stepCountIs(maxSteps),
        onStepFinish(step) {
          const calls = step.toolCalls ?? [];
          const results = step.toolResults ?? [];
          for (let i = 0; i < calls.length; i++) {
            const toolCall = calls[i] as { toolName: string; input?: unknown };
            debug(
              "Tool call: %s args=%s",
              toolCall.toolName,
              truncateForLog(toolCall.input),
            );
            if (options?.auditLog) {
              void options.auditLog.appendAuditEntry({
                type: "tool_call_start",
                payload: {
                  toolName: toolCall.toolName,
                  input: truncateForAudit(toolCall.input),
                },
              });
            }
            const resultPart = results[i] as
              | { toolName: string; output?: unknown }
              | undefined;
            if (resultPart) {
              debug(
                "Tool result: %s result=%s",
                resultPart.toolName,
                truncateForLog(resultPart.output),
              );
            }
            if (options?.auditLog) {
              void options.auditLog.appendAuditEntry({
                type: "tool_call_end",
                payload: {
                  toolName: toolCall.toolName,
                  result: resultPart
                    ? truncateForAudit(resultPart.output)
                    : "(no result)",
                },
              });
            }
          }
        },
      });

      const text =
        result.text ?? (typeof result.finishReason === "string" ? "" : "");
      return {
        finalOutput: text,
        history: [],
        newItems: [],
      };
    },
    closeMcp,
  };
}
