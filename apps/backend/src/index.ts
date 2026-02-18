import createDebug from "debug";
import http from "http";
import express from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";

const debug = createDebug("hooman:api");
import { EventRouter } from "./events/event-router.js";
import { createMemoryService } from "./data/memory.js";
import { AuditLog } from "./audit.js";
import type { ScheduleService, ScheduledTask } from "./data/scheduler.js";
import { randomUUID } from "crypto";
import type { ResponsePayload } from "./audit.js";
import { getConfig, loadPersisted } from "./config.js";
import { registerRoutes } from "./routes/index.js";
import { localhostOnly } from "./middleware/localhost-only.js";
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
import { initRedis } from "./data/redis.js";
import { initKillSwitch } from "./agents/kill-switch.js";
import { env } from "./env.js";
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

  await loadPersisted();

  const redisUrl = env.REDIS_URL;
  initRedis(redisUrl);

  const eventRouter = new EventRouter();
  initKillSwitch(redisUrl);
  const eventQueue = createEventQueue({ connection: redisUrl });
  eventRouter.setQueueAdapter(eventQueue);
  debug(
    "Event queue: Redis + BullMQ; kill switch in Redis; workers process events",
  );

  const config = getConfig();
  const memory = await createMemoryService({
    openaiApiKey: config.OPENAI_API_KEY,
    llmModel: config.OPENAI_MODEL,
  });

  await initDb();
  debug("Database (Prisma + SQLite) ready");

  const chatHistory = await initChatHistory();
  const attachmentStore = await initAttachmentStore(ATTACHMENTS_DATA_DIR);
  const context = createContext(memory, chatHistory);

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
  app.use(cors({ origin: true }));
  app.use(express.json());
  app.use(localhostOnly);

  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: { origin: true },
    path: "/socket.io",
  });

  // Subscribe to audit channel so worker-added entries trigger Socket.IO emit to refresh Audit UI
  const pubsub = createSubscriber();
  if (pubsub) {
    pubsub.subscribe(AUDIT_ENTRY_ADDED_CHANNEL, () => {
      debug("audit-entry-added from Redis, emitting to Socket.IO");
      io.emit("audit-entry-added");
    });
  } else {
    debug(
      "No Redis subscriber (REDIS_URL empty?); audit log will not auto-refresh when workers add entries",
    );
  }

  registerRoutes(app, {
    eventRouter,
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
