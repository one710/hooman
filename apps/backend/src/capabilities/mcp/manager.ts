/**
 * Manages MCP clients and tools. Sole responsibility: create MCP clients and load/return tools.
 * Event-queue worker uses tools() then creates the Hooman runner with the returned agentTools.
 */
import createDebug from "debug";
import type { MCPConnectionsStore } from "./connections-store.js";
import {
  type McpClientEntry,
  createMcpClients,
  clientsToTools,
} from "./mcp-service.js";
import { getAllDefaultMcpConnections } from "./system-mcps.js";
import { deleteValue, writeValue } from "../../data/redis.js";
import { runWithTimeout } from "../../utils/helpers.js";

const debug = createDebug("hooman:mcp-manager");

export const DISCOVERED_TOOLS_KEY = "hooman:discovered-tools";

/** Matches frontend: name = tool name, connectionId/connectionName for grouping. */
export interface DiscoveredTool {
  id: string;
  name: string;
  description?: string;
  connectionId: string;
  connectionName: string;
}

/** Fallback when options not passed (e.g. tests). Production uses env via config. */
const DEFAULT_CONNECT_TIMEOUT_MS = 300_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;

export type McpManagerOptions = {
  connectTimeoutMs?: number | null;
  closeTimeoutMs?: number | null;
};

export type McpToolsResult = {
  agentTools: Record<string, unknown>;
  tools: DiscoveredTool[];
};

export class McpManager {
  private cachedResult: McpToolsResult | null = null;
  private cachedMcpClients: McpClientEntry[] | null = null;
  private inFlight: Promise<McpToolsResult> | null = null;
  private readonly connectTimeoutMs: number | null;
  private readonly closeTimeoutMs: number | null;

  constructor(
    private readonly mcpConnectionsStore: MCPConnectionsStore,
    options?: McpManagerOptions,
  ) {
    this.connectTimeoutMs =
      options?.connectTimeoutMs === undefined
        ? DEFAULT_CONNECT_TIMEOUT_MS
        : options.connectTimeoutMs;
    this.closeTimeoutMs =
      options?.closeTimeoutMs === undefined
        ? DEFAULT_CLOSE_TIMEOUT_MS
        : options.closeTimeoutMs;
  }

  /**
   * Returns agent tools map and discovered tools list. Builds MCP clients and loads tools if not cached.
   */
  async tools(): Promise<McpToolsResult> {
    if (this.cachedResult) {
      return this.cachedResult;
    }

    if (this.inFlight) {
      const result = await this.inFlight;
      if (this.cachedResult === result) {
        return result;
      }

      return this.tools();
    }

    const build = async (): Promise<McpToolsResult> => {
      debug("Building MCP tools (first use or after shutdown)");
      const userConnections = await this.mcpConnectionsStore.getAll();
      const connections = [
        ...getAllDefaultMcpConnections(),
        ...userConnections,
      ];
      debug(
        "Building MCP tools: requested connections: %j",
        connections.map((c) => c.id),
      );
      const mcpClients = await createMcpClients(connections, {
        mcpConnectionsStore: this.mcpConnectionsStore,
      });
      const { prefixedTools, tools } = await clientsToTools(
        mcpClients,
        connections,
      );
      this.cachedMcpClients = mcpClients;
      const result: McpToolsResult = {
        agentTools: { ...prefixedTools },
        tools,
      };
      this.cachedResult = result;
      this.publishToolsToRedis(tools);
      debug("Building MCP tools done: %d tools", tools.length);
      return result;
    };
    const connectError = new Error(
      "MCP tools build timed out (connectTimeoutMs).",
    );
    connectError.name = "TimeoutError";
    this.inFlight = runWithTimeout(build, this.connectTimeoutMs, connectError);
    try {
      const result = await this.inFlight;
      this.inFlight = null;
      return result;
    } catch (err) {
      this.inFlight = null;
      throw err;
    }
  }

  /**
   * Closes cached MCP clients and clears cache. Next tools() will rebuild from current connections.
   */
  async shutdown(): Promise<void> {
    const clients = this.cachedMcpClients;
    this.cachedResult = null;
    this.cachedMcpClients = null;
    if (!clients?.length) {
      debug("MCP manager shutdown: no cached clients to close");
      this.clearToolsFromRedis();
      return;
    }

    debug("MCP manager shutdown: closing %d MCP client(s)", clients.length);
    const closeError = new Error(
      "MCP session close timed out (closeTimeoutMs).",
    );
    closeError.name = "TimeoutError";
    const closeAll = async (): Promise<void> => {
      for (const { client, id } of clients) {
        try {
          debug("Closing MCP client: %s", id);
          await client.close();
        } catch (e) {
          debug("MCP client %s close error: %o", id, e);
        }
      }
    };
    try {
      await runWithTimeout(() => closeAll(), this.closeTimeoutMs, closeError);
      debug("MCP manager disconnect: clients closed");
    } catch (err) {
      debug("MCP manager shutdown close error: %o", err);
    }

    this.clearToolsFromRedis();
  }

  private publishToolsToRedis(tools: DiscoveredTool[]): void {
    const json = JSON.stringify(tools);
    writeValue(DISCOVERED_TOOLS_KEY, json).then(
      () => debug("Published %d discovered tools to Redis", tools.length),
      (err) => debug("Failed to publish discovered tools to Redis: %o", err),
    );
  }

  private clearToolsFromRedis(): void {
    deleteValue(DISCOVERED_TOOLS_KEY).catch((err) =>
      debug("Failed to clear discovered tools from Redis: %o", err),
    );
  }
}
