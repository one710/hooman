import type { Express, Request, Response } from "express";
import createDebug from "debug";
import type { EventRouter } from "./lib/event-router/index.js";

const debug = createDebug("hooman:chat");
import type { ContextStore } from "./lib/context/index.js";
import type { AuditLog } from "./lib/audit/index.js";
import type { ColleagueEngine } from "./lib/colleagues/index.js";
import type { Scheduler } from "./lib/scheduler/index.js";
import type { MCPConnectionsStore } from "./lib/mcp-connections/store.js";
import type { AttachmentStore } from "./lib/attachment-store/index.js";
import type {
  ColleagueConfig,
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "./lib/types/index.js";
import { randomUUID } from "crypto";
import multer from "multer";
import { getConfig, updateConfig } from "./config.js";
import {
  listSkillsFromFs,
  getSkillContent,
  addSkill,
  removeSkills,
} from "./lib/skills-cli/index.js";

interface AppContext {
  eventRouter: EventRouter;
  context: ContextStore;
  auditLog: AuditLog;
  colleagueEngine: ColleagueEngine;
  responseStore: Map<
    string,
    Array<{ role: "user" | "assistant"; text: string }>
  >;
  scheduler: Scheduler;
  pendingChatResults: Map<
    string,
    {
      resolve: (value: {
        eventId: string;
        message: {
          role: "assistant";
          text: string;
          lastAgentName?: string;
        };
      }) => void;
      reject: (reason: unknown) => void;
    }
  >;
  mcpConnectionsStore: MCPConnectionsStore;
  attachmentStore: AttachmentStore;
}

let killSwitchEnabled = false;

function getParam(req: Request, key: string): string {
  const v = req.params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function registerRoutes(app: Express, ctx: AppContext): void {
  const {
    eventRouter,
    context,
    auditLog,
    colleagueEngine,
    scheduler,
    pendingChatResults,
    mcpConnectionsStore,
    attachmentStore,
  } = ctx;

  const upload = multer({ storage: multer.memoryStorage() });

  // Health
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", killSwitch: killSwitchEnabled });
  });

  // Configuration (Settings UI: API key, embedding model, LLM model, web search, MCP; QDRANT_URL and PORT are .env-only)
  app.get("/api/config", (_req: Request, res: Response) => {
    const c = getConfig();
    res.json({
      OPENAI_API_KEY: c.OPENAI_API_KEY,
      OPENAI_MODEL: c.OPENAI_MODEL,
      OPENAI_EMBEDDING_MODEL: c.OPENAI_EMBEDDING_MODEL,
      OPENAI_WEB_SEARCH: c.OPENAI_WEB_SEARCH,
      MCP_USE_SERVER_MANAGER: c.MCP_USE_SERVER_MANAGER,
      OPENAI_TRANSCRIPTION_MODEL: c.OPENAI_TRANSCRIPTION_MODEL,
    });
  });

  app.patch("/api/config", (req: Request, res: Response): void => {
    const patch = req.body as Record<string, unknown>;
    if (!patch || typeof patch !== "object") {
      res.status(400).json({ error: "Invalid body." });
      return;
    }
    const updated = updateConfig({
      OPENAI_API_KEY: patch.OPENAI_API_KEY as string | undefined,
      OPENAI_MODEL: patch.OPENAI_MODEL as string | undefined,
      OPENAI_EMBEDDING_MODEL: patch.OPENAI_EMBEDDING_MODEL as
        | string
        | undefined,
      OPENAI_WEB_SEARCH: patch.OPENAI_WEB_SEARCH as boolean | undefined,
      MCP_USE_SERVER_MANAGER: patch.MCP_USE_SERVER_MANAGER as
        | boolean
        | undefined,
      OPENAI_TRANSCRIPTION_MODEL: patch.OPENAI_TRANSCRIPTION_MODEL as
        | string
        | undefined,
    });
    res.json(updated);
  });

  // Ephemeral client secret for Realtime API transcription (voice input in chat)
  app.post(
    "/api/realtime/client-secret",
    async (req: Request, res: Response) => {
      const config = getConfig();
      const apiKey = config.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        res.status(400).json({
          error: "OPENAI_API_KEY not configured. Set it in Settings.",
        });
        return;
      }
      const model =
        (req.body as { model?: string })?.model ??
        config.OPENAI_TRANSCRIPTION_MODEL;
      try {
        const response = await fetch(
          "https://api.openai.com/v1/realtime/client_secrets",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expires_after: { anchor: "created_at", seconds: 300 },
              session: {
                type: "transcription",
                audio: {
                  input: {
                    format: { type: "audio/pcm", rate: 24000 },
                    noise_reduction: { type: "near_field" },
                    transcription: {
                      model: model || "gpt-4o-transcribe",
                      prompt: "",
                      language: "en",
                    },
                    turn_detection: {
                      type: "server_vad",
                      threshold: 0.5,
                      prefix_padding_ms: 300,
                      silence_duration_ms: 500,
                    },
                  },
                },
              },
            }),
          },
        );
        if (!response.ok) {
          const err = await response.text();
          debug("realtime client_secrets error: %s", err);
          res
            .status(response.status)
            .json({ error: err || "Failed to create client secret." });
          return;
        }
        const data = (await response.json()) as { value: string };
        res.json({ value: data.value });
      } catch (err) {
        debug("realtime client-secret error: %o", err);
        res
          .status(500)
          .json({ error: "Failed to create transcription session." });
      }
    },
  );

  // Chat history (context reads from MongoDB when set, else Mem0); enriches messages with attachment meta for UI
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
        const ids = m.attachment_ids ?? [];
        if (ids.length === 0)
          return {
            role: m.role,
            text: m.text,
            attachment_ids: m.attachment_ids,
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
          attachment_ids: m.attachment_ids,
          attachment_metas: attachment_metas.filter(
            (a): a is { id: string; originalName: string; mimeType: string } =>
              a !== null,
          ),
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

  // Clear chat history and Mem0 memory (via context)
  app.delete("/api/chat/history", async (req: Request, res: Response) => {
    const userId = (req.query.userId as string) || "default";
    await context.clearAll(userId);
    res.json({ cleared: true });
  });

  // Upload chat attachments (multipart); stored on server and in Mongo; returns IDs for sending with messages
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

  // Get attachment file by ID (for displaying in chat UI)
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

  // Chat: dispatch message.sent to Event Router → chat handler runs agents-runner and resolves pending (PRD: event-driven path)
  app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
    if (killSwitchEnabled) {
      res.status(503).json({ error: "Hooman is paused (kill switch)." });
      return;
    }
    const text = req.body?.text as string;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Missing or invalid 'text'." });
      return;
    }
    const rawIds = req.body?.attachment_ids;
    const attachment_ids = Array.isArray(rawIds)
      ? ((rawIds as unknown[]).filter(
          (id) => typeof id === "string",
        ) as string[])
      : undefined;

    let attachments:
      | Array<{ name: string; contentType: string; data: string }>
      | undefined;
    if (attachment_ids?.length) {
      const userId = "default";
      const resolved = await Promise.all(
        attachment_ids.map(async (id) => {
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
      attachments = resolved.filter(
        (a): a is { name: string; contentType: string; data: string } =>
          a !== null,
      );
    }

    const eventId = randomUUID();
    const userId = "default";

    const resultPromise = new Promise<{
      eventId: string;
      message: { role: "assistant"; text: string; lastAgentName?: string };
    }>((resolve, reject) => {
      pendingChatResults.set(eventId, { resolve, reject });
    });

    await eventRouter.dispatch(
      {
        source: "api",
        type: "message.sent",
        payload: {
          text,
          userId,
          ...(attachments?.length ? { attachments } : {}),
          ...(attachment_ids?.length ? { attachment_ids } : {}),
        },
      },
      { correlationId: eventId },
    );

    try {
      const result = await resultPromise;
      res.json({
        eventId: result.eventId,
        message: result.message,
      });
    } catch (err) {
      debug("chat handler error: %o", err);
      res.status(500).json({
        eventId,
        message: {
          role: "assistant" as const,
          text: "Something went wrong. Check API logs.",
        },
      });
    }
  });

  // SSE stream for live responses (optional)
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

  // Colleagues: CRUD
  app.get("/api/colleagues", (_req: Request, res: Response) => {
    res.json({ colleagues: colleagueEngine.getAll() });
  });

  app.post(
    "/api/colleagues",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as ColleagueConfig;
      if (!body?.id) {
        res.status(400).json({ error: "Missing colleague id." });
        return;
      }
      await colleagueEngine.addOrUpdate(body);
      res.status(201).json({ colleague: colleagueEngine.getById(body.id) });
    },
  );

  app.patch(
    "/api/colleagues/:id",
    async (req: Request, res: Response): Promise<void> => {
      const id = getParam(req, "id");
      const existing = colleagueEngine.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Colleague not found." });
        return;
      }
      await colleagueEngine.addOrUpdate({
        ...existing,
        ...req.body,
        id,
      });
      res.json({ colleague: colleagueEngine.getById(id) });
    },
  );

  app.delete(
    "/api/colleagues/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await colleagueEngine.remove(getParam(req, "id"));
      if (!ok) {
        res.status(404).json({ error: "Colleague not found." });
        return;
      }
      res.status(204).send();
    },
  );

  // Audit log
  app.get("/api/audit", (_req: Request, res: Response) => {
    res.json({ entries: auditLog.getAuditLog() });
  });

  // Kill switch
  app.get("/api/safety/kill-switch", (_req: Request, res: Response) => {
    res.json({ enabled: killSwitchEnabled });
  });

  app.post("/api/safety/kill-switch", (req: Request, res: Response) => {
    killSwitchEnabled = Boolean(req.body?.enabled);
    res.json({ enabled: killSwitchEnabled });
  });

  // Available capabilities from configured MCP connections (for Colleagues dropdown)
  app.get(
    "/api/capabilities/available",
    async (_req: Request, res: Response) => {
      const connections = await mcpConnectionsStore.getAll();
      const capabilities = connections.map((c) => ({
        integrationId: c.id,
        capability:
          c.type === "hosted"
            ? c.server_label || c.id
            : (c as { name?: string }).name || c.id,
      }));
      res.json({ capabilities });
    },
  );

  // MCP connections (Hosted, Streamable HTTP, Stdio)
  app.get("/api/mcp/connections", async (_req: Request, res: Response) => {
    const connections = await mcpConnectionsStore.getAll();
    res.json({ connections });
  });

  app.post(
    "/api/mcp/connections",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as Partial<MCPConnection> & { id?: string };
      if (!body?.type) {
        res.status(400).json({ error: "Missing connection type." });
        return;
      }
      const id = body.id?.trim() || randomUUID();
      const created_at = new Date().toISOString();
      let conn: MCPConnection;
      if (body.type === "hosted") {
        const serverUrl =
          typeof body.server_url === "string" ? body.server_url.trim() : "";
        if (!serverUrl) {
          res
            .status(400)
            .json({ error: "Server URL is required for hosted MCP." });
          return;
        }
        const c: MCPConnectionHosted = {
          id,
          type: "hosted",
          server_label: body.server_label ?? "",
          server_url: serverUrl,
          require_approval: body.require_approval ?? "never",
          streaming: body.streaming ?? false,
          created_at,
        };
        conn = c;
      } else if (body.type === "streamable_http") {
        const c: MCPConnectionStreamableHttp = {
          id,
          type: "streamable_http",
          name: body.name ?? "",
          url: body.url ?? "",
          headers: body.headers,
          timeout_seconds: body.timeout_seconds,
          cache_tools_list: body.cache_tools_list ?? true,
          max_retry_attempts: body.max_retry_attempts,
          created_at,
        };
        conn = c;
      } else if (body.type === "stdio") {
        const c: MCPConnectionStdio = {
          id,
          type: "stdio",
          name: body.name ?? "",
          command: body.command ?? "",
          args: Array.isArray(body.args) ? body.args : [],
          env:
            body.env && typeof body.env === "object"
              ? (body.env as Record<string, string>)
              : undefined,
          cwd:
            typeof body.cwd === "string" && body.cwd.trim()
              ? body.cwd.trim()
              : undefined,
          created_at,
        };
        conn = c;
      } else {
        res.status(400).json({
          error: `Unknown connection type: ${(body as { type?: string }).type}`,
        });
        return;
      }
      await mcpConnectionsStore.addOrUpdate(conn);
      res.status(201).json({ connection: conn });
    },
  );

  app.patch(
    "/api/mcp/connections/:id",
    async (req: Request, res: Response): Promise<void> => {
      const id = getParam(req, "id");
      const existing = await mcpConnectionsStore.getById(id);
      if (!existing) {
        res.status(404).json({ error: "MCP connection not found." });
        return;
      }
      const patch = req.body as Partial<MCPConnection>;
      const merged = {
        ...existing,
        ...patch,
        id: existing.id,
      } as MCPConnection;
      await mcpConnectionsStore.addOrUpdate(merged);
      res.json({ connection: merged });
    },
  );

  app.delete(
    "/api/mcp/connections/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await mcpConnectionsStore.remove(getParam(req, "id"));
      if (!ok) {
        res.status(404).json({ error: "MCP connection not found." });
        return;
      }
      res.status(204).send();
    },
  );

  // Skills: list from ~/.agents filesystem; add/remove via npx skills CLI
  app.get("/api/skills/list", async (_req: Request, res: Response) => {
    try {
      const skills = await listSkillsFromFs();
      res.json({ skills });
    } catch (err) {
      debug("skills list error: %o", err);
      res.status(500).json({
        skills: [],
        error: (err as Error).message,
      });
    }
  });

  app.get("/api/skills/:id/content", async (req: Request, res: Response) => {
    const id =
      typeof req.params.id === "string"
        ? req.params.id
        : (req.params.id?.[0] ?? "");
    if (!id) {
      res.status(400).json({ error: "Missing skill id." });
      return;
    }
    try {
      const content = await getSkillContent(id);
      if (content === null) {
        res.status(404).json({ error: "Skill not found." });
        return;
      }
      res.json({ content });
    } catch (err) {
      debug("skills content error: %o", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/skills/add", async (req: Request, res: Response) => {
    const body = req.body as {
      package?: string;
      global?: boolean;
      skills?: string[];
    };
    const pkg = body?.package;
    if (!pkg || typeof pkg !== "string" || !pkg.trim()) {
      res.status(400).json({ error: "Missing or invalid 'package'." });
      return;
    }
    try {
      const result = await addSkill({
        package: pkg.trim(),
        global: Boolean(body?.global),
        skills: Array.isArray(body?.skills) ? body.skills : undefined,
      });
      res.json({
        output: result.stdout,
        error: result.stderr.trim() || undefined,
        code: result.code,
      });
    } catch (err) {
      debug("skills add error: %o", err);
      res.status(500).json({
        output: "",
        error: (err as Error).message,
        code: 1,
      });
    }
  });

  app.post("/api/skills/remove", async (req: Request, res: Response) => {
    const body = req.body as { skills?: string[]; global?: boolean };
    const skills = Array.isArray(body?.skills) ? body.skills : [];
    if (skills.length === 0) {
      res.status(400).json({ error: "Missing or invalid 'skills' array." });
      return;
    }
    try {
      const result = await removeSkills(skills, Boolean(body?.global));
      res.json({
        output: result.stdout,
        error: result.stderr.trim() || undefined,
        code: result.code,
      });
    } catch (err) {
      debug("skills remove error: %o", err);
      res.status(500).json({
        output: "",
        error: (err as Error).message,
        code: 1,
      });
    }
  });

  // Scheduling
  app.get("/api/schedule", (_req: Request, res: Response) => {
    res.json({ tasks: scheduler.list() });
  });

  app.post(
    "/api/schedule",
    async (req: Request, res: Response): Promise<void> => {
      if (killSwitchEnabled) {
        res.status(503).json({ error: "Hooman is paused (kill switch)." });
        return;
      }
      const { execute_at, intent, context } = req.body ?? {};
      if (!execute_at || !intent) {
        res.status(400).json({ error: "Missing execute_at or intent." });
        return;
      }
      const id = await scheduler.schedule({
        execute_at,
        intent,
        context: typeof context === "object" ? context : {},
      });
      res.status(201).json({ id, execute_at, intent, context: context ?? {} });
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
