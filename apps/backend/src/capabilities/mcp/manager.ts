/**
 * Long-lived MCP session manager. Always enabled;
 * the event-queue worker uses this to init MCPs once and reuse them; reload()
 * closes and clears cache so the next getSession() rebuilds from current connections.
 */
import createDebug from "debug";
import type { MCPConnectionsStore } from "./connections-store.js";
import {
  createHoomanRunner,
  type AuditLogAppender,
  type DiscoveredTool,
  type HoomanRunnerSession,
} from "../../agents/hooman-runner.js";
import {
  type McpClientEntry,
  createMcpClients,
  clientsToTools,
} from "./mcp-service.js";
import { getAllDefaultMcpConnections } from "./system-mcps.js";
import { getRedis } from "../../data/redis.js";

const debug = createDebug("hooman:mcp-manager");

export const DISCOVERED_TOOLS_KEY = "hooman:discovered-tools";

/** Fallback when options not passed (e.g. tests). Production uses env via config. */
const DEFAULT_CONNECT_TIMEOUT_MS = 300_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;

export type McpManagerOptions = {
  connectTimeoutMs?: number | null;
  closeTimeoutMs?: number | null;
  auditLog?: AuditLogAppender;
};

async function runWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number | null,
  timeoutError: Error,
): Promise<T> {
  if (timeoutMs === null) {
    return fn();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const task = fn();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) task.catch(() => undefined);
  }
}

async function runWithTimeoutTask(
  task: Promise<void>,
  timeoutMs: number | null,
  timeoutError: Error,
): Promise<void> {
  if (timeoutMs === null) {
    await task;
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    await Promise.race([task, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) task.catch(() => undefined);
  }
}

/** Session with tools; manager attaches tools to runner session. */
export type McpSession = HoomanRunnerSession & { tools: DiscoveredTool[] };

/**
 * Manages a single cached session. Creates and owns MCP clients;
 * reload() closes them and clears cache so the next getSession() rebuilds.
 */
export class McpManager {
  private cachedSession: McpSession | null = null;
  private cachedMcpClients: McpClientEntry[] | null = null;
  private cachedTools: DiscoveredTool[] = [];
  private inFlight: Promise<McpSession> | null = null;
  private readonly connectTimeoutMs: number | null;
  private readonly closeTimeoutMs: number | null;
  private readonly auditLog?: AuditLogAppender;

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
    this.auditLog = options?.auditLog;
  }

  /**
   * Returns a session backed by the cached runner. Handlers must not call closeMcp
   * on the returned session. If no cache exists, builds one (serialized via inFlight).
   */
  async getSession(): Promise<McpSession> {
    if (this.cachedSession) {
      return this.wrapSession(this.cachedSession);
    }
    if (this.inFlight) {
      const session = await this.inFlight;
      if (this.cachedSession === session) {
        return this.wrapSession(session);
      }
      return this.getSession();
    }
    const build = async (): Promise<McpSession> => {
      debug("Building MCP session (first use or after reload)");
      const userConnections = await this.mcpConnectionsStore.getAll();
      const connections = [
        ...getAllDefaultMcpConnections(),
        ...userConnections,
      ];
      debug(
        "Building MCP session: requested connections: %j",
        connections.map((c) => c.id),
      );
      const mcpClients = await createMcpClients(connections, {
        mcpConnectionsStore: this.mcpConnectionsStore,
      });
      const { prefixedTools, tools } = await clientsToTools(
        mcpClients,
        connections,
      );
      const runner = await createHoomanRunner({
        agentTools: { ...prefixedTools },
        auditLog: this.auditLog,
      });
      this.cachedMcpClients = mcpClients;
      this.cachedTools = tools;
      debug("Building MCP session done: %s", runner ? "Success" : "Failed");
      return this.wrapSession({ generate: runner.generate });
    };
    const connectError = new Error(
      "MCP session build timed out (connectTimeoutMs).",
    );
    connectError.name = "TimeoutError";
    this.inFlight = runWithTimeout(build, this.connectTimeoutMs, connectError);
    try {
      const session = await this.inFlight;
      this.cachedSession = session;
      this.inFlight = null;
      this.publishToolsToRedis();
      return session;
    } catch (err) {
      this.inFlight = null;
      throw err;
    }
  }

  /**
   * Closes the cached MCP clients and clears cache.
   * Next getSession() will build a new session from current connections.
   */
  async reload(): Promise<void> {
    const clients = this.cachedMcpClients;
    this.cachedSession = null;
    this.cachedMcpClients = null;
    this.cachedTools = [];
    if (!clients?.length) {
      debug("MCP manager reload: no cached clients to close");
      this.clearToolsFromRedis();
      return;
    }
    debug("MCP manager reload: closing %d MCP client(s)", clients.length);
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
      await runWithTimeoutTask(closeAll(), this.closeTimeoutMs, closeError);
      debug("MCP manager reload: clients closed");
    } catch (err) {
      debug("MCP manager reload close error: %o", err);
    }
    this.clearToolsFromRedis();
  }

  private publishToolsToRedis(): void {
    try {
      const redis = getRedis();
      if (!redis) return;
      const json = JSON.stringify(this.cachedTools);
      redis.set(DISCOVERED_TOOLS_KEY, json).catch((err) => {
        debug("Failed to publish discovered tools to Redis: %o", err);
      });
      debug("Published %d discovered tools to Redis", this.cachedTools.length);
    } catch (err) {
      debug("Failed to publish tools to Redis: %o", err);
    }
  }

  private clearToolsFromRedis(): void {
    try {
      const redis = getRedis();
      if (!redis) return;
      redis.del(DISCOVERED_TOOLS_KEY).catch((err) => {
        debug("Failed to clear discovered tools from Redis: %o", err);
      });
    } catch (err) {
      debug("Failed to clear tools from Redis: %o", err);
    }
  }

  private wrapSession(core: Pick<HoomanRunnerSession, "generate">): McpSession {
    return {
      generate: core.generate,
      tools: this.cachedTools,
    };
  }
}
