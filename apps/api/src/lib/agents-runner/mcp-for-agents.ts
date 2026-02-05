import {
  Agent,
  MCPServerStdio,
  MCPServerStreamableHttp,
  connectMcpServers,
  hostedMcpTool,
  setDefaultOpenAIKey,
} from "@openai/agents";
import type { MCPServer } from "@openai/agents";
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

/** allowed_capabilities are connection IDs. */
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
 * Create the Hooman agent with colleague handoffs, attaching MCP servers and tools
 * per colleague based on their allowed_capabilities. Connects MCP servers before
 * building the agent. Call closeMcp() after run to close servers.
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

  const { servers, connectionIdToServer, connectionIdToHostedTool } =
    buildMcpFromConnections(connections);

  const mcpServersWrapper =
    servers.length > 0
      ? await connectMcpServers(servers, { connectInParallel: true })
      : null;

  const activeServers = mcpServersWrapper?.active ?? [];

  const colleagueAgents = colleagues.map((p) => {
    const connectionIds = getConnectionIdsFromAllowedCapabilities(
      p.allowed_capabilities ?? [],
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

    return new Agent({
      name: p.id,
      instructions: p.responsibilities?.trim() || p.description,
      handoffDescription: p.description,
      mcpServers: colleagueServers,
      tools: colleagueTools,
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
