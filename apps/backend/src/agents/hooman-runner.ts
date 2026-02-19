/**
 * Hooman agent run via Vercel AI SDK (generateText + tools). No personas; MCP and skills attached to main flow.
 */
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { createOpenAI } from "@ai-sdk/openai";
import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, tool, stepCountIs, jsonSchema } from "ai";
import type { ModelMessage } from "ai";
import { listSkillsFromFs, getSkillContent } from "./skills-cli.js";
import type { SkillEntry } from "./skills-cli.js";
import type {
  AuditLogEntry,
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types.js";
import type { AppConfig } from "../config.js";
import {
  getChannelsConfig,
  getConfig,
  getFullStaticAgentInstructionsAppend,
} from "../config.js";
import type { ScheduleService } from "../data/scheduler.js";
import type { MCPConnectionsStore } from "../data/mcp-connections-store.js";
import { setReloadFlag } from "../data/reload-flag.js";
import { createOAuthProvider } from "../mcp/oauth-provider.js";
import { env, BACKEND_ROOT } from "../env.js";
import { join } from "path";
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

const DEFAULT_CHAT_MODEL = "gpt-4o";
const DEFAULT_MCP_CWD = env.MCP_STDIO_DEFAULT_CWD;

const WHATSAPP_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "channels",
  "whatsapp-mcp-server.ts",
);

export type AgentInputItem = { role: "user" | "assistant"; content: string };

function getSlackMcpEnv(): Record<string, string> | undefined {
  const slack = getChannelsConfig().slack;
  if (!slack?.enabled || !slack.userToken?.trim()) return undefined;
  const token = slack.userToken.trim();
  const env: Record<string, string> = { SLACK_MCP_ADD_MESSAGE_TOOL: "true" };
  if (token.startsWith("xoxb-")) env.SLACK_MCP_XOXB_TOKEN = token;
  else if (token.startsWith("xoxp-")) env.SLACK_MCP_XOXP_TOKEN = token;
  else env.SLACK_MCP_XOXB_TOKEN = token;
  return env;
}

function getDefaultMcpConnections(): MCPConnectionStdio[] {
  return [
    {
      id: "_default_fetch",
      type: "stdio",
      name: "fetch",
      command: "uvx",
      args: ["mcp-server-fetch"],
    },
    {
      id: "_default_time",
      type: "stdio",
      name: "time",
      command: "uvx",
      args: ["mcp-server-time"],
    },
    {
      id: "_default_filesystem",
      type: "stdio",
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", DEFAULT_MCP_CWD],
    },
  ];
}

function getChannelDefaultMcpConnections(): MCPConnectionStdio[] {
  const channels = getChannelsConfig();
  const out: MCPConnectionStdio[] = [];
  const slackMcpEnv = getSlackMcpEnv();
  if (slackMcpEnv) {
    out.push({
      id: "_default_slack",
      type: "stdio",
      name: "slack",
      command: "go",
      args: [
        "run",
        "github.com/korotovsky/slack-mcp-server/cmd/slack-mcp-server@latest",
        "--transport",
        "stdio",
      ],
      env: slackMcpEnv,
    });
  }
  if (channels.whatsapp?.enabled && env.REDIS_URL) {
    out.push({
      id: "_default_whatsapp",
      type: "stdio",
      name: "whatsapp",
      command: "npx",
      args: ["tsx", WHATSAPP_MCP_SERVER_PATH],
      env: { REDIS_URL: env.REDIS_URL },
    });
  }
  return out;
}

function getAllDefaultMcpConnections(): MCPConnection[] {
  return [...getDefaultMcpConnections(), ...getChannelDefaultMcpConnections()];
}

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

