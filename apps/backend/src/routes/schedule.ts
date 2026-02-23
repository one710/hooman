import type { Express, Request, Response } from "express";
import type { AppContext } from "../utils/helpers.js";
import { getParam } from "../utils/helpers.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { getConfig } from "../config.js";

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
      if (cronStr && !executeAtStr) {
        // Validation now happens inside scheduler.schedule()
      }

      try {
        const id = await scheduler.schedule({
          intent: typeof intent === "string" ? intent : String(intent),
          context: typeof context === "object" ? context : {},
          ...(executeAtStr ? { execute_at: executeAtStr } : {}),
          ...(cronStr ? { cron: cronStr } : {}),
        });
        res.status(201).json({
          id,
          intent: typeof intent === "string" ? intent : String(intent),
          context: context ?? {},
          ...(executeAtStr ? { execute_at: executeAtStr } : {}),
          ...(cronStr ? { cron: cronStr } : {}),
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Schedule failed.",
        });
      }
    },
  );

  app.patch(
    "/api/schedule/:id",
    async (req: Request, res: Response): Promise<void> => {
      if (getKillSwitchEnabled()) {
        res.status(503).json({
          error: `${getConfig().AGENT_NAME} is paused (kill switch).`,
        });
        return;
      }
      const id = getParam(req, "id");
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

      try {
        const ok = await scheduler.update(id, {
          intent: typeof intent === "string" ? intent : String(intent),
          context: typeof context === "object" ? context : {},
          ...(executeAtStr ? { execute_at: executeAtStr } : {}),
          ...(cronStr ? { cron: cronStr } : {}),
        });
        if (!ok) {
          res.status(404).json({ error: "Scheduled task not found." });
          return;
        }
        res.status(200).json({
          id,
          intent: typeof intent === "string" ? intent : String(intent),
          context: context ?? {},
          ...(executeAtStr ? { execute_at: executeAtStr } : {}),
          ...(cronStr ? { cron: cronStr } : {}),
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Schedule failed.",
        });
      }
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
      res.status(204).send();
    },
  );
}
