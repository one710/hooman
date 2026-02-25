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
import { createAuditStore } from "../audit/audit-store.js";
import { initRedis, closeRedis } from "../data/redis.js";
import { initKillSwitch, closeKillSwitch } from "../agents/kill-switch.js";
import {
  createHoomanRunner,
  type HoomanRunner,
} from "../agents/hooman-runner.js";
import { McpManager } from "../capabilities/mcp/manager.js";
import {
  publish,
  createSubscriber,
  createRpcMessageHandler,
} from "../utils/pubsub.js";
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
  const auditStore = createAuditStore();
  const auditLog = new AuditLog(auditStore);

  const mcpManager = new McpManager(mcpConnectionsStore, {
    connectTimeoutMs: env.MCP_CONNECT_TIMEOUT_MS,
    closeTimeoutMs: env.MCP_CLOSE_TIMEOUT_MS,
  });
  debug("MCP manager enabled");

  let runnerCache: HoomanRunner | null = null;
  const getRunner = async (): Promise<HoomanRunner> => {
    if (runnerCache) return runnerCache;
    const { agentTools } = await mcpManager.tools();
    runnerCache = await createHoomanRunner({ agentTools, auditLog });
    return runnerCache;
  };

  // Start/cache MCP manager tools
  await mcpManager.tools();

  // Handle synchronous MCP reload RPC from the API (Tools tab refresh)
  const mcpReloadSub = createSubscriber();
  if (mcpReloadSub) {
    const handler = createRpcMessageHandler(
      "hooman:mcp-reload:response",
      async () => {
        debug("MCP reload RPC received; re-reading config");
        await loadPersisted();
        await mcpManager.shutdown();
        await mcpManager.tools();
        runnerCache = null;
        debug("MCP manager reloaded via RPC");
        return { ok: true };
      },
    );
    mcpReloadSub.subscribe("hooman:mcp-reload:request", handler);
    debug("Subscribed to hooman:mcp-reload:request for MCP reload RPC");
  }

  const eventRouter = new EventRouter();
  registerEventHandlers({
    eventRouter,
    context,
    auditLog,
    publishResponse: (payload) => {
      publish(RESPONSE_DELIVERY_CHANNEL, JSON.stringify(payload));
    },
    getRunner,
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
    debug("Shutting down event-queue worker\u2026");
    if (mcpReloadSub) await mcpReloadSub.close();
    await closeKillSwitch();
    await eventQueue.close();
    await mcpManager?.shutdown();
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