/** Raw AI SDK model (no aisdk wrapper). */
export function getHoomanModel(
  config: AppConfig,
  overrides?: { apiKey?: string; model?: string },
) {
  const modelId =
    overrides?.model?.trim() ||
    config.OPENAI_MODEL?.trim() ||
    DEFAULT_CHAT_MODEL;
  const provider = config.LLM_PROVIDER ?? "openai";

  switch (provider) {
    case "openai": {
      const apiKey = overrides?.apiKey ?? config.OPENAI_API_KEY;
      return createOpenAI({
        apiKey: apiKey?.trim() || undefined,
      })(modelId);
    }
    case "azure": {
      const resourceName = (config.AZURE_RESOURCE_NAME ?? "").trim();
      const apiKey = (overrides?.apiKey ?? config.AZURE_API_KEY ?? "").trim();
      if (!resourceName || !apiKey) {
        throw new Error(
          "Azure provider requires AZURE_RESOURCE_NAME and AZURE_API_KEY. Set them in Settings.",
        );
      }
      return createAzure({
        resourceName,
        apiKey,
        apiVersion: (config.AZURE_API_VERSION ?? "").trim() || undefined,
      })(modelId);
    }
    case "anthropic": {
      const apiKey = (
        overrides?.apiKey ??
        config.ANTHROPIC_API_KEY ??
        ""
      ).trim();
      if (!apiKey) {
        throw new Error(
          "Anthropic provider requires ANTHROPIC_API_KEY. Set it in Settings.",
        );
      }
      return createAnthropic({ apiKey })(modelId);
    }
    case "amazon-bedrock": {
      const region = (config.AWS_REGION ?? "").trim();
      const accessKeyId = (config.AWS_ACCESS_KEY_ID ?? "").trim();
      const secretAccessKey = (config.AWS_SECRET_ACCESS_KEY ?? "").trim();
      if (!region || !accessKeyId || !secretAccessKey) {
        throw new Error(
          "Amazon Bedrock provider requires AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY. Set them in Settings.",
        );
      }
      return createAmazonBedrock({
        region,
        accessKeyId,
        secretAccessKey,
        sessionToken: (config.AWS_SESSION_TOKEN ?? "").trim() || undefined,
      })(modelId);
    }
    case "google": {
      const apiKey = (
        overrides?.apiKey ??
        config.GOOGLE_GENERATIVE_AI_API_KEY ??
        ""
      ).trim();
      if (!apiKey) {
        throw new Error(
          "Google Generative AI provider requires GOOGLE_GENERATIVE_AI_API_KEY. Set it in Settings.",
        );
      }
      return createGoogleGenerativeAI({ apiKey })(modelId);
    }
    case "google-vertex": {
      const project = (config.GOOGLE_VERTEX_PROJECT ?? "").trim();
      const location = (config.GOOGLE_VERTEX_LOCATION ?? "").trim();
      const apiKey = (config.GOOGLE_VERTEX_API_KEY ?? "").trim();
      if (!project || !location) {
        throw new Error(
          "Google Vertex provider requires GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_LOCATION. Set them in Settings (or use GOOGLE_APPLICATION_CREDENTIALS for service account).",
        );
      }
      return createVertex({
        project,
        location,
        apiKey: apiKey || undefined,
      })(modelId);
    }
    case "mistral": {
      const apiKey = (overrides?.apiKey ?? config.MISTRAL_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error(
          "Mistral provider requires MISTRAL_API_KEY. Set it in Settings.",
        );
      }
      return createMistral({ apiKey })(modelId);
    }
    case "deepseek": {
      const apiKey = (
        overrides?.apiKey ??
        config.DEEPSEEK_API_KEY ??
        ""
      ).trim();
      if (!apiKey) {
        throw new Error(
          "DeepSeek provider requires DEEPSEEK_API_KEY. Set it in Settings.",
        );
      }
      return createDeepSeek({ apiKey })(modelId);
    }
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

const readSkillTool = tool({
  description:
    "Read the full instructions (SKILL.md) for an installed skill by its id. Use when you need to follow a skill's procedures. Pass the skill_id (e.g. pptx, pdf, docx) from the available skills list.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      skill_id: {
        type: "string",
        description: "The skill id (directory name, e.g. pptx, pdf, docx)",
      },
    },
    required: ["skill_id"],
    additionalProperties: true,
  }),
  execute: async (input: unknown) => {
    const skillId =
      typeof (input as { skill_id?: string })?.skill_id === "string"
        ? (input as { skill_id: string }).skill_id.trim()
        : "";
    if (!skillId) return "Error: skill_id is required.";
    const content = await getSkillContent(skillId);
    return content ?? "Skill not found.";
  },
});

