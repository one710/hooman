/**
 * Cron worker: runs node-schedule for (1) user scheduled tasks and (2) email IMAP poll.
 * Dispatches to API via POST /api/internal/dispatch. Loads tasks from DB; watches
 * Redis reload flag and reloads tasks + email job when API sets it (schedule/channels).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only cron).
 */
import createDebug from "debug";
import schedule from "node-schedule";
import { mkdirSync } from "fs";
import { loadPersisted, getChannelsConfig } from "../lib/core/config.js";
import { createDispatchClient } from "../lib/api/dispatch-client.js";
import type { RawDispatchInput } from "../lib/core/types.js";
import type { ScheduledTask } from "../lib/schedule/scheduler.js";
import type { ScheduleStore } from "../lib/data/schedule-store.js";
import { initScheduleStore } from "../lib/data/schedule-store.js";
import { initDb } from "../lib/data/db.js";
import { initRedis, closeRedis } from "../lib/data/redis.js";
import {
  initReloadWatch,
  closeReloadWatch,
} from "../lib/schedule/reload-flag.js";
import { runEmailPoll } from "../lib/channels/email-adapter.js";
import { runJiraPoll } from "../lib/channels/jira-adapter.js";
import { env } from "../env.js";
import { WORKSPACE_ROOT } from "../lib/core/workspace.js";

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
    await store.remove(t.id);
    await dispatch({
      source: "scheduler",
      type: "task.scheduled",
      payload: {
        execute_at: t.execute_at,
        intent: t.intent,
        context: t.context,
      },
    });
  }

  function scheduleOne(t: ScheduledTask): void {
    const at = new Date(t.execute_at);
    if (at.getTime() <= Date.now()) {
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
    tasks.sort(
      (a, b) =>
        new Date(a.execute_at).getTime() - new Date(b.execute_at).getTime(),
    );
    for (const t of tasks) scheduleOne(t);
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

const EMAIL_JOB_ID = "email-poll";
const JIRA_JOB_ID = "jira-poll";

function runEmailJob(client: ReturnType<typeof createDispatchClient>): {
  start: () => void;
  stop: () => void;
} {
  let job: ReturnType<typeof schedule.scheduleJob> | null = null;

  function stop(): void {
    if (job) {
      job.cancel();
      job = null;
      debug("Email poll job stopped");
    }
  }

  function start(): void {
    stop();
    const config = getChannelsConfig().email;
    if (
      !config?.enabled ||
      !config.imap?.host?.trim() ||
      !config.imap?.user?.trim()
    ) {
      if (config?.enabled)
        debug(
          "Email channel enabled but IMAP host/user missing; poll not started",
        );
      return;
    }
    runEmailPoll(client, config);
    const intervalMs = Math.max(60_000, config.pollIntervalMs ?? 60_000);
    const intervalMinutes = intervalMs / 60_000;
    const cron = `0 */${Math.max(1, Math.floor(intervalMinutes))} * * * *`;
    job = schedule.scheduleJob(EMAIL_JOB_ID, cron, () => {
      runEmailPoll(client, getChannelsConfig().email);
    });
    debug(
      "Email channel on; polling every %s min (next at minute 0)",
      intervalMinutes,
    );
  }

  return { start, stop };
}

function runJiraJob(client: ReturnType<typeof createDispatchClient>): {
  start: () => void;
  stop: () => void;
} {
  let job: ReturnType<typeof schedule.scheduleJob> | null = null;

  function stop(): void {
    if (job) {
      job.cancel();
      job = null;
      debug("Jira poll job stopped");
    }
  }

  function start(): void {
    stop();
    const config = getChannelsConfig().jira;
    if (
      !config?.enabled ||
      !config.baseUrl?.trim() ||
      !config.email?.trim() ||
      !config.apiToken?.trim()
    ) {
      if (config?.enabled)
        debug(
          "Jira channel enabled but baseUrl/email/apiToken missing; poll not started",
        );
      return;
    }
    void runJiraPoll(client, config);
    const intervalMs = Math.max(60_000, config.pollIntervalMs ?? 300_000);
    const intervalMinutes = intervalMs / 60_000;
    const cron = `0 */${Math.max(1, Math.floor(intervalMinutes))} * * * *`;
    job = schedule.scheduleJob(JIRA_JOB_ID, cron, () => {
      void runJiraPoll(client, getChannelsConfig().jira);
    });
    debug(
      "Jira channel on; polling every %s min (next at minute 0)",
      intervalMinutes,
    );
  }

  return { start, stop };
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
  const emailJob = runEmailJob(client);
  const jiraJob = runJiraJob(client);
  emailJob.start();
  jiraJob.start();

  async function onReload(): Promise<void> {
    debug("Reload flag received; reloading scheduled tasks and channel polls");
    await scheduler.reload();
    emailJob.start();
    jiraJob.start();
  }

  if (env.REDIS_URL) {
    initReloadWatch(env.REDIS_URL, ["schedule", "email", "jira"], onReload);
    debug(
      "Cron worker started; dispatching to %s; email + Jira poll + scheduled tasks; watching Redis reload flag",
      env.API_BASE_URL,
    );
  } else {
    debug(
      "Cron worker started; dispatching to %s; email + Jira poll + scheduled tasks (no Redis, no reload watch)",
      env.API_BASE_URL,
    );
  }

  const shutdown = async () => {
    await closeReloadWatch();
    scheduler.stop();
    emailJob.stop();
    jiraJob.stop();
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
