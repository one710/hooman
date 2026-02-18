import type { Express, Request, Response } from "express";
import createDebug from "debug";
import type { AppContext } from "./helpers.js";
import type { RawDispatchInput } from "../types.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { env } from "../env.js";

const debug = createDebug("hooman:routes:internal");

export function registerInternalRoutes(app: Express, ctx: AppContext): void {
  const { eventRouter, auditLog, io, responseStore } = ctx;

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", killSwitch: getKillSwitchEnabled() });
  });

  app.post("/api/internal/dispatch", async (req: Request, res: Response) => {
    const secret = env.INTERNAL_SECRET;
    if (secret != null && secret !== "") {
      const header = req.headers["x-internal-secret"];
      if (header !== secret) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
    const body = req.body as RawDispatchInput;
    if (
      !body ||
      typeof body.source !== "string" ||
      typeof body.type !== "string" ||
      !body.payload ||
      typeof body.payload !== "object"
    ) {
      res
        .status(400)
        .json({ error: "Invalid body: need source, type, payload" });
      return;
    }
    try {
      const id = await eventRouter.dispatch(
        {
          source: body.source,
          type: body.type,
          payload: body.payload,
          priority: body.priority,
        },
        {},
      );
      res.json({ id });
    } catch (err) {
      debug("internal dispatch error: %o", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/internal/chat-result", async (req: Request, res: Response) => {
    const secret = env.INTERNAL_SECRET;
    if (secret != null && secret !== "") {
      const header = req.headers["x-internal-secret"];
      if (header !== secret) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
    const body = req.body as {
      eventId: string;
      message: { role: "assistant"; text: string };
    };
    if (
      !body ||
      typeof body.eventId !== "string" ||
      !body.message ||
      typeof body.message.text !== "string"
    ) {
      res
        .status(400)
        .json({ error: "Invalid body: need eventId, message { text }" });
      return;
    }
    io.emit("chat-result", { eventId: body.eventId, message: body.message });
    const list = responseStore.get(body.eventId) ?? [];
    list.push({ role: "assistant", text: body.message.text });
    responseStore.set(body.eventId, list);
    auditLog.emitResponse({
      type: "response",
      text: body.message.text,
      eventId: body.eventId,
    });
    res.json({ ok: true });
  });
}
