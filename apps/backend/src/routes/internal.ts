import type { Express, Request, Response } from "express";
import type { AppContext } from "../utils/helpers.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { getRedis } from "../data/redis.js";
import { Queue } from "bullmq";
import { env } from "../env.js";

interface ServiceStatus {
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
}

async function checkRedis(): Promise<ServiceStatus> {
  const start = Date.now();
  const redis = getRedis();
  if (!redis) return { status: "error", error: "Not initialized" };
  try {
    const pong = await redis.ping();
    return {
      status: pong === "PONG" ? "ok" : "error",
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

async function checkChroma(): Promise<ServiceStatus> {
  const start = Date.now();
  const url = env.CHROMA_URL;
  if (!url) return { status: "error", error: "CHROMA_URL not configured" };
  // ChromaDB v2 uses /api/v2/heartbeat, v1 uses /api/v1/heartbeat
  const endpoints = [`${url}/api/v2/heartbeat`, `${url}/api/v1/heartbeat`];
  try {
    for (const endpoint of endpoints) {
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return { status: "ok", latencyMs: Date.now() - start };
      }
    }
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: "All heartbeat endpoints failed",
    };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

async function checkEventQueueWorker(): Promise<ServiceStatus> {
  const start = Date.now();
  const redis = getRedis();
  if (!redis) return { status: "error", error: "Redis not initialized" };
  try {
    const queue = new Queue("hooman-events", { connection: redis });
    try {
      const workers = await queue.getWorkers();
      return {
        status: workers.length > 0 ? "ok" : "error",
        latencyMs: Date.now() - start,
        ...(workers.length === 0 ? { error: "No active workers" } : {}),
      };
    } finally {
      await queue.close();
    }
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

export function registerInternalRoutes(app: Express, _ctx: AppContext): void {
  app.get("/health", async (_req: Request, res: Response) => {
    const [redis, chroma, eventQueue] = await Promise.all([
      checkRedis(),
      checkChroma(),
      checkEventQueueWorker(),
    ]);

    const allOk =
      redis.status === "ok" &&
      chroma.status === "ok" &&
      eventQueue.status === "ok";

    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ok" : "degraded",
      killSwitch: getKillSwitchEnabled(),
      services: { redis, chroma, eventQueue },
    });
  });
}
