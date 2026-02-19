/**
 * Event-queue worker: runs the BullMQ worker that processes events (chat, scheduled tasks).
 * Agents run here. Publishes responses to Redis (hooman:response_delivery); API/Slack/WhatsApp subscribers deliver accordingly.
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only event-queue).
 */
import createDebug from "debug";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { loadPersisted } from "../config.js";
import { createEventQueue } from "../events/event-queue.js";
import { EventRouter } from "../events/event-router.js";
import { registerEventHandlers } from "../events/event-handlers.js";
import { AuditLog } from "../audit.js";
import { createContext } from "../agents/context.js";
import type { ScheduleService, ScheduledTask } from "../data/scheduler.js";
import { initScheduleStore } from "../data/schedule-store.js";
import { initMCPConnectionsStore } from "../data/mcp-connections-store.js";
import { initDb } from "../data/db.js";
import { initChatHistory } from "../data/chat-history.js";
import {
  createAuditStore,
  AUDIT_ENTRY_ADDED_CHANNEL,
} from "../data/audit-store.js";
import { publish } from "../data/pubsub.js";
import { initRedis, closeRedis } from "../data/redis.js";
import { initKillSwitch, closeKillSwitch } from "../agents/kill-switch.js";
import { env } from "../env.js";
import { RESPONSE_DELIVERY_CHANNEL } from "../types.js";
import { WORKSPACE_ROOT, WORKSPACE_MCPCWD } from "../workspace.js";

const debug = createDebug("hooman:workers:event-queue");

async function main() {
  if (!env.REDIS_URL) {
    debug("REDIS_URL is required for the event-queue worker. Set it in .env.");
    process.exit(1);
  }

  await loadPersisted();
  mkdirSync(WORKSPACE_ROOT, { recursive: true });
  mkdirSync(WORKSPACE_MCPCWD, { recursive: true });
  await initDb();
  initRedis(env.REDIS_URL);
  initKillSwitch(env.REDIS_URL);

  const chatHistory = await initChatHistory();
  const context = createContext(chatHistory);
  const mcpConnectionsStore = await initMCPConnectionsStore();
  const scheduleStore = await initScheduleStore();
  const scheduler: ScheduleService = {
    list: () => scheduleStore.getAll(),
    schedule: async (task: Omit<ScheduledTask, "id">) => {
      const id = randomUUID();
      await scheduleStore.add({ ...task, id });
      return id;
    },
    cancel: (id) => scheduleStore.remove(id),
  };
  const auditStore = createAuditStore({
    onAppend: () => publish(AUDIT_ENTRY_ADDED_CHANNEL, "1"),
  });
  const auditLog = new AuditLog(auditStore);

  const eventRouter = new EventRouter();
  registerEventHandlers({
    eventRouter,
    context,
    mcpConnectionsStore,
    auditLog,
    scheduler,
    publishResponseDelivery: (payload) => {
      publish(RESPONSE_DELIVERY_CHANNEL, JSON.stringify(payload));
    },
  });

  const eventQueue = createEventQueue({ connection: env.REDIS_URL });
  eventQueue.startWorker(async (event) => {
    debug(
      "Event received: type=%s source=%s id=%s",
      event.type,
      event.source,
      event.id,
    );
    await eventRouter.runHandlersForEvent(event);
  });
  debug(
    "Event-queue worker started (agents run here); responses via %s",
    RESPONSE_DELIVERY_CHANNEL,
  );

  const shutdown = async () => {
    debug("Shutting down event-queue worker…");
    await closeKillSwitch();
    await eventQueue.close();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  debug("Event-queue worker failed: %o", err);
  process.exit(1);
});
