import createDebug from "debug";
import http from "http";
import express from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";

const debug = createDebug("hooman:api");
import { AuditLog } from "./audit.js";
import type { ScheduleService, ScheduledTask } from "./data/scheduler.js";
import { randomUUID } from "crypto";
import type { ResponsePayload } from "./audit.js";
import { getConfig, loadPersisted } from "./config.js";
import { loadPrompts } from "./prompts.js";
import { registerRoutes } from "./routes/index.js";
import { localhostOnly } from "./middleware/localhost-only.js";
import { authJwt, verifyToken } from "./middleware/auth-jwt.js";
import { initDb } from "./data/db.js";
import { initChatHistory } from "./data/chat-history.js";
import { initAttachmentStore } from "./data/attachment-store.js";
import { createContext } from "./agents/context.js";
import { initScheduleStore } from "./data/schedule-store.js";
import { initMCPConnectionsStore } from "./data/mcp-connections-store.js";
import {
  createAuditStore,
  AUDIT_ENTRY_ADDED_CHANNEL,
} from "./data/audit-store.js";
import { createSubscriber, publish } from "./data/pubsub.js";
import { createEventQueue } from "./events/event-queue.js";
import { enqueueRaw } from "./events/enqueue.js";
import { EventRouter } from "./events/event-router.js";
import { registerEventHandlers } from "./events/event-handlers.js";
import { initRedis } from "./data/redis.js";
import {
  RESPONSE_DELIVERY_CHANNEL,
  type ResponseDeliveryPayload,
} from "./types.js";
import { initKillSwitch } from "./agents/kill-switch.js";
import { env, isWebAuthEnabled } from "./env.js";
import {
  getWorkspaceAttachmentsDir,
  WORKSPACE_ROOT,
  WORKSPACE_MCPCWD,
} from "./workspace.js";
import { mkdirSync } from "fs";

async function main() {
  const ATTACHMENTS_DATA_DIR = getWorkspaceAttachmentsDir();
  mkdirSync(WORKSPACE_ROOT, { recursive: true });
  mkdirSync(WORKSPACE_MCPCWD, { recursive: true });

  await loadPrompts();
  await loadPersisted();

  const redisUrl = env.REDIS_URL;
  initRedis(redisUrl);
  initKillSwitch(redisUrl);

  let enqueue: (
    raw: import("./types.js").RawDispatchInput,
    options?: { correlationId?: string },
  ) => Promise<string>;
  let eventRouter: EventRouter | null = null;

  if (redisUrl) {
    const eventQueue = createEventQueue({ connection: redisUrl });
    const dedupSet = new Set<string>();
    enqueue = (raw, opts) =>
      enqueueRaw(eventQueue, raw, {
        correlationId: opts?.correlationId,
        dedupSet,
      });
    debug(
      "Event queue: Redis + BullMQ; producers enqueue directly; workers process events",
    );
  } else {
    eventRouter = new EventRouter();
    enqueue = (raw, opts) => eventRouter!.dispatch(raw, opts);
    debug("No Redis: events processed in-memory");
  }

  await initDb();
  debug("Database (Prisma + SQLite) ready");

  const chatHistory = await initChatHistory();
  const attachmentStore = await initAttachmentStore(ATTACHMENTS_DATA_DIR);
  const context = createContext(chatHistory);

  const scheduleStore = await initScheduleStore();
  const mcpConnectionsStore = await initMCPConnectionsStore();
  const auditStore = createAuditStore({
    onAppend: () => publish(AUDIT_ENTRY_ADDED_CHANNEL, "1"),
  });
  const auditLog = new AuditLog(auditStore);

  const scheduler: ScheduleService = {
    list: () => scheduleStore.getAll(),
    schedule: async (task: Omit<ScheduledTask, "id">) => {
      const id = randomUUID();
      await scheduleStore.add({ ...task, id });
      return id;
    },
    cancel: (id) => scheduleStore.remove(id),
  };

  const responseStore: Map<
    string,
    Array<{ role: "user" | "assistant"; text: string }>
  > = new Map();

  auditLog.onResponseReceived((payload: ResponsePayload) => {
    if (payload.type === "response") {
      const list = responseStore.get(payload.eventId) ?? [];
      list.push({ role: "assistant", text: payload.text });
      responseStore.set(payload.eventId, list);
    }
  });

  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    }),
  );
  app.use(express.json());
  if (!isWebAuthEnabled()) {
    app.use(localhostOnly);
  } else {
    app.use(authJwt);
  }

  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: { origin: true },
    path: "/socket.io",
  });

  io.use((socket, next) => {
    if (!isWebAuthEnabled()) {
      next();
      return;
    }
    const token =
      (socket.handshake.auth?.token as string) ??
      (socket.handshake.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      ) as string);
    if (!token) {
      next(new Error("Unauthorized"));
      return;
    }
    verifyToken(token)
      .then((payload) => {
        if (payload) next();
        else next(new Error("Unauthorized"));
      })
      .catch(() => next(new Error("Unauthorized")));
  });

  // Subscribe to audit channel so worker-added entries trigger Socket.IO emit to refresh Audit UI
  const pubsub = createSubscriber();
  if (pubsub) {
    pubsub.subscribe(AUDIT_ENTRY_ADDED_CHANNEL, () => {
      debug("audit-entry-added from Redis, emitting to Socket.IO");
      io.emit("audit-entry-added");
    });
    pubsub.subscribe(RESPONSE_DELIVERY_CHANNEL, (raw) => {
      try {
        const payload = JSON.parse(raw) as ResponseDeliveryPayload;
        if (payload.channel !== "api") return;
        const { eventId, message } = payload;
        if (
          typeof eventId !== "string" ||
          !message ||
          typeof message.text !== "string"
        )
          return;
        io.emit("chat-result", { eventId, message });
        const list = responseStore.get(eventId) ?? [];
        list.push({ role: "assistant", text: message.text });
        responseStore.set(eventId, list);
        // Audit entry already written by event-queue worker; do not emit again
      } catch (err) {
        debug("response_delivery parse error: %o", err);
      }
    });
  } else {
    debug(
      "No Redis subscriber (REDIS_URL empty?); audit log will not auto-refresh when workers add entries",
    );
  }

  if (eventRouter) {
    registerEventHandlers({
      eventRouter,
      context,
      mcpConnectionsStore,
      auditLog,
      scheduler,
      publishResponseDelivery: (payload) => {
        if (payload.channel !== "api") return;
        io.emit("chat-result", {
          eventId: payload.eventId,
          message: payload.message,
        });
        const list = responseStore.get(payload.eventId) ?? [];
        list.push({ role: "assistant", text: payload.message.text });
        responseStore.set(payload.eventId, list);
        // Audit entry already written by handler (appendAuditEntry + emitResponse); do not emit again
      },
    });
  }

  registerRoutes(app, {
    enqueue,
    context,
    auditLog,
    responseStore,
    scheduler,
    io,
    mcpConnectionsStore,
    attachmentStore,
  });

  const PORT = getConfig().PORT;
  server.listen(PORT, () => {
    debug(
      "Hooman API listening on http://localhost:%s (Socket.IO on same server)",
      PORT,
    );
  });
}

main().catch((err) => {
  debug("API startup failed: %o", err);
  process.exit(1);
});
