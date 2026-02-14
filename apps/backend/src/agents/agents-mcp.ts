import {
  Agent,
  MCPServerStdio,
  MCPServerStreamableHttp,
  connectMcpServers,
  hostedMcpTool,
  setDefaultOpenAIKey,
  tool,
} from "@openai/agents";
import type { MCPServer } from "@openai/agents";
import { listSkillsFromFs, getSkillContent } from "./skills-cli.js";
import type { SkillEntry } from "./skills-cli.js";
import type { PersonaConfig } from "../types.js";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types.js";
import { getChannelsConfig, getConfig } from "../config.js";
import { env, BACKEND_ROOT } from "../env.js";
import { join } from "path";
import createDebug from "debug";

const debug = createDebug("hooman:agents-mcp");

const HOOMAN_INSTRUCTIONS = `You are Hooman, a digital concierge that operates on behalf of the user.
Be conversational and human-first. Use memory context when provided to tailor and remember preferences.
When a task fits a specialized persona (by role and capabilities), hand off to that persona to do it; otherwise respond yourself.

## Channel replies (IMPORTANT)

You receive messages from different channels (web chat, Slack, WhatsApp, Email).
When a "[Channel context]" block is present in the conversation, you MUST reply on that channel
using the available MCP tools. This is mandatory — do not skip it or just respond in text.

Steps when channel context is present:
1. Read the source_channel and identifiers (chatId, channelId, messageId, etc.) from the channel context.
2. Compose your reply text.
3. Call the appropriate MCP tool to send the reply on the source channel:
   - WhatsApp → call whatsapp_send_message with the chatId and your reply text.
   - Slack → call the Slack MCP tool to post a message in the channelId. Using threadTs to reply in-thread is optional — use your judgment (e.g. DMs often feel more natural without threading).
   - Email → call the email MCP tool to reply to the message.
4. Your final text output should be the same reply you sent via the tool.

## WhatsApp chat ID from phone number

When the user asks you to message them (or someone) on WhatsApp and gives a phone number, you can derive the chatId yourself. Format: digits only (country code + number, no + or spaces) followed by @c.us. Examples:
- +1 555 123 4567 → 15551234567@c.us
- +91 98765 43210 → 919876543210@c.us
- 44 20 7123 4567 → 442071234567@c.us
Strip all non-digits from the number, then append @c.us. Use that as chatId in whatsapp_send_message. Do not ask the user to "share the chat ID" or "message first" if they have already provided a phone number.

Never fabricate tool results. If a tool call fails, report the actual error.`;

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
export async function createHoomanAgentWithMcp(
  personas: PersonaConfig[],
  connections: MCPConnection[],
  options?: { apiKey?: string; model?: string },
): Promise<{
  agent: ReturnType<typeof Agent.create>;
  closeMcp: () => Promise<void>;
}> {
  if (options?.apiKey) setDefaultOpenAIKey(options.apiKey);

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
      mcpServers: personaServers,
      tools: [readSkillTool, ...personaTools],
    });
  });

  // Attach channel MCP servers (Slack, WhatsApp, Email) to Hooman so it can reply to the source channel.
  const channelMcpIds = getChannelMcpConnectionIds();
  const hoomanServers: MCPServer[] = [];
  for (const id of channelMcpIds) {
    const server = connectionIdToServer.get(id);
    if (server && activeServers.includes(server)) {
      hoomanServers.push(server);
    } else {
      debug("Channel MCP '%s' not active (missing or failed to connect)", id);
    }
  }
  if (hoomanServers.length > 0) {
    debug(
      "Hooman agent gets %d channel MCP server(s): %s",
      hoomanServers.length,
      hoomanServers.map((s) => s.name).join(", "),
    );
  }

  const agent = Agent.create({
    name: "Hooman",
    instructions: HOOMAN_INSTRUCTIONS,
    handoffs: personaAgents,
    mcpServers: hoomanServers,
  });

  async function closeMcp(): Promise<void> {
    if (mcpServersWrapper) await mcpServersWrapper.close();
  }

  return { agent, closeMcp };
}
