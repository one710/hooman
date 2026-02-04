import type { IncomingEvent } from "../types/index.js";
import { randomUUID } from "crypto";
import type { ScheduleStore } from "../schedule-store/index.js";

export interface ScheduledTask {
  id: string;
  execute_at: string; // ISO
  intent: string;
  context: Record<string, unknown>;
}

export type ScheduleEmit = (event: IncomingEvent) => void;

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private emit: ScheduleEmit;
  private store: ScheduleStore;

  constructor(emit: ScheduleEmit, store: ScheduleStore) {
    this.emit = emit;
    this.store = store;
  }

  /** Load persisted tasks from store. Call once after construction before start(). */
  async load(): Promise<void> {
    this.tasks = await this.store.getAll();
    this.tasks.sort(
      (a, b) =>
        new Date(a.execute_at).getTime() - new Date(b.execute_at).getTime(),
    );
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async schedule(task: Omit<ScheduledTask, "id">): Promise<string> {
    const id = randomUUID();
    const doc = { ...task, id };
    await this.store.add(doc);
    this.tasks.push(doc);
    this.tasks.sort(
      (a, b) =>
        new Date(a.execute_at).getTime() - new Date(b.execute_at).getTime(),
    );
    return id;
  }

  async cancel(id: string): Promise<boolean> {
    const ok = await this.store.remove(id);
    if (ok) this.tasks = this.tasks.filter((t) => t.id !== id);
    return ok;
  }

  list(): ScheduledTask[] {
    return [...this.tasks];
  }

  private async tick(): Promise<void> {
    const now = new Date().toISOString();
    const due = this.tasks.filter((t) => t.execute_at <= now);
    for (const t of due) {
      this.tasks = this.tasks.filter((x) => x.id !== t.id);
      await this.store.remove(t.id);
      this.emit({
        id: randomUUID(),
        source: "scheduler",
        type: "task.scheduled",
        payload: {
          execute_at: t.execute_at,
          intent: t.intent,
          context: t.context,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }
}
