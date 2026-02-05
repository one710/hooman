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
import { listSkillsFromFs, getSkillContent } from "../skills-cli/index.js";
import type { SkillEntry } from "../skills-cli/index.js";
import type { ColleagueConfig } from "../types/index.js";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types/index.js";

const HOOMAN_INSTRUCTIONS = `You are Hooman, an autonomous digital self that operates on behalf of the user.
Be conversational and human-first. Use memory context when provided to tailor and remember preferences.
When the user's request fits a specialized colleague you can hand off to, do so. Otherwise respond yourself.
If you need an external capability (e.g. send email, Slack), say so and ask for approval; never assume.`;

/**
 * Universal tool attached to every colleague: read full SKILL.md content by skill id (Level 2 loading).
 * Use when the colleague needs to follow a skill's full instructions.
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

/** Default working directory for stdio MCP when cwd not set (e.g. /app/mcp-cwd in Docker). */
const DEFAULT_STDIO_CWD =
  (typeof process.env.MCP_STDIO_DEFAULT_CWD === "string" &&
    process.env.MCP_STDIO_DEFAULT_CWD.trim()) ||
  undefined;

/** Build one MCP server instance from a stdio connection config. */
function buildStdioServer(c: MCPConnectionStdio): MCPServerStdio {
  const hasArgs = Array.isArray(c.args) && c.args.length > 0;
  const cwd = c.cwd?.trim() || DEFAULT_STDIO_CWD;
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
 * Returns servers to connect and a map connectionId -> server or tool for assigning to colleagues.
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
 * Create the Hooman agent with colleague handoffs, attaching MCP servers and tools
 * per colleague based on their allowed_connections, and skill metadata (Level 1) from
 * their allowed_skills. Connects MCP servers before building the agent. Call closeMcp() after run to close servers.
 */
export async function createHoomanAgentWithMcp(
  colleagues: ColleagueConfig[],
  connections: MCPConnection[],
  options?: { apiKey?: string; model?: string },
): Promise<{
  agent: ReturnType<typeof Agent.create>;
  closeMcp: () => Promise<void>;
}> {
  if (options?.apiKey) setDefaultOpenAIKey(options.apiKey);

  const [
    allSkills,
    { servers, connectionIdToServer, connectionIdToHostedTool },
  ] = await Promise.all([
    listSkillsFromFs(),
    Promise.resolve(buildMcpFromConnections(connections)),
  ]);

  const skillsById = new Map<string, SkillEntry>(
    allSkills.map((s) => [s.id, s]),
  );

  const mcpServersWrapper =
    servers.length > 0
      ? await connectMcpServers(servers, { connectInParallel: true })
      : null;

  const activeServers = mcpServersWrapper?.active ?? [];

  const colleagueAgents = colleagues.map((p) => {
    const connectionIds = getConnectionIdsFromAllowedCapabilities(
      p.allowed_connections ?? [],
    );
    const colleagueServers: MCPServer[] = [];
    const colleagueTools: ReturnType<typeof hostedMcpTool>[] = [];
    for (const id of connectionIds) {
      const server = connectionIdToServer.get(id);
      if (server && activeServers.includes(server))
        colleagueServers.push(server);
      const tool = connectionIdToHostedTool.get(id);
      if (tool) colleagueTools.push(tool);
    }

    const baseInstructions = p.responsibilities?.trim() || p.description;
    const skillIds = p.allowed_skills ?? [];
    const skillsSection = buildSkillsMetadataSection(skillIds, skillsById);
    const instructions = baseInstructions + skillsSection;

    return new Agent({
      name: p.id,
      instructions,
      handoffDescription: p.description,
      mcpServers: colleagueServers,
      tools: [readSkillTool, ...colleagueTools],
    });
  });

  const agent = Agent.create({
    name: "Hooman",
    instructions: HOOMAN_INSTRUCTIONS,
    handoffs: colleagueAgents,
  });

  async function closeMcp(): Promise<void> {
    if (mcpServersWrapper) await mcpServersWrapper.close();
  }

  return { agent, closeMcp };
}
