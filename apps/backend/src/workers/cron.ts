/**
 * Cron worker: runs node-schedule for user scheduled tasks.
 * Dispatches to API via POST /api/internal/dispatch. Loads tasks from DB; watches
 * Redis reload flag and reloads tasks when API sets it (schedule).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only cron).
 */
import createDebug from "debug";
import schedule from "node-schedule";
import { mkdirSync } from "fs";
import { loadPersisted } from "../config.js";
import { createDispatchClient } from "../dispatch-client.js";
import type { RawDispatchInput } from "../types.js";
import type { ScheduledTask } from "../data/scheduler.js";
import type { ScheduleStore } from "../data/schedule-store.js";
import { initScheduleStore } from "../data/schedule-store.js";
import { initDb } from "../data/db.js";
import { initRedis, closeRedis } from "../data/redis.js";
import { initReloadWatch, closeReloadWatch } from "../data/reload-flag.js";
import { env } from "../env.js";
import { WORKSPACE_ROOT } from "../workspace.js";

const debug = createDebug("hooman:workers:cron");

type Job = ReturnType<typeof schedule.scheduleJob>;

function runCronScheduler(
  store: ScheduleStore,
  dispatch: (raw: RawDispatchInput) => void | Promise<void>,
): {
  load: () => Promise<void>;
  stop: () => void;
  reload: () => Promise<void>;
} {
  const jobs = new Map<string, Job>();

  async function runTask(t: ScheduledTask): Promise<void> {
    if (!t.cron) {
      await store.remove(t.id);
    }
    await dispatch({
      source: "scheduler",
      type: "task.scheduled",
      payload: {
        intent: t.intent,
        context: t.context,
        ...(t.execute_at ? { execute_at: t.execute_at } : {}),
        ...(t.cron ? { cron: t.cron } : {}),
      },
    });
  }

  function scheduleOne(t: ScheduledTask): void {
    const isRecurring = typeof t.cron === "string" && t.cron.trim() !== "";

    if (isRecurring) {
      try {
        const job = schedule.scheduleJob(t.id, t.cron!.trim(), () => {
          void runTask(t);
        });
        if (job) jobs.set(t.id, job);
      } catch (err) {
        debug("Invalid cron for task %s: %s", t.id, (err as Error).message);
      }
      return;
    }

    const executeAt = t.execute_at;
    if (!executeAt) {
      debug("Skipping task %s: one-shot with no execute_at", t.id);
      return;
    }
    const at = new Date(executeAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      void runTask(t);
      return;
    }
    const job = schedule.scheduleJob(t.id, at, () => {
      jobs.delete(t.id);
      void runTask(t);
    });
    if (job) jobs.set(t.id, job);
  }

  async function load(): Promise<void> {
    const tasks = await store.getAll();
    const oneShot = tasks.filter(
      (t) => (!t.cron || t.cron.trim() === "") && t.execute_at,
    );
    const recurring = tasks.filter((t) => t.cron && t.cron.trim() !== "");
    oneShot.sort(
      (a, b) =>
        new Date(a.execute_at!).getTime() - new Date(b.execute_at!).getTime(),
    );
    for (const t of [...oneShot, ...recurring]) scheduleOne(t);
    debug("Cron loaded %d scheduled task(s)", tasks.length);
  }

  function stop(): void {
    for (const job of jobs.values()) job.cancel();
    jobs.clear();
  }

  async function reload(): Promise<void> {
    stop();
    await load();
  }

  return { load, stop, reload };
}

async function main() {
  await loadPersisted();
  mkdirSync(WORKSPACE_ROOT, { recursive: true });
  await initDb();

  const client = createDispatchClient({
    apiBaseUrl: env.API_BASE_URL,
    secret: env.INTERNAL_SECRET || undefined,
  });
  const dispatch = (raw: RawDispatchInput) =>
    client.dispatch(raw).then(() => {});

  const scheduleStore = await initScheduleStore();
  const scheduler = runCronScheduler(scheduleStore, dispatch);
  await scheduler.load();

  initRedis(env.REDIS_URL);

  async function onReload(): Promise<void> {
    debug("Reload flag received; reloading scheduled tasks");
    await scheduler.reload();
  }

  if (env.REDIS_URL) {
    initReloadWatch(env.REDIS_URL, ["schedule"], onReload);
    debug(
      "Cron worker started; dispatching to %s; scheduled tasks; watching Redis reload flag",
      env.API_BASE_URL,
    );
  } else {
    debug(
      "Cron worker started; dispatching to %s; scheduled tasks (no Redis, no reload watch)",
      env.API_BASE_URL,
    );
  }

  const shutdown = async () => {
    await closeReloadWatch();
    scheduler.stop();
    await closeRedis();
    debug("Cron worker stopped.");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  debug("Cron worker failed: %o", err);
  process.exit(1);
});
