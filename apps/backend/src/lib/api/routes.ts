import type { Express, Request, Response } from "express";
import type { Server as SocketServer } from "socket.io";
import createDebug from "debug";
import type { EventRouter } from "../events/event-router.js";
import type { ContextStore } from "../agents/context.js";
import type { AuditLog } from "./audit.js";
import type { ColleagueEngine } from "../agents/colleagues.js";
import type { ScheduleService } from "../schedule/scheduler.js";
import type { MCPConnectionsStore } from "../data/mcp-connections-store.js";
import type { AttachmentStore } from "../data/attachment-store.js";
import type {
  ColleagueConfig,
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
  ChannelsConfig,
  RawDispatchInput,
} from "../core/types.js";
import { randomUUID } from "crypto";
import multer from "multer";
import {
  getConfig,
  updateConfig,
  getChannelsConfig,
  updateChannelsConfig,
} from "../core/config.js";
import {
  setReloadFlag,
  setReloadFlags,
  type ReloadScope,
} from "../schedule/reload-flag.js";
import {
  getWhatsAppConnection,
  setWhatsAppConnection,
} from "../channels/whatsapp-connection.js";
import {
  listSkillsFromFs,
  getSkillContent,
  addSkill,
  removeSkills,
} from "../agents/skills-cli.js";
import {
  getKillSwitchEnabled,
  setKillSwitchEnabled,
} from "../agents/kill-switch.js";
import { env } from "../../env.js";

const debug = createDebug("hooman:chat");

