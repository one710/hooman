import type { Express, Request, Response } from "express";
import schedule from "node-schedule";
import type { AppContext } from "./helpers.js";
import { getParam } from "./helpers.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { getConfig } from "../config.js";
import { setReloadFlag } from "../data/reload-flag.js";
import { env } from "../env.js";

function validateCron(cron: string): boolean {
  try {
    const job = schedule.scheduleJob("_validate", cron.trim(), () => {});
    if (job) job.cancel();
    return true;
  } catch {
    return false;
  }
}

export function registerScheduleRoutes(app: Express, ctx: AppContext): void {
  const { scheduler } = ctx;

  app.get("/api/schedule", async (_req: Request, res: Response) => {
    const tasks = await scheduler.list();
    res.json({ tasks });
  });

  app.post(
    "/api/schedule",
    async (req: Request, res: Response): Promise<void> => {
      if (getKillSwitchEnabled()) {
        res.status(503).json({
          error: `${getConfig().AGENT_NAME} is paused (kill switch).`,
        });
        return;
      }
      const { execute_at, intent, context, cron } = req.body ?? {};
      const cronStr =
        typeof cron === "string" && cron.trim() !== ""
          ? cron.trim()
          : undefined;
      const executeAtStr =
        typeof execute_at === "string" && execute_at.trim() !== ""
          ? execute_at.trim()
          : undefined;

      if (!intent || typeof intent !== "string") {
        res.status(400).json({ error: "Missing intent." });
        return;
      }
      if (!executeAtStr && !cronStr) {
        res.status(400).json({
          error: "Provide either execute_at (one-shot) or cron (recurring).",
        });
        return;
      }
      if (cronStr && !validateCron(cronStr)) {
        res.status(400).json({ error: "Invalid cron expression." });
        return;
      }

      const id = await scheduler.schedule({
        intent: typeof intent === "string" ? intent : String(intent),
        context: typeof context === "object" ? context : {},
        ...(executeAtStr ? { execute_at: executeAtStr } : {}),
        ...(cronStr ? { cron: cronStr } : {}),
      });
      await setReloadFlag(env.REDIS_URL, "schedule");
      res.status(201).json({
        id,
        intent: typeof intent === "string" ? intent : String(intent),
        context: context ?? {},
        ...(executeAtStr ? { execute_at: executeAtStr } : {}),
        ...(cronStr ? { cron: cronStr } : {}),
      });
    },
  );

  app.delete(
    "/api/schedule/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await scheduler.cancel(getParam(req, "id"));
      if (!ok) {
        res.status(404).json({ error: "Scheduled task not found." });
        return;
      }
      await setReloadFlag(env.REDIS_URL, "schedule");
      res.status(204).send();
    },
  );
}
