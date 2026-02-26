import createDebug from "debug";
import http from "http";
import express from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";

const debug = createDebug("hooman:api");
import { AuditLog } from "./audit/audit.js";
import type { ResponsePayload } from "./audit/audit.js";
import { getConfig, loadPersisted } from "./config.js";
import type { RawDispatchInput } from "./types.js";
import { registerRoutes } from "./routes/index.js";
import { attachTranscribeWs } from "./routes/transcribe-ws.js";
import { localhostOnly } from "./middleware/localhost-only.js";
import { authJwt, verifyToken } from "./middleware/auth-jwt.js";
import { initDb } from "./data/db.js";
import { initChatHistory } from "./chats/chat-history.js";
import { initAttachmentStore } from "./attachments/attachment-store.js";
import { createChatService } from "./chats/chat-service.js";
import { createAttachmentService } from "./attachments/attachment-service.js";
import { createContext } from "./chats/context.js";
import { initScheduleStore } from "./scheduling/schedule-store.js";
import { createScheduleService } from "./scheduling/schedule-service.js";
import { initMCPConnectionsStore } from "./capabilities/mcp/connections-store.js";
import { createAuditStore } from "./audit/audit-store.js";
import { createSkillService } from "./capabilities/skills/skills-service.js";
import { createMcpService } from "./capabilities/mcp/mcp-service.js";
import { createChannelService } from "./channels/channel-service.js";
import { createSubscriber } from "./utils/pubsub.js";
import { createEventQueue } from "./events/event-queue.js";
import { enqueueRaw } from "./events/enqueue.js";
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
} from "./utils/workspace.js";
import { mkdirSync } from "fs";

async function main() {
  const ATTACHMENTS_DATA_DIR = getWorkspaceAttachmentsDir();
  mkdirSync(WORKSPACE_ROOT, { recursive: true });
  mkdirSync(WORKSPACE_MCPCWD, { recursive: true });

  await loadPersisted();

  const redisUrl = env.REDIS_URL;
  initRedis(redisUrl);
  initKillSwitch(redisUrl);

  const eventQueue = createEventQueue({ connection: redisUrl });
  const dedupSet = new Set<string>();
  const enqueue = (
    raw: RawDispatchInput,
    options?: { correlationId?: string },
  ) =>
    enqueueRaw(eventQueue, raw, {
      correlationId: options?.correlationId,
      dedupSet,
    });
  debug(
    "Event queue: Redis + BullMQ; producers enqueue directly; workers process events",
  );

  await initDb();
  debug("Database (Prisma + SQLite) ready");

  const chatHistory = await initChatHistory();
  const attachmentStore = await initAttachmentStore(ATTACHMENTS_DATA_DIR);
  const attachmentService = createAttachmentService(attachmentStore);
  const context = createContext(chatHistory);
  const chatService = createChatService(
    chatHistory,
    attachmentService,
    context,
  );

  const scheduleStore = await initScheduleStore();
  const mcpConnectionsStore = await initMCPConnectionsStore();
  const auditStore = createAuditStore();
  const auditLog = new AuditLog(auditStore);

  const scheduler = createScheduleService(scheduleStore);

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
    if (!env.ALLOW_REMOTE_ACCESS) {
      app.use(localhostOnly);
    }
  } else {
    app.use(authJwt);
  }

  const server = http.createServer(app);
  attachTranscribeWs(server);
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

  // Subscribe to response delivery channel so worker responses reach Socket.IO clients
  const pubsub = createSubscriber();
  if (!pubsub) {
    throw new Error(
      "Redis subscriber unavailable — REDIS_URL is required. Check your .env.",
    );
  }
  pubsub.subscribe(RESPONSE_DELIVERY_CHANNEL, (raw) => {
    try {
      const payload = JSON.parse(raw) as ResponseDeliveryPayload;
      if (payload.channel !== "api") return;
      if ("skipped" in payload && payload.skipped === true) {
        io.emit("chat-skipped", { eventId: payload.eventId });
        return;
      }
      if (!("message" in payload)) return;
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
    } catch (err) {
      debug("response_delivery parse error: %o", err);
    }
  });

  registerRoutes(app, {
    enqueue,
    chatService,
    attachmentService,
    auditLog,
    responseStore,
    scheduler,
    io,
    mcpConnectionsStore,
    skillService: createSkillService(),
    mcpService: createMcpService(mcpConnectionsStore),
    channelService: createChannelService(),
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
