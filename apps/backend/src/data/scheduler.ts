/**
 * Schedule types and API contract. Persistence is in lib/data/schedule-store.
 * The cron worker owns node-schedule and loads from the store; it watches
 * the Redis reload flag and reloads when the API sets it (add/remove schedule
 * or channels update).
 */

export interface ScheduledTask {
  id: string;
  execute_at?: string; // ISO; required for one-shot, absent for recurring
  intent: string;
  context: Record<string, unknown>;
  cron?: string; // when set, task is recurring
}

/** API-facing schedule CRUD. Implemented by the API using ScheduleStore; cron worker loads from store and runs jobs. */
export interface ScheduleService {
  list(): Promise<ScheduledTask[]>;
  schedule(task: Omit<ScheduledTask, "id">): Promise<string>;
  cancel(id: string): Promise<boolean>;
}
