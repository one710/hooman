import type { Express, Request, Response } from "express";
import createDebug from "debug";
import multer from "multer";
import { randomUUID } from "crypto";
import type { AppContext } from "./helpers.js";
import { getParam } from "./helpers.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { getConfig } from "../config.js";

const debug = createDebug("hooman:routes:chat");

export function registerChatRoutes(app: Express, ctx: AppContext): void {
  const { enqueue, context, auditLog, attachmentStore } = ctx;
  const upload = multer({ storage: multer.memoryStorage() });

  app.get("/api/chat/history", async (req: Request, res: Response) => {
    const userId = (req.query.userId as string) || "default";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(String(req.query.pageSize), 10) || 50),
    );
    const result = await context.getMessages(userId, { page, pageSize });
    const messagesWithMeta = await Promise.all(
      result.messages.map(async (m) => {
        const ids = m.attachments ?? [];
        const timestamp =
          m.createdAt instanceof Date ? m.createdAt.toISOString() : undefined;
        if (ids.length === 0)
          return {
            role: m.role,
            text: m.text,
            attachments: m.attachments,
            ...(timestamp != null ? { timestamp } : {}),
          };
        const attachment_metas = await Promise.all(
          ids.map(async (id) => {
            const doc = await attachmentStore.getById(id, userId);
            return doc
              ? { id, originalName: doc.originalName, mimeType: doc.mimeType }
              : null;
          }),
        );
        return {
          role: m.role,
          text: m.text,
          attachments: m.attachments,
          attachment_metas: attachment_metas.filter(
            (a): a is { id: string; originalName: string; mimeType: string } =>
              a !== null,
          ),
          ...(timestamp != null ? { timestamp } : {}),
        };
      }),
    );
    res.json({
      messages: messagesWithMeta,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  });

  app.delete("/api/chat/history", async (req: Request, res: Response) => {
    const userId = (req.query.userId as string) || "default";
    await context.clearAll(userId);
    res.json({ cleared: true });
  });

  app.post(
    "/api/chat/attachments",
    upload.array("files", 10),
    async (req: Request, res: Response) => {
      const userId = "default";
      const files = (req as Request & { files?: Express.Multer.File[] }).files;
      if (!Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: "No files uploaded." });
        return;
      }
      try {
        const result = await Promise.all(
          files.map((f) =>
            attachmentStore.save(userId, {
              buffer: f.buffer,
              originalname: f.originalname,
              mimetype: f.mimetype || "application/octet-stream",
            }),
          ),
        );
        res.json({ attachments: result });
      } catch (err) {
        debug("attachment upload error: %o", err);
        res.status(500).json({ error: "Failed to store attachments." });
      }
    },
  );

  app.get("/api/chat/attachments/:id", async (req: Request, res: Response) => {
    const id = getParam(req, "id");
    const userId = "default";
    const doc = await attachmentStore.getById(id, userId);
    if (!doc) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const buffer = await attachmentStore.getBuffer(id, userId);
    if (!buffer) {
      res.status(404).json({ error: "Attachment file not found." });
      return;
    }
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(doc.originalName)}"`,
    );
    res.send(buffer);
  });

  app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
    if (getKillSwitchEnabled()) {
      res
        .status(503)
        .json({ error: `${getConfig().AGENT_NAME} is paused (kill switch).` });
      return;
    }
    const text = req.body?.text as string;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Missing or invalid 'text'." });
      return;
    }
    const rawIds = req.body?.attachments;
    const attachmentIds = Array.isArray(rawIds)
      ? ((rawIds as unknown[]).filter(
          (id) => typeof id === "string",
        ) as string[])
      : undefined;

    let attachmentContents:
      | Array<{ name: string; contentType: string; data: string }>
      | undefined;
    if (attachmentIds?.length) {
      const userId = "default";
      const resolved = await Promise.all(
        attachmentIds.map(async (id) => {
          const doc = await attachmentStore.getById(id, userId);
          const buffer = doc
            ? await attachmentStore.getBuffer(id, userId)
            : null;
          if (!doc || !buffer) return null;
          return {
            name: doc.originalName,
            contentType: doc.mimeType,
            data: buffer.toString("base64"),
          };
        }),
      );
      attachmentContents = resolved.filter(
        (a): a is { name: string; contentType: string; data: string } =>
          a !== null,
      );
    }

    const eventId = randomUUID();
    const userId = "default";

    await enqueue(
      {
        source: "api",
        type: "message.sent",
        payload: {
          text,
          userId,
          ...(attachmentContents?.length ? { attachmentContents } : {}),
          ...(attachmentIds?.length ? { attachments: attachmentIds } : {}),
        },
      },
      { correlationId: eventId },
    );

    res.status(202).json({ eventId });
  });

  app.get("/api/chat/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const unsub = auditLog.onResponseReceived(
      (payload: { type: string; text?: string }) => {
        if (payload.type === "response") {
          res.write(
            `data: ${JSON.stringify({ type: "response", text: payload.text })}\n\n`,
          );
          res.flushHeaders?.();
        }
      },
    );
    req.on("close", () => unsub());
  });
}