interface AppContext {
  eventRouter: EventRouter;
  context: ContextStore;
  auditLog: AuditLog;
  colleagueEngine: ColleagueEngine;
  responseStore: Map<
    string,
    Array<{ role: "user" | "assistant"; text: string }>
  >;
  scheduler: ScheduleService;
  io: SocketServer;
  mcpConnectionsStore: MCPConnectionsStore;
  attachmentStore: AttachmentStore;
}

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
    io,
    responseStore,
    mcpConnectionsStore,
    attachmentStore,
  } = ctx;

  const upload = multer({ storage: multer.memoryStorage() });

  // Health
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", killSwitch: getKillSwitchEnabled() });
  });

  // Internal: workers (Slack, Email, cron) post events here. Optional INTERNAL_SECRET env.
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

  // Internal: worker posts chat result here; API emits on Socket.IO so frontend gets the reply without blocking.
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
      message: { role: "assistant"; text: string; lastAgentName?: string };
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

  // Configuration (Settings UI: API key, embedding model, LLM model, web search, MCP; PORT is .env-only)
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

  // Chat history (context reads from SQLite when set, else Mem0); enriches messages with attachment meta for UI
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

  // Upload chat attachments (multipart); stored on server and in DB; returns IDs for sending with messages
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

  // Chat: dispatch message.sent to queue; worker processes and POSTs result to /api/internal/chat-result; API emits on Socket.IO. Frontend gets reply via socket (no blocking).
  app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
    if (getKillSwitchEnabled()) {
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

    res.status(202).json({ eventId });
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
  app.get("/api/audit", async (_req: Request, res: Response) => {
    const entries = await auditLog.getAuditLog();
    res.json({ entries });
  });

  // Kill switch
  app.get("/api/safety/kill-switch", (_req: Request, res: Response) => {
    res.json({ enabled: getKillSwitchEnabled() });
  });

  app.post("/api/safety/kill-switch", (req: Request, res: Response) => {
    setKillSwitchEnabled(Boolean(req.body?.enabled));
    res.json({ enabled: getKillSwitchEnabled() });
  });

  // Channels: list + config (secrets masked), PATCH to update
  app.get("/api/channels", (_req: Request, res: Response) => {
    const channels = getChannelsConfig();
    const mask = (s: string) => (s?.length ? `${s.slice(0, 4)}…` : "");
    res.json({
      channels: {
        web: {
          id: "web",
          name: "Web chat",
          alwaysOn: true,
          config: null,
        },
        slack: channels.slack
          ? {
              id: "slack",
              name: "Slack",
              alwaysOn: false,
              enabled: channels.slack.enabled,
              config: {
                ...channels.slack,
                appToken: mask(channels.slack.appToken),
                userToken: mask(channels.slack.userToken),
              },
            }
          : {
              id: "slack",
              name: "Slack",
              alwaysOn: false,
              enabled: false,
              config: null,
            },
        email: channels.email
          ? {
              id: "email",
              name: "Email",
              alwaysOn: false,
              enabled: channels.email.enabled,
              config: {
                ...channels.email,
                imap: channels.email.imap
                  ? {
                      ...channels.email.imap,
                      password: mask(channels.email.imap.password),
                    }
                  : undefined,
              },
            }
          : {
              id: "email",
              name: "Email",
              alwaysOn: false,
              enabled: false,
              config: null,
            },
        whatsapp: channels.whatsapp
          ? {
              id: "whatsapp",
              name: "WhatsApp",
              alwaysOn: false,
              enabled: channels.whatsapp.enabled,
              config: channels.whatsapp,
            }
          : {
              id: "whatsapp",
              name: "WhatsApp",
              alwaysOn: false,
              enabled: false,
              config: null,
            },
        jira: channels.jira
          ? {
              id: "jira",
              name: "Jira",
              alwaysOn: false,
              enabled: channels.jira.enabled,
              config: {
                ...channels.jira,
                apiToken: mask(channels.jira.apiToken),
              },
            }
          : {
              id: "jira",
              name: "Jira",
              alwaysOn: false,
              enabled: false,
              config: null,
            },
      },
    });
  });

  app.patch(
    "/api/channels",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as Partial<ChannelsConfig>;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Invalid body." });
        return;
      }
      const current = getChannelsConfig();
      const patch: ChannelsConfig = { ...current };
      const isMasked = (s: unknown) =>
        typeof s === "string" && (s.endsWith("…") || s.length < 10);
      if (body.slack !== undefined) {
        const b = body.slack as ChannelsConfig["slack"];
        const c = current.slack;
        patch.slack = {
          ...c,
          ...b,
          appToken: isMasked(b?.appToken)
            ? (c?.appToken ?? b?.appToken)
            : b?.appToken,
          userToken: isMasked(b?.userToken)
            ? (c?.userToken ?? b?.userToken)
            : b?.userToken,
        } as ChannelsConfig["slack"];
      }
      if (body.email !== undefined) {
        const b = body.email as ChannelsConfig["email"];
        const c = current.email;
        const imapMerge =
          b?.imap && c?.imap
            ? {
                ...c.imap,
                ...b.imap,
                password: isMasked(b.imap.password)
                  ? c.imap.password
                  : b.imap.password,
              }
            : (b?.imap ?? c?.imap);
        patch.email = {
          ...c,
          ...b,
          imap: imapMerge,
        } as ChannelsConfig["email"];
      }
      if (body.whatsapp !== undefined)
        patch.whatsapp = {
          ...current.whatsapp,
          ...body.whatsapp,
        } as ChannelsConfig["whatsapp"];
      if (body.jira !== undefined) {
        const b = body.jira as ChannelsConfig["jira"];
        const c = current.jira;
        patch.jira = {
          ...c,
          ...b,
          apiToken: isMasked(b?.apiToken)
            ? (c?.apiToken ?? b?.apiToken)
            : b?.apiToken,
        } as ChannelsConfig["jira"];
      }
      updateChannelsConfig(patch);
      const channelScopes: ReloadScope[] = [];
      if (body.slack !== undefined) channelScopes.push("slack");
      if (body.email !== undefined) channelScopes.push("email");
      if (body.whatsapp !== undefined) channelScopes.push("whatsapp");
      if (body.jira !== undefined) channelScopes.push("jira");
      if (channelScopes.length)
        await setReloadFlags(env.REDIS_URL, channelScopes);
      res.json({ channels: getChannelsConfig() });
    },
  );

  // WhatsApp connection status (QR etc.) for Settings UI
  app.get(
    "/api/channels/whatsapp/connection",
    (_req: Request, res: Response) => {
      res.json(getWhatsAppConnection());
    },
  );

  // Internal: WhatsApp worker posts QR/status here so the API can serve it to the frontend
  app.post(
    "/api/internal/whatsapp-connection",
    (req: Request, res: Response) => {
      const secret = env.INTERNAL_SECRET;
      if (secret != null && secret !== "") {
        const header = req.headers["x-internal-secret"];
        if (header !== secret) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
      }
      const body = req.body as {
        status?: string;
        qr?: string;
        selfId?: string;
        selfNumber?: string;
      };
      const status = body?.status ?? "disconnected";
      const qr = typeof body?.qr === "string" ? body.qr : undefined;
      const selfId = typeof body?.selfId === "string" ? body.selfId : undefined;
      const selfNumber =
        typeof body?.selfNumber === "string" ? body.selfNumber : undefined;
      setWhatsAppConnection(
        status === "connected"
          ? { status: "connected", selfId, selfNumber }
          : status === "pairing" && qr
            ? { status: "pairing", qr }
            : { status: "disconnected" },
      );
      res.json({ ok: true });
    },
  );

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

  // Skills: list from project .agents/skills; add/remove via npx skills CLI (project-local)
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
    const body = req.body as { package?: string; skills?: string[] };
    const pkg = body?.package;
    if (!pkg || typeof pkg !== "string" || !pkg.trim()) {
      res.status(400).json({ error: "Missing or invalid 'package'." });
      return;
    }
    try {
      const result = await addSkill({
        package: pkg.trim(),
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
    const body = req.body as { skills?: string[] };
    const skills = Array.isArray(body?.skills) ? body.skills : [];
    if (skills.length === 0) {
      res.status(400).json({ error: "Missing or invalid 'skills' array." });
      return;
    }
    try {
      const result = await removeSkills(skills);
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
  app.get("/api/schedule", async (_req: Request, res: Response) => {
    const tasks = await scheduler.list();
    res.json({ tasks });
  });

  app.post(
    "/api/schedule",
    async (req: Request, res: Response): Promise<void> => {
      if (getKillSwitchEnabled()) {
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
      await setReloadFlag(env.REDIS_URL, "schedule");
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
      await setReloadFlag(env.REDIS_URL, "schedule");
      res.status(204).send();
    },
  );
}
