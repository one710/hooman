import type { Express, Request, Response } from "express";
import type { AppContext } from "./helpers.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";

export function registerInternalRoutes(app: Express, _ctx: AppContext): void {
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", killSwitch: getKillSwitchEnabled() });
  });
}
