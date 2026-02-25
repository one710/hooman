/**
 * Redis-backed pub/sub helpers. Use for cross-process notifications (e.g. API and workers).
 * Publish uses the shared Redis client; subscribe uses a duplicate connection (subscriber mode).
 * Call initRedis() before using.
 */
import { getRedis } from "../data/redis.js";

/** RPC request envelope (publish to request channel). */
export interface RedisRpcRequest {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

/** RPC response envelope (published to response channel). */
export interface RedisRpcResponse {
  requestId: string;
  result?: unknown;
  error?: string;
}

/**
 * Publish a message to a channel. No-op if Redis is not initialized.
 */
export function publish(channel: string, message: string): void {
  const redis = getRedis();
  if (redis) void redis.publish(channel, message);
}

const DEFAULT_RPC_TIMEOUT_MS = 300_000;

/**
 * Request/response over Redis pub/sub with requestId correlation. Uses the shared Redis
 * (call initRedis() first). Subscribes to responseChannel, then publishes to requestChannel;
 * resolves when a message with matching requestId is received or timeout.
 */
export function requestResponse(
  requestChannel: string,
  responseChannel: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
): Promise<unknown> {
  const redis = getRedis();
  if (!redis)
    return Promise.reject(
      new Error("Redis not initialized; call initRedis() first"),
    );

  const requestId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const payload: RedisRpcRequest = { requestId, method, params };

  return new Promise((resolve, reject) => {
    const sub = redis.duplicate();
    const timer = setTimeout(() => {
      sub.unsubscribe(responseChannel);
      sub.quit().catch(() => {});
      reject(new Error(`Redis RPC timeout (${timeoutMs}ms) for ${method}`));
    }, timeoutMs);

    sub.on("message", (ch: string, message: string) => {
      if (ch !== responseChannel) return;
      try {
        const resp = JSON.parse(message) as RedisRpcResponse;
        if (resp.requestId !== requestId) return;
        clearTimeout(timer);
        sub.unsubscribe(responseChannel);
        sub.quit().catch(() => {});
        if (resp.error) reject(new Error(resp.error));
        else resolve(resp.result);
      } catch (e) {
        clearTimeout(timer);
        sub.unsubscribe(responseChannel);
        sub.quit().catch(() => {});
        reject(e);
      }
    });

    sub.subscribe(responseChannel, (err?: Error | null) => {
      if (err) {
        clearTimeout(timer);
        sub.quit().catch(() => {});
        reject(err);
        return;
      }
      redis
        .publish(requestChannel, JSON.stringify(payload))
        .catch((e: unknown) => {
          clearTimeout(timer);
          sub.unsubscribe(responseChannel);
          sub.quit().catch(() => {});
          reject(e);
        });
    });
  });
}

/**
 * Returns a function that calls requestResponse with fixed channels and timeout.
 * Use in MCP servers to avoid repeating channel names and timeout in every tool.
 */
export function createRequestResponse(
  requestChannel: string,
  responseChannel: string,
  timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
): (method: string, params: Record<string, unknown>) => Promise<unknown> {
  return (method: string, params: Record<string, unknown>) =>
    requestResponse(requestChannel, responseChannel, method, params, timeoutMs);
}

/**
 * Returns a message handler for use with createSubscriber().subscribe(channel, handler).
 * Parses RedisRpcRequest, calls handler(method, params), publishes RedisRpcResponse to responseChannel.
 * Use in workers that respond to RPC requests (Slack MCP, WhatsApp MCP, WhatsApp connection).
 */
export function createRpcMessageHandler(
  responseChannel: string,
  handler: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>,
  logInvalid?: (msg: string) => void,
): (message: string) => void {
  return async (message: string) => {
    let req: RedisRpcRequest;
    try {
      req = JSON.parse(message) as RedisRpcRequest;
    } catch {
      logInvalid?.("Invalid MCP request JSON");
      return;
    }
    const { requestId, method, params } = req;
    let resp: RedisRpcResponse;
    try {
      const result = await handler(method, params ?? {});
      resp = { requestId, result };
    } catch (err) {
      resp = {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const redis = getRedis();
    if (redis) void redis.publish(responseChannel, JSON.stringify(resp));
  };
}

export interface Subscriber {
  /** Subscribe to a channel. onMessage(message) is called for each message. */
  subscribe(channel: string, onMessage: (message: string) => void): void;
  /** Unsubscribe from a channel. */
  unsubscribe(channel: string): void;
  /** Close the subscriber connection. */
  close(): Promise<void>;
}

/**
 * Create a subscriber that uses a dedicated Redis connection (duplicate of the shared client).
 * Use for subscribe only; keep using publish() for sending. Returns null if Redis is not initialized.
 */
export function createSubscriber(): Subscriber | null {
  const redis = getRedis();
  if (!redis) return null;

  const sub = redis.duplicate();
  const channels = new Map<string, (message: string) => void>();
  const pending = new Set<string>();

  sub.on("message", (channel: string, message: string) => {
    const cb = channels.get(channel);
    if (cb) cb(message);
  });

  function doSubscribe(channel: string) {
    if (!channels.has(channel)) return;
    sub.subscribe(channel, (err) => {
      if (err) sub.emit("error", err);
    });
  }

  sub.on("ready", () => {
    pending.forEach((ch) => doSubscribe(ch));
    pending.clear();
  });

  return {
    subscribe(channel, onMessage) {
      if (channels.has(channel)) return;
      channels.set(channel, onMessage);
      if (sub.status === "ready") {
        doSubscribe(channel);
      } else {
        pending.add(channel);
      }
    },
    unsubscribe(channel) {
      channels.delete(channel);
      sub.unsubscribe(channel);
    },
    async close() {
      await sub.quit();
    },
  };
}
