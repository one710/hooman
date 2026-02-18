import { getPrisma } from "./db.js";

export interface ScheduledTaskDoc {
  id: string;
  execute_at?: string;
  intent: string;
  context: Record<string, unknown>;
  cron?: string;
}

export interface ScheduleStore {
  getAll(): Promise<ScheduledTaskDoc[]>;
  add(task: ScheduledTaskDoc): Promise<void>;
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
    async getAll(): Promise<ScheduledTaskDoc[]> {
      const rows = await prisma.schedule.findMany({
        orderBy: [{ execute_at: "asc" }, { id: "asc" }],
      });
      return rows.map((r): ScheduledTaskDoc => {
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

    async add(task: ScheduledTaskDoc): Promise<void> {
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

    async remove(id: string): Promise<boolean> {
      const result = await prisma.schedule.deleteMany({ where: { id } });
      return (result.count ?? 0) > 0;
    },
  };
}