function buildScheduleTools(scheduleService: ScheduleService) {
  return {
    list_scheduled_tasks: tool({
      description:
        "List all scheduled tasks for the user. Returns each task's id, execute_at (ISO time or placeholder for recurring), optional cron (recurring expression), intent, and optional context. Use this to see what is already scheduled before creating or canceling tasks.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      }),
      execute: async () => {
        const tasks = await scheduleService.list();
        if (tasks.length === 0) return "No scheduled tasks.";
        return JSON.stringify(
          tasks.map((t) => ({
            id: t.id,
            intent: t.intent,
            context: t.context,
            ...(t.execute_at ? { execute_at: t.execute_at } : {}),
            ...(t.cron ? { cron: t.cron } : {}),
          })),
          null,
          2,
        );
      },
    }),
    create_scheduled_task: tool({
      description:
        "Create a scheduled task. One-shot: provide execute_at (ISO date-time, e.g. 2025-02-05T14:00:00Z) and the task runs once at that time. Recurring: provide cron (e.g. '*/5 * * * *' for every 5 minutes) and the task repeats. intent is required; context is optional. Use for follow-ups or deferred/recurring work.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          execute_at: {
            type: "string",
            description:
              "When to run the task once (ISO 8601 date-time). Omit if using cron for recurring.",
          },
          cron: {
            type: "string",
            description:
              "Cron expression for recurring (e.g. '*/5 * * * *' every 5 min). If set, task repeats; otherwise runs once at execute_at.",
          },
          intent: {
            type: "string",
            description: "Short description of what the task should do",
          },
          context: {
            type: "object",
            description:
              "Optional extra context (key-value object) for the task",
          },
        },
        required: ["intent"],
        additionalProperties: false,
      }),
      execute: async (input: unknown) => {
        const raw = input as {
          execute_at?: string;
          cron?: string;
          intent?: string;
          context?: Record<string, unknown>;
        };
        const execute_at =
          typeof raw?.execute_at === "string" ? raw.execute_at.trim() : "";
        const cronStr = typeof raw?.cron === "string" ? raw.cron.trim() : "";
        const intent = typeof raw?.intent === "string" ? raw.intent.trim() : "";
        if (!intent) {
          return "Error: intent is required.";
        }
        if (!execute_at && !cronStr) {
          return "Error: provide either execute_at (one-shot) or cron (recurring).";
        }
        const context =
          raw?.context &&
          typeof raw.context === "object" &&
          !Array.isArray(raw.context)
            ? (raw.context as Record<string, unknown>)
            : {};
        const id = await scheduleService.schedule({
          intent,
          context,
          ...(execute_at ? { execute_at } : {}),
          ...(cronStr ? { cron: cronStr } : {}),
        });
        await setReloadFlag(env.REDIS_URL, "schedule");
        if (cronStr) {
          return `Scheduled recurring task with id: ${id}. Cron: ${cronStr}.`;
        }
        return `Scheduled task created with id: ${id}. It will run at ${execute_at}.`;
      },
    }),
    cancel_scheduled_task: tool({
      description:
        "Cancel a scheduled task by id. Use the id from list_scheduled_tasks. Returns success or that the task was not found.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The task id to cancel (from list_scheduled_tasks)",
          },
        },
        required: ["id"],
        additionalProperties: false,
      }),
      execute: async (input: unknown) => {
        const id =
          typeof (input as { id?: string })?.id === "string"
            ? (input as { id: string }).id.trim()
            : "";
        if (!id) return "Error: id is required.";
        const ok = await scheduleService.cancel(id);
        if (ok) {
          await setReloadFlag(env.REDIS_URL, "schedule");
          return `Scheduled task ${id} has been cancelled.`;
        }
        return `Scheduled task with id "${id}" was not found.`;
      },
    }),
  };
}

