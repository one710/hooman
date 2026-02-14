import {
  Agent,
  MCPServerStdio,
  MCPServerStreamableHttp,
  connectMcpServers,
  hostedMcpTool,
  tool,
} from "@openai/agents";
import type { MCPServer } from "@openai/agents";
import { createOpenAI } from "@ai-sdk/openai";
import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { listSkillsFromFs, getSkillContent } from "./skills-cli.js";
import type { SkillEntry } from "./skills-cli.js";
import type { PersonaConfig } from "../types.js";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types.js";
import type { AppConfig } from "../config.js";
import {
  getChannelsConfig,
  getConfig,
  DEFAULT_AGENT_INSTRUCTIONS,
  STATIC_AGENT_INSTRUCTIONS_APPEND,
} from "../config.js";
import type { ScheduleService } from "../data/scheduler.js";
import { setReloadFlag } from "../data/reload-flag.js";
import { env, BACKEND_ROOT } from "../env.js";
import { join } from "path";
import createDebug from "debug";

const debug = createDebug("hooman:agents-mcp");

/**
 * Universal tool attached to every persona: read full SKILL.md content by skill id (Level 2 loading).
 * Use when the persona needs to follow a skill's full instructions.
 */
const readSkillTool = tool({
  name: "read_skill",
  description:
    "Read the full instructions (SKILL.md) for an installed skill by its id. Use when you need to follow a skill's procedures. Pass the skill_id (e.g. pptx, pdf, docx) from the available skills list.",
  parameters: {
    type: "object" as const,
    properties: {
      skill_id: {
        type: "string" as const,
        description: "The skill id (directory name, e.g. pptx, pdf, docx)",
      },
    },
    required: ["skill_id"] as const,
    additionalProperties: true as const,
  },
  strict: false as const,
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

/** allowed_connections are connection IDs. */
function getConnectionIdsFromAllowedCapabilities(
  allowedCapabilities: string[],
): Set<string> {
  const ids = new Set<string>();
  for (const id of allowedCapabilities ?? []) {
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  return ids;
}

/** Default cwd for stdio MCP. */
const DEFAULT_MCP_CWD = env.MCP_STDIO_DEFAULT_CWD;

/** Build env for korotovsky/slack-mcp-server. Uses channel bot/user token. Launched via `go run` so only Go is required. */
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

/** Path to the WhatsApp MCP server source (stdio). Uses Redis pub/sub to talk to WhatsApp worker. Launched via tsx so no build step is needed. */
const WHATSAPP_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "channels",
  "whatsapp-mcp-server.ts",
);

/** Build env for prebuilt mcp-email-server (ai-zerolab) from channel config. SMTP uses same creds as IMAP; only host/port/tls from smtp. */
function getEmailMcpEnv(): Record<string, string> | undefined {
  const email = getChannelsConfig().email;
  if (
    !email?.enabled ||
    !email.imap?.host?.trim() ||
    !email.imap?.user?.trim() ||
    !email.smtp?.host?.trim()
  )
    return undefined;
  return {
    MCP_EMAIL_SERVER_ACCOUNT_NAME: "default",
    MCP_EMAIL_SERVER_EMAIL_ADDRESS: email.imap.user,
    MCP_EMAIL_SERVER_USER_NAME: email.imap.user,
    MCP_EMAIL_SERVER_PASSWORD: email.imap.password ?? "",
    MCP_EMAIL_SERVER_IMAP_HOST: email.imap.host,
    MCP_EMAIL_SERVER_IMAP_PORT: String(email.imap.port ?? 993),
    MCP_EMAIL_SERVER_IMAP_SSL: email.imap.tls !== false ? "true" : "false",
    MCP_EMAIL_SERVER_SMTP_HOST: email.smtp.host,
    MCP_EMAIL_SERVER_SMTP_PORT: String(email.smtp.port ?? 465),
    MCP_EMAIL_SERVER_SMTP_SSL: email.smtp.tls !== false ? "true" : "false",
  };
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

/** Slack/WhatsApp MCP connections when those channels are configured and enabled. Slack uses korotovsky/slack-mcp-server via `go run`. */
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
  const emailMcpEnv = getEmailMcpEnv();
  if (emailMcpEnv) {
    out.push({
      id: "_default_email",
      type: "stdio",
      name: "email",
      command: "uvx",
      args: ["mcp-email-server@latest", "stdio"],
      env: emailMcpEnv,
    });
  }
  return out;
}

/** First-party default MCP servers (stdio): fetch, time, filesystem; plus channel MCPs when enabled. */
function getAllDefaultMcpConnections(): MCPConnection[] {
  return [...getDefaultMcpConnections(), ...getChannelDefaultMcpConnections()];
}

/** IDs of general-purpose default MCP connections given to every persona (fetch, time, filesystem — NOT channel MCPs). */
function getPersonaDefaultMcpConnectionIds(): string[] {
  return getDefaultMcpConnections().map((c) => c.id);
}

/** IDs of channel-specific MCP connections given only to the Hooman agent (Slack, WhatsApp, Email). */
function getChannelMcpConnectionIds(): string[] {
  return getChannelDefaultMcpConnections().map((c) => c.id);
}

/** Default request timeout for stdio MCP tool calls (ms). 3600s to allow slow operations. */
const STDIO_MCP_TIMEOUT_MS = 3600 * 1000;

/** Session/connect timeout (seconds). Generous to allow cold starts (go run, uvx, npx download & compile). */
const STDIO_MCP_SESSION_TIMEOUT_SEC = 300;

/** Build one MCP server instance from a stdio connection config. */
function buildStdioServer(c: MCPConnectionStdio): MCPServerStdio {
  const hasArgs = Array.isArray(c.args) && c.args.length > 0;
  const cwd = c.cwd?.trim() || DEFAULT_MCP_CWD;
  return new MCPServerStdio({
    name: c.name || c.id,
    ...(hasArgs
      ? { command: c.command, args: c.args }
      : {
          fullCommand: c.command.trim()
            ? `${c.command} ${(c.args ?? []).join(" ")}`.trim()
            : "echo",
        }),
    cacheToolsList: true,
    clientSessionTimeoutSeconds: STDIO_MCP_SESSION_TIMEOUT_SEC,
    timeout: STDIO_MCP_TIMEOUT_MS,
    ...(c.env && Object.keys(c.env).length > 0 ? { env: c.env } : {}),
    ...(cwd ? { cwd } : {}),
  });
}

/** Build one MCP server instance from a streamable_http connection config. */
function buildStreamableHttpServer(
  c: MCPConnectionStreamableHttp,
): MCPServerStreamableHttp {
  return new MCPServerStreamableHttp({
    name: c.name || c.id,
    url: c.url,
    cacheToolsList: c.cache_tools_list ?? true,
    ...(c.timeout_seconds != null ? { timeout: c.timeout_seconds * 1000 } : {}),
    ...(c.headers && Object.keys(c.headers).length > 0
      ? { requestInit: { headers: c.headers } }
      : {}),
  });
}

/** Build one hosted MCP tool from a hosted connection config. */
function buildHostedTool(c: MCPConnectionHosted) {
  const requireApproval: "never" | "always" =
    c.require_approval === "always" ? "always" : "never";
  return hostedMcpTool({
    serverLabel: c.server_label || c.id,
    serverUrl: c.server_url,
    ...(requireApproval === "always"
      ? { requireApproval: "always" as const }
      : { requireApproval: "never" as const }),
  });
}

/**
 * Build MCP servers (stdio, streamable_http) and hosted tools from connection configs.
 * Returns servers to connect and a map connectionId -> server or tool for assigning to personas.
 */
function buildMcpFromConnections(connections: MCPConnection[]): {
  servers: MCPServer[];
  connectionIdToServer: Map<string, MCPServer>;
  connectionIdToHostedTool: Map<string, ReturnType<typeof hostedMcpTool>>;
} {
  const servers: MCPServer[] = [];
  const connectionIdToServer = new Map<string, MCPServer>();
  const connectionIdToHostedTool = new Map<
    string,
    ReturnType<typeof hostedMcpTool>
  >();

  for (const c of connections) {
    if (c.type === "stdio") {
      const server = buildStdioServer(c as MCPConnectionStdio);
      servers.push(server);
      connectionIdToServer.set(c.id, server);
    } else if (c.type === "streamable_http") {
      const server = buildStreamableHttpServer(
        c as MCPConnectionStreamableHttp,
      );
      servers.push(server);
      connectionIdToServer.set(c.id, server);
    } else if (c.type === "hosted") {
      const tool = buildHostedTool(c as MCPConnectionHosted);
      connectionIdToHostedTool.set(c.id, tool);
    }
  }

  return {
    servers,
    connectionIdToServer,
    connectionIdToHostedTool,
  };
}

/**
 * Build Level 1 skill metadata text for agent instructions (name + description per skill).
 * Mimics Claude's "metadata always loaded" so the agent knows which skills exist and when to use them.
 */
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

/**
 * Create the Hooman agent with persona handoffs, attaching MCP servers and tools
 * per persona based on their allowed_connections, and skill metadata (Level 1) from
 * their allowed_skills. Connects MCP servers before building the agent. Call closeMcp() after run to close servers.
 */

const DEFAULT_CHAT_MODEL = "gpt-4o";

/**
 * Build the agent chat model from config (and optional overrides). Uses LLM_PROVIDER and provider-specific credentials.
 */
export function getAgentModel(
  config: AppConfig,
  overrides?: { apiKey?: string; model?: string },
): ReturnType<typeof aisdk> {
  const modelId =
    overrides?.model?.trim() ||
    config.OPENAI_MODEL?.trim() ||
    DEFAULT_CHAT_MODEL;
  const provider = config.LLM_PROVIDER ?? "openai";

  switch (provider) {
    case "openai": {
      const apiKey = overrides?.apiKey ?? config.OPENAI_API_KEY;
      const openaiProvider = createOpenAI({
        apiKey: apiKey?.trim() || undefined,
      });
      return aisdk(openaiProvider(modelId));
    }
    case "azure": {
      const resourceName = (config.AZURE_RESOURCE_NAME ?? "").trim();
      const apiKey = (overrides?.apiKey ?? config.AZURE_API_KEY ?? "").trim();
      if (!resourceName || !apiKey) {
        throw new Error(
          "Azure provider requires AZURE_RESOURCE_NAME and AZURE_API_KEY. Set them in Settings.",
        );
      }
      const azureProvider = createAzure({
        resourceName,
        apiKey,
        apiVersion: (config.AZURE_API_VERSION ?? "").trim() || undefined,
      });
      return aisdk(azureProvider(modelId));
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
      const anthropicProvider = createAnthropic({ apiKey });
      return aisdk(anthropicProvider(modelId));
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
      const bedrockProvider = createAmazonBedrock({
        region,
        accessKeyId,
        secretAccessKey,
        sessionToken: (config.AWS_SESSION_TOKEN ?? "").trim() || undefined,
      });
      return aisdk(bedrockProvider(modelId));
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
      const googleProvider = createGoogleGenerativeAI({ apiKey });
      return aisdk(googleProvider(modelId));
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
      const vertexProvider = createVertex({
        project,
        location,
        apiKey: apiKey || undefined,
      });
      return aisdk(vertexProvider(modelId));
    }
    case "mistral": {
      const apiKey = (overrides?.apiKey ?? config.MISTRAL_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error(
          "Mistral provider requires MISTRAL_API_KEY. Set it in Settings.",
        );
      }
      const mistralProvider = createMistral({ apiKey });
      return aisdk(mistralProvider(modelId));
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
      const deepseekProvider = createDeepSeek({ apiKey });
      return aisdk(deepseekProvider(modelId));
    }
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

/**
 * Build schedule tools (list, create, cancel) for the main agent when a schedule service is provided.
 */
function buildScheduleTools(
  scheduleService: ScheduleService,
): ReturnType<typeof tool>[] {
  const listScheduledTasksTool = tool({
    name: "list_scheduled_tasks",
    description:
      "List all scheduled tasks for the user. Returns each task's id, execute_at (ISO time), intent, and optional context. Use this to see what is already scheduled before creating or canceling tasks.",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [] as const,
      additionalProperties: false as const,
    },
    strict: true as const,
    execute: async () => {
      const tasks = await scheduleService.list();
      if (tasks.length === 0) return "No scheduled tasks.";
      return JSON.stringify(
        tasks.map((t) => ({
          id: t.id,
          execute_at: t.execute_at,
          intent: t.intent,
          context: t.context,
        })),
        null,
        2,
      );
    },
  });

  const createScheduledTaskTool = tool({
    name: "create_scheduled_task",
    description:
      "Create a new scheduled task. The task will run at execute_at (ISO date-time string, e.g. 2025-02-05T14:00:00Z). intent is a short description of what to do. context is an optional object with extra details. Use this to schedule follow-ups or deferred work for yourself.",
    parameters: {
      type: "object" as const,
      properties: {
        execute_at: {
          type: "string" as const,
          description:
            "When to run the task (ISO 8601 date-time, e.g. 2025-02-05T14:00:00Z)",
        },
        intent: {
          type: "string" as const,
          description: "Short description of what the task should do",
        },
        context: {
          type: "object" as const,
          description: "Optional extra context (key-value object) for the task",
        },
      },
      required: ["execute_at", "intent"] as const,
      additionalProperties: false as const,
    },
    strict: true as const,
    execute: async (input: unknown) => {
      const raw = input as {
        execute_at?: string;
        intent?: string;
        context?: Record<string, unknown>;
      };
      const execute_at =
        typeof raw?.execute_at === "string" ? raw.execute_at.trim() : "";
      const intent = typeof raw?.intent === "string" ? raw.intent.trim() : "";
      if (!execute_at || !intent) {
        return "Error: execute_at and intent are required.";
      }
      const context =
        raw?.context &&
        typeof raw.context === "object" &&
        !Array.isArray(raw.context)
          ? (raw.context as Record<string, unknown>)
          : {};
      const id = await scheduleService.schedule({
        execute_at,
        intent,
        context,
      });
      await setReloadFlag(env.REDIS_URL, "schedule");
      return `Scheduled task created with id: ${id}. It will run at ${execute_at}.`;
    },
  });

  const cancelScheduledTaskTool = tool({
    name: "cancel_scheduled_task",
    description:
      "Cancel a scheduled task by id. Use the id from list_scheduled_tasks. Returns success or that the task was not found.",
    parameters: {
      type: "object" as const,
      properties: {
        id: {
          type: "string" as const,
          description: "The task id to cancel (from list_scheduled_tasks)",
        },
      },
      required: ["id"] as const,
      additionalProperties: false as const,
    },
    strict: true as const,
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
  });

  return [
    listScheduledTasksTool,
    createScheduledTaskTool,
    cancelScheduledTaskTool,
  ];
}

export async function createHoomanAgentWithMcp(
  personas: PersonaConfig[],
  connections: MCPConnection[],
  options?: {
    apiKey?: string;
    model?: string;
    scheduleService?: ScheduleService;
  },
): Promise<{
  agent: ReturnType<typeof Agent.create>;
  closeMcp: () => Promise<void>;
}> {
  const config = getConfig();
  const model = getAgentModel(config, options);
  const scheduleTools = options?.scheduleService
    ? buildScheduleTools(options.scheduleService)
    : [];

  const allConnections: MCPConnection[] = [
    ...getAllDefaultMcpConnections(),
    ...connections,
  ];

  const [
    allSkills,
    { servers, connectionIdToServer, connectionIdToHostedTool },
  ] = await Promise.all([
    listSkillsFromFs(),
    Promise.resolve(buildMcpFromConnections(allConnections)),
  ]);

  const skillsById = new Map<string, SkillEntry>(
    allSkills.map((s) => [s.id, s]),
  );

  const useServerManager = getConfig().MCP_USE_SERVER_MANAGER;

  const mcpServersWrapper =
    servers.length > 0
      ? await connectMcpServers(servers, {
          connectInParallel: true,
          connectTimeoutMs: STDIO_MCP_TIMEOUT_MS,
          ...(useServerManager ? { dropFailed: true } : {}),
        })
      : null;

  const activeServers = mcpServersWrapper?.active ?? [];
  if (useServerManager && mcpServersWrapper) {
    const failed = mcpServersWrapper.failed;
    if (failed.length > 0) {
      debug(
        "MCP Server Manager: %d/%d servers active, %d failed",
        activeServers.length,
        servers.length,
        failed.length,
      );
      for (const [server, error] of mcpServersWrapper.errors) {
        debug("  failed: %s — %s", server.name, error.message);
      }
    }
  }

  const personaAgents = personas.map((p) => {
    const connectionIds = getConnectionIdsFromAllowedCapabilities(
      p.allowed_connections ?? [],
    );
    const personaServers: MCPServer[] = [];
    const personaTools: ReturnType<typeof hostedMcpTool>[] = [];
    // Every persona gets the general-purpose default MCP servers (fetch, time, filesystem) — NOT channel MCPs.
    for (const id of getPersonaDefaultMcpConnectionIds()) {
      const server = connectionIdToServer.get(id);
      if (server && activeServers.includes(server)) personaServers.push(server);
    }
    // Plus any user-configured connections assigned to this persona.
    for (const id of connectionIds) {
      const server = connectionIdToServer.get(id);
      if (server && activeServers.includes(server)) personaServers.push(server);
      const tool = connectionIdToHostedTool.get(id);
      if (tool) personaTools.push(tool);
    }

    const baseInstructions = p.responsibilities?.trim() || p.description;
    const skillIds = p.allowed_skills ?? [];
    const skillsSection = buildSkillsMetadataSection(skillIds, skillsById);
    const instructions = baseInstructions + skillsSection;

    return new Agent({
      name: p.id,
      instructions,
      handoffDescription: p.description,
      model,
      mcpServers: personaServers,
      tools: [readSkillTool, ...personaTools],
    });
  });

  // Attach default MCP servers (fetch, time, filesystem) and channel MCPs (Slack, WhatsApp, Email) to Hooman.
  const defaultMcpIds = getPersonaDefaultMcpConnectionIds();
  const channelMcpIds = getChannelMcpConnectionIds();
  const hoomanMcpIds = [...defaultMcpIds, ...channelMcpIds];
  const hoomanServers: MCPServer[] = [];
  for (const id of hoomanMcpIds) {
    const server = connectionIdToServer.get(id);
    if (server && activeServers.includes(server)) {
      hoomanServers.push(server);
    } else if (channelMcpIds.includes(id)) {
      debug("Channel MCP '%s' not active (missing or failed to connect)", id);
    }
  }
  const { AGENT_NAME: agentName, AGENT_INSTRUCTIONS: instructions } =
    getConfig();
  if (hoomanServers.length > 0) {
    debug(
      "%s agent gets %d MCP server(s): %s",
      agentName || "Hooman",
      hoomanServers.length,
      hoomanServers.map((s) => s.name).join(", "),
    );
  }

  const userInstructions =
    (instructions ?? "").trim() || DEFAULT_AGENT_INSTRUCTIONS;
  const fullInstructions =
    userInstructions.trim() + STATIC_AGENT_INSTRUCTIONS_APPEND;

  const agent = Agent.create({
    name: agentName?.trim() || "Hooman",
    instructions: fullInstructions,
    model,
    handoffs: personaAgents,
    mcpServers: hoomanServers,
    tools: scheduleTools,
  });

  async function closeMcp(): Promise<void> {
    if (mcpServersWrapper) await mcpServersWrapper.close();
  }

  return { agent, closeMcp };
}
