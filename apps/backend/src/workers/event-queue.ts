/**
 * Event-queue worker: runs the BullMQ worker that processes events (chat, scheduled tasks).
 * Agents run here. Publishes responses to Redis (hooman:response_delivery); API/Slack/WhatsApp subscribers deliver accordingly.
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only event-queue).
 */
import createDebug from "debug";
import { mkdirSync } from "fs";
import { loadPersisted } from "../config.js";
import { createEventQueue } from "../events/event-queue.js";
import { EventRouter } from "../events/event-router.js";
import { registerEventHandlers } from "../events/event-handlers.js";
import { AuditLog } from "../audit/audit.js";
import { createContext } from "../agents/context.js";
import { initMCPConnectionsStore } from "../capabilities/mcp/connections-store.js";
import { initDb } from "../data/db.js";
import { initChatHistory } from "../chats/chat-history.js";
import {
  createAuditStore,
  AUDIT_ENTRY_ADDED_CHANNEL,
} from "../audit/audit-store.js";
import { publish } from "../utils/pubsub.js";
import { initRedis, closeRedis } from "../data/redis.js";
import { initKillSwitch, closeKillSwitch } from "../agents/kill-switch.js";
import { McpManager } from "../capabilities/mcp/manager.js";
import { initReloadWatch, closeReloadWatch } from "../utils/reload-flag.js";
import { env } from "../env.js";
import { RESPONSE_DELIVERY_CHANNEL } from "../types.js";
import { loadPrompts } from "../utils/prompts.js";
import { WORKSPACE_ROOT, WORKSPACE_MCPCWD } from "../utils/workspace.js";

const debug = createDebug("hooman:workers:event-queue");

async function main() {
  if (!env.REDIS_URL) {
    debug("REDIS_URL is required for the event-queue worker. Set it in .env.");
    process.exit(1);
  }

  await loadPersisted();
  await loadPrompts();
  mkdirSync(WORKSPACE_ROOT, { recursive: true });
  mkdirSync(WORKSPACE_MCPCWD, { recursive: true });
  await initDb();
  initRedis(env.REDIS_URL);
  initKillSwitch(env.REDIS_URL);

  const chatHistory = await initChatHistory();
  const context = createContext(chatHistory);
  const mcpConnectionsStore = await initMCPConnectionsStore();
  const auditStore = createAuditStore({
    onAppend: () => publish(AUDIT_ENTRY_ADDED_CHANNEL, "1"),
  });
  const auditLog = new AuditLog(auditStore);

  const mcpManager = new McpManager(mcpConnectionsStore, {
    connectTimeoutMs: env.MCP_CONNECT_TIMEOUT_MS,
    closeTimeoutMs: env.MCP_CLOSE_TIMEOUT_MS,
    auditLog,
  });
  debug("MCP Server Manager enabled");

  initReloadWatch(env.REDIS_URL, ["mcp"], async () => {
    debug("MCP reload triggered; re-reading config");
    await loadPersisted();
    await mcpManager.reload();
    debug("MCP Server Manager reloaded");
  });

  const eventRouter = new EventRouter();
  registerEventHandlers({
    eventRouter,
    context,
    mcpConnectionsStore,
    auditLog,
    publishResponseDelivery: (payload) => {
      publish(RESPONSE_DELIVERY_CHANNEL, JSON.stringify(payload));
    },
    getMcpManager: () => mcpManager,
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
    await closeReloadWatch();
    await closeKillSwitch();
    await eventQueue.close();
    await mcpManager?.reload();
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
