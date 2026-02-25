/**
 * Shared Redis client. Call initRedis(redisUrl) once at process startup (API and workers);
 * then use getRedis() where a Redis connection is needed. Avoids creating multiple clients.
 */
import { Redis } from "ioredis";

let client: Redis | null = null;
let currentUrl = "";

/** Required by BullMQ for blocking commands; safe for get/set/del elsewhere. */
const DEFAULT_OPTIONS = { maxRetriesPerRequest: null as number | null };

/**
 * Initialize the shared Redis client. Idempotent: same URL is a no-op; different URL replaces the client.
 * Call before initKillSwitch, createEventQueue, or initReloadWatch.
 */
export function initRedis(redisUrl: string): void {
  const url = redisUrl?.trim() ?? "";
  if (url === currentUrl && client) return;
  if (client) {
    client.disconnect();
    client = null;
  }
  currentUrl = url;
  if (!url) return;
  client = new Redis(url, { ...DEFAULT_OPTIONS });
  client.on("error", () => {
    // avoid crashing; callers handle errors
  });
}

/**
 * Return the shared Redis client, or null if not initialized or URL was empty.
 */
export function getRedis(): Redis | null {
  return client;
}

/**
 * Get a string value by key. Returns null if key is missing or Redis is not initialized.
 */
export async function getValue(key: string): Promise<string | null> {
  const redis = client;
  if (!redis) return null;
  return redis.get(key);
}

/**
 * Set a string value by key. No-op if Redis is not initialized.
 */
export async function writeValue(key: string, value: string): Promise<void> {
  const redis = client;
  if (!redis) return;
  await redis.set(key, value);
}

/**
 * Delete a key. No-op if Redis is not initialized.
 */
export async function deleteValue(key: string): Promise<void> {
  const redis = client;
  if (!redis) return;
  await redis.del(key);
}

/**
 * Wait for the shared Redis client to be in "ready" state. Resolves immediately if already ready.
 * Rejects after timeoutMs (default 10s) if the connection doesn't become ready.
 */
export function waitForRedis(timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!client) return reject(new Error("Redis not initialized"));
    if (client.status === "ready") return resolve();
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Redis not ready after ${timeoutMs}ms (status: ${client?.status})`,
        ),
      );
    }, timeoutMs);
    client.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
    client.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Close the shared client. Call on process shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
  currentUrl = "";
}
