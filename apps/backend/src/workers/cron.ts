/**
 * Cron worker: runs node-schedule for user scheduled tasks.
 * Enqueues events directly to BullMQ. Loads tasks from DB; watches
 * Redis reload flag and reloads tasks when API sets it (schedule).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only cron).
 */
import createDebug from "debug";
import schedule from "node-schedule";
import { mkdirSync } from "fs";
import { loadPersisted } from "../config.js";
import { createEventQueue } from "../events/event-queue.js";
import { createQueueDispatcher } from "../events/enqueue.js";
import type { RawDispatchInput } from "../types.js";
import { initDb } from "../data/db.js";
import { initRedis, closeRedis } from "../data/redis.js";
import { initReloadWatch, closeReloadWatch } from "../utils/reload-flag.js";
import { initScheduleStore } from "../scheduling/schedule-store.js";
import type { ScheduleStore } from "../scheduling/schedule-store.js";
import type { ScheduledTask } from "../types.js";
import { env } from "../env.js";
import { WORKSPACE_ROOT } from "../utils/workspace.js";

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
      (t: ScheduledTask) => (!t.cron || t.cron.trim() === "") && t.execute_at,
    );
    const recurring = tasks.filter(
      (t: ScheduledTask) => t.cron && t.cron.trim() !== "",
    );
    oneShot.sort(
      (a: ScheduledTask, b: ScheduledTask) =>
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

  if (!env.REDIS_URL) {
    debug("Cron worker requires REDIS_URL to enqueue events");
    process.exit(1);
  }
  initRedis(env.REDIS_URL);
  const eventQueue = createEventQueue({ connection: env.REDIS_URL });
  const dispatcher = createQueueDispatcher(eventQueue);
  const dispatch = (raw: RawDispatchInput) =>
    dispatcher.dispatch(raw).then(() => {});

  const scheduleStore = await initScheduleStore();
  const scheduler = runCronScheduler(scheduleStore, dispatch);
  await scheduler.load();

  async function onReload(): Promise<void> {
    debug("Reload flag received; reloading scheduled tasks");
    await scheduler.reload();
  }

  initReloadWatch(["schedule"], onReload);
  debug(
    "Cron worker started; enqueuing to BullMQ; scheduled tasks; watching Redis reload flag",
  );

  const shutdown = async () => {
    await closeReloadWatch();
    scheduler.stop();
    await eventQueue.close();
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
