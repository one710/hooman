import { getPrisma } from "../data/db.js";
import type { ScheduledTask } from "../types.js";

export interface ScheduleStore {
  getAll(): Promise<ScheduledTask[]>;
  add(task: ScheduledTask): Promise<void>;
  update(id: string, task: Omit<ScheduledTask, "id">): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

function parseContext(s: string | null): Record<string, unknown> {
  if (s == null || s === "") return {};
  try {
    const o = JSON.parse(s) as unknown;
    return o && typeof o === "object" && !Array.isArray(o)
      ? (o as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function initScheduleStore(): Promise<ScheduleStore> {
  const prisma = getPrisma();

  return {
    async getAll(): Promise<ScheduledTask[]> {
      const rows = await prisma.schedule.findMany({
        orderBy: [{ execute_at: "asc" }, { id: "asc" }],
      });
      return rows.map((r: any): ScheduledTask => {
        const cronRaw = (r as { cron?: string | null }).cron;
        const cron = cronRaw != null && cronRaw !== "" ? cronRaw : undefined;
        const executeAt =
          (r as { execute_at?: string | null }).execute_at ?? undefined;
        return {
          id: r.id,
          ...(executeAt !== undefined && executeAt !== ""
            ? { execute_at: executeAt }
            : {}),
          intent: r.intent,
          context: parseContext(r.context),
          ...(cron !== undefined ? { cron } : {}),
        };
      });
    },

    async add(task: ScheduledTask): Promise<void> {
      await prisma.schedule.create({
        data: {
          id: task.id,
          intent: task.intent,
          context: JSON.stringify(task.context ?? {}),
          execute_at: task.execute_at ?? null,
          cron: task.cron ?? null,
        },
      });
    },

    async update(
      id: string,
      task: Omit<ScheduledTask, "id">,
    ): Promise<boolean> {
      const result = await prisma.schedule.updateMany({
        where: { id },
        data: {
          intent: task.intent,
          context: JSON.stringify(task.context ?? {}),
          execute_at: task.execute_at ?? null,
          cron: task.cron ?? null,
        },
      });
      return (result.count ?? 0) > 0;
    },

    async remove(id: string): Promise<boolean> {
      const result = await prisma.schedule.deleteMany({ where: { id } });
      return (result.count ?? 0) > 0;
    },
  };
}
