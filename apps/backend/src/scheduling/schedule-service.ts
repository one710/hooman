import { randomUUID } from "crypto";
import schedule from "node-schedule";
import type { ScheduledTask } from "../types.js";
import type { ScheduleStore } from "./schedule-store.js";

import { setReloadFlag } from "../utils/reload-flag.js";

function validateCron(cron: string): boolean {
  try {
    const job = schedule.scheduleJob("_validate", cron.trim(), () => {});
    if (job) job.cancel();
    return true;
  } catch {
    return false;
  }
}

/** API-facing schedule service. Centralizes domain logic (validation, UUIDs, reload triggering) and persistence via ScheduleStore. The cron worker loads from the same store to run jobs. */
export interface ScheduleService {
  list(): Promise<ScheduledTask[]>;
  schedule(task: Omit<ScheduledTask, "id">): Promise<string>;
  update(id: string, task: Omit<ScheduledTask, "id">): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
}

export function createScheduleService(store: ScheduleStore): ScheduleService {
  return {
    async list(): Promise<ScheduledTask[]> {
      return store.getAll();
    },

    async schedule(task: Omit<ScheduledTask, "id">): Promise<string> {
      if (task.cron && !validateCron(task.cron)) {
        throw new Error("Invalid cron expression.");
      }
      const id = randomUUID();
      await store.add({ ...task, id });
      await setReloadFlag("schedule");
      return id;
    },

    async update(
      id: string,
      task: Omit<ScheduledTask, "id">,
    ): Promise<boolean> {
      if (task.cron && !validateCron(task.cron)) {
        throw new Error("Invalid cron expression.");
      }
      const ok = await store.update(id, task);
      if (ok) {
        await setReloadFlag("schedule");
      }
      return ok;
    },

    async cancel(id: string): Promise<boolean> {
      const ok = await store.remove(id);
      if (ok) {
        await setReloadFlag("schedule");
      }

      return ok;
    },
  };
}
