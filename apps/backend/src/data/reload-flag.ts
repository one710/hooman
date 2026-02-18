/**
 * Redis-backed reload flags per scope so the API can signal only the affected workers.
 * Scopes: schedule (cron tasks), slack, whatsapp.
 * Uses shared client from data/redis; call initRedis(redisUrl) first.
 */
import { initRedis, getRedis } from "./redis.js";

export type ReloadScope = "schedule" | "slack" | "whatsapp";

const REDIS_KEY_PREFIX = "hooman:workers:reload:";
const POLL_MS = 2000;

function key(scope: ReloadScope): string {
  return REDIS_KEY_PREFIX + scope;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Set the reload flag for a scope. Call from API after schedule add/cancel or when a channel's config is updated.
 */
export async function setReloadFlag(
  redisUrl: string,
  scope: ReloadScope,
): Promise<void> {
  const url = redisUrl?.trim();
  if (!url) return;
  initRedis(redisUrl);
  const redis = getRedis();
  if (!redis) return;
  await redis.set(key(scope), "1");
}

/**
 * Set reload flags for multiple scopes (e.g. when multiple channels are updated in one PATCH).
 */
export async function setReloadFlags(
  redisUrl: string,
  scopes: ReloadScope[],
): Promise<void> {
  const url = redisUrl?.trim();
  if (!url || scopes.length === 0) return;
  initRedis(redisUrl);
  const r = getRedis();
  if (!r) return;
  await Promise.all(scopes.map((scope) => r.set(key(scope), "1")));
}

/**
 * Start watching the given scopes and invoke onReload when any of them is set, then clear those keys.
 * Each worker passes only the scope(s) it cares about (e.g. slack worker passes ['slack']).
 */
export function initReloadWatch(
  redisUrl: string,
  scopes: ReloadScope[],
  onReload: () => void | Promise<void>,
): void {
  const url = redisUrl.trim();
  if (!url || scopes.length === 0) return;

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  initRedis(redisUrl);
  const redis = getRedis();
  if (!redis) return;

  const keys = scopes.map(key);

  pollTimer = setInterval(async () => {
    try {
      const values = await redis.mget(...keys);
      const hit = values.some((v) => v === "1");
      if (hit) {
        await redis.del(...keys);
        await onReload();
      }
    } catch {
      // keep polling on error
    }
  }, POLL_MS);
}

/**
 * Stop watching. Does not close the Redis client; call closeRedis() on shutdown.
 */
export async function closeReloadWatch(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
