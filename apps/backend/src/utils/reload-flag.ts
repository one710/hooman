/**
 * Redis-backed reload notifications per scope using pub/sub (no polling timers).
 * Scopes: schedule, slack, whatsapp, mcp.
 * Publishers call setReloadFlag/setReloadFlags → publishes to hooman:reload:<scope>.
 * Subscribers call initReloadWatch → subscribes to the relevant channels.
 * Call initRedis() before using.
 */
import { getRedis } from "../data/redis.js";
import { createSubscriber, type Subscriber } from "./pubsub.js";

export type ReloadScope = "schedule" | "slack" | "whatsapp" | "mcp";

const CHANNEL_PREFIX = "hooman:reload:";

function channel(scope: ReloadScope): string {
  return CHANNEL_PREFIX + scope;
}

let subscriber: Subscriber | null = null;

/**
 * Publish a reload notification for a scope. No-op if Redis is not initialized.
 */
export async function setReloadFlag(scope: ReloadScope): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.publish(channel(scope), "reload");
}

/**
 * Publish reload notifications for multiple scopes.
 */
export async function setReloadFlags(scopes: ReloadScope[]): Promise<void> {
  const redis = getRedis();
  if (!redis || scopes.length === 0) return;
  await Promise.all(scopes.map((s) => redis.publish(channel(s), "reload")));
}

/**
 * Subscribe to the given scopes and invoke onReload when any notification arrives.
 * Replaces the previous polling-based approach with instant pub/sub.
 */
export function initReloadWatch(
  scopes: ReloadScope[],
  onReload: () => void | Promise<void>,
): void {
  if (scopes.length === 0) return;

  if (subscriber) {
    for (const s of scopes) subscriber.unsubscribe(channel(s));
    subscriber.close().catch(() => {});
    subscriber = null;
  }

  subscriber = createSubscriber();
  if (!subscriber) return;

  for (const s of scopes) {
    subscriber.subscribe(channel(s), () => {
      void onReload();
    });
  }
}

/**
 * Stop watching. Does not close the Redis client; call closeRedis() on shutdown.
 */
export async function closeReloadWatch(): Promise<void> {
  if (subscriber) {
    await subscriber.close();
    subscriber = null;
  }
}