export interface RunChatOptions {
  memoryContext?: string;
  channelContext?: string;
  apiKey?: string;
  model?: string;
  maxTurns?: number;
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

/** MCP clients to close after run. */
export interface HoomanRunnerSession {
  runChat(
    thread: AgentInputItem[],
    newUserMessage: string,
    options?: RunChatOptions,
  ): Promise<RunChatResult>;
  closeMcp: () => Promise<void>;
}

export type AuditLogAppender = {
  appendAuditEntry(
    entry: Omit<AuditLogEntry, "id" | "timestamp">,
  ): Promise<void>;
};

export async function createHoomanRunner(options?: {
  connections?: MCPConnection[];
  scheduleService?: ScheduleService;
  mcpConnectionsStore?: MCPConnectionsStore;
  apiKey?: string;
  model?: string;
  auditLog?: AuditLogAppender;
}): Promise<HoomanRunnerSession> {
  const config = getConfig();
  const model = getHoomanModel(config, {
    apiKey: options?.apiKey ?? config.OPENAI_API_KEY,
    model: options?.model,
  });

  const allConnections: MCPConnection[] = [
    ...getAllDefaultMcpConnections(),
    ...(options?.connections ?? []),
  ];

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
            const transport = new Experimental_StdioMCPTransport({
              command: stdio.command,
              args: hasArgs ? stdio.args : [],
              env: stdio.env,
              cwd: stdio.cwd?.trim() || DEFAULT_MCP_CWD,
            });
            const client = await createMCPClient({ transport });
            clients.push({ client, id: c.id });
          } else if (c.type === "streamable_http") {
            const http = c as MCPConnectionStreamableHttp;
            const hasOAuth =
              http.oauth?.redirect_uri && options?.mcpConnectionsStore;
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
            clients.push({ client, id: c.id });
          } else if (c.type === "hosted") {
            const hosted = c as MCPConnectionHosted;
            const hasOAuth =
              hosted.oauth?.redirect_uri && options?.mcpConnectionsStore;
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
  for (const { client, id } of mcpClients) {
    try {
      const toolSet = await client.tools();
      const shortId = id.replace(/-/g, "").slice(0, SHORT_CONN_ID_LEN);
      const maxNameLen = MAX_TOOL_NAME_LEN - shortId.length - 1;
      for (const [name, t] of Object.entries(toolSet)) {
        const safeName =
          name.length <= maxNameLen ? name : name.slice(0, maxNameLen);
        const prefixed = `${shortId}_${safeName}`;
        mcpTools[prefixed] = t;
      }
    } catch (err) {
      debug("MCP client %s tools() failed: %o", id, err);
    }
  }

  const scheduleTools = options?.scheduleService
    ? buildScheduleTools(options.scheduleService)
    : {};

  const tools = {
    read_skill: readSkillTool,
    ...mcpTools,
    ...scheduleTools,
  };

  const { AGENT_INSTRUCTIONS: instructions } = config;
  const userInstructions = (instructions ?? "").trim();
  const fullSystem =
    userInstructions + getFullStaticAgentInstructionsAppend() + skillsSection;

  async function closeMcp(): Promise<void> {
    for (const { client } of mcpClients) {
      try {
        await client.close();
      } catch (e) {
        debug("MCP client close error: %o", e);
      }
    }
  }

  return {
    async runChat(thread, newUserMessage, runOptions) {
      const input: ModelMessage[] = [];
      if (runOptions?.memoryContext?.trim()) {
        input.push({
          role: "user",
          content: `[Relevant memory from past conversations]\n${runOptions.memoryContext.trim()}\n\n---`,
        });
      }
      if (runOptions?.channelContext?.trim()) {
        input.push({
          role: "user",
          content: `[Channel context] This message originated from an external channel. Your reply will be delivered there automatically; compose a clear response.\n${runOptions.channelContext.trim()}\n\n---`,
        });
      }
      for (const item of thread) {
        if (item.role === "user") {
          input.push({ role: "user", content: item.content });
        } else {
          input.push({ role: "assistant", content: item.content });
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

      const maxSteps = runOptions?.maxTurns ?? 10;
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
