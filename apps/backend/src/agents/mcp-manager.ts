/**
 * Long-lived MCP session manager. When MCP_USE_SERVER_MANAGER is enabled,
 * the event-queue worker uses this to init MCPs once and reuse them; reload()
 * closes and clears cache so the next getSession() rebuilds from current connections.
 */
import createDebug from "debug";
import type { ScheduleService } from "../data/scheduler.js";
import type { MCPConnectionsStore } from "../data/mcp-connections-store.js";
import {
  createHoomanRunner,
  type HoomanRunnerSession,
} from "./hooman-runner.js";

const debug = createDebug("hooman:mcp-manager");

/** Fallback when options not passed (e.g. tests). Production uses env via config. */
const DEFAULT_CONNECT_TIMEOUT_MS = 300_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;

export type McpManagerOptions = {
  connectTimeoutMs?: number | null;
  closeTimeoutMs?: number | null;
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

/**
 * Manages a single cached HoomanRunnerSession. getSession() returns a wrapper
 * with no-op closeMcp so handlers do not tear down shared MCPs. reload() closes
 * the cached session and clears cache so the next getSession() rebuilds.
 */
export class McpManager {
  private cachedSession: HoomanRunnerSession | null = null;
  private inFlight: Promise<HoomanRunnerSession> | null = null;
  private readonly connectTimeoutMs: number | null;
  private readonly closeTimeoutMs: number | null;

  constructor(
    private readonly mcpConnectionsStore: MCPConnectionsStore,
    private readonly scheduleService: ScheduleService,
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
   * Returns a session backed by the cached runner. Handlers must not call closeMcp
   * on the returned session. If no cache exists, builds one (serialized via inFlight).
   */
  async getSession(): Promise<HoomanRunnerSession> {
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
    const build = async (): Promise<HoomanRunnerSession> => {
      debug("Building MCP session (first use or after reload)");
      const connections = await this.mcpConnectionsStore.getAll();
      return createHoomanRunner({
        connections,
        scheduleService: this.scheduleService,
        mcpConnectionsStore: this.mcpConnectionsStore,
      });
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
      return this.wrapSession(session);
    } catch (err) {
      this.inFlight = null;
      throw err;
    }
  }

  /**
   * Closes the cached session (with close timeout) and clears cache.
   * Next getSession() will build a new session from current connections.
   */
  async reload(): Promise<void> {
    const session = this.cachedSession;
    this.cachedSession = null;
    if (!session) return;
    const closeError = new Error(
      "MCP session close timed out (closeTimeoutMs).",
    );
    closeError.name = "TimeoutError";
    try {
      await runWithTimeoutTask(
        session.closeMcp(),
        this.closeTimeoutMs,
        closeError,
      );
      debug("MCP manager reload: session closed");
    } catch (err) {
      debug("MCP manager reload close error: %o", err);
    }
  }

  private wrapSession(session: HoomanRunnerSession): HoomanRunnerSession {
    return {
      runChat: session.runChat.bind(session),
      closeMcp: async () => {
        /* no-op when using manager; do not tear down shared MCPs */
      },
    };
  }
}
