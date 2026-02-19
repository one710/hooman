/**
 * WhatsApp worker: runs the WhatsApp channel adapter, enqueues message events directly to BullMQ.
 * Subscribes to Redis for MCP requests (hooman:mcp:whatsapp:request) and response delivery.
 * Respects channel on/off: at startup and when Redis reload flag is set (e.g. after PATCH /api/channels).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only whatsapp).
 */
import createDebug from "debug";
import { getChannelsConfig } from "../config.js";
import {
  startWhatsAppAdapter,
  stopWhatsAppAdapter,
  handleWhatsAppMcpRequest,
  sendMessageToChat,
} from "../channels/whatsapp-adapter.js";
import { createEventQueue } from "../events/event-queue.js";
import { createQueueDispatcher } from "../events/enqueue.js";
import { createSubscriber, createRpcMessageHandler } from "../data/pubsub.js";
import { env } from "../env.js";
import { RESPONSE_DELIVERY_CHANNEL } from "../types.js";
import { runWorker } from "./bootstrap.js";

const debug = createDebug("hooman:workers:whatsapp");

const MCP_REQUEST_CHANNEL = "hooman:mcp:whatsapp:request";
const MCP_RESPONSE_CHANNEL = "hooman:mcp:whatsapp:response";
const CONNECTION_REQUEST_CHANNEL = "hooman:whatsapp:connection:request";
const CONNECTION_RESPONSE_CHANNEL = "hooman:whatsapp:connection:response";

let eventQueue: ReturnType<typeof createEventQueue> | null = null;
let mcpSubscriber: ReturnType<typeof createSubscriber> | null = null;

/** Connection state for WhatsApp (QR, status, self identity). API reads this via Redis RPC. */
let connectionState: {
  status: "disconnected" | "pairing" | "connected";
  qr?: string;
  selfId?: string;
  selfNumber?: string;
} = { status: "disconnected" };

async function startAdapter(): Promise<void> {
  await stopWhatsAppAdapter();
  if (!env.REDIS_URL) {
    debug("REDIS_URL required for WhatsApp worker");
    return;
  }
  eventQueue = createEventQueue({ connection: env.REDIS_URL });
  const dispatcher = createQueueDispatcher(eventQueue);
  await startWhatsAppAdapter(dispatcher, () => getChannelsConfig().whatsapp, {
    onConnectionUpdate: ({ status, qr, selfId, selfNumber }) => {
      connectionState =
        status === "connected"
          ? { status: "connected", selfId, selfNumber }
          : status === "pairing" && qr
            ? { status: "pairing", qr }
            : { status: "disconnected" };
      if (status === "pairing" && qr) {
        debug("QR ready for Settings UI (via RPC)");
      } else if (status === "connected") {
        debug(
          "Linked; connection open (self: %s)",
          selfNumber ?? selfId ?? "—",
        );
      }
    },
  });
}

function setupMcpSubscriber(): void {
  mcpSubscriber = createSubscriber();
  if (!mcpSubscriber) return;
  mcpSubscriber.subscribe(
    MCP_REQUEST_CHANNEL,
    createRpcMessageHandler(
      MCP_RESPONSE_CHANNEL,
      (method, params) => handleWhatsAppMcpRequest(method, params),
      (msg) => debug(msg),
    ),
  );
  mcpSubscriber.subscribe(
    CONNECTION_REQUEST_CHANNEL,
    createRpcMessageHandler(CONNECTION_RESPONSE_CHANNEL, async (method) => {
      if (method !== "get_connection_status") {
        throw new Error(`Unknown method: ${method}`);
      }
      return connectionState;
    }),
  );
  mcpSubscriber.subscribe(RESPONSE_DELIVERY_CHANNEL, (raw) => {
    try {
      const payload = JSON.parse(raw) as {
        channel?: string;
        chatId?: string;
        text?: string;
      };
      if (payload.channel !== "whatsapp") return;
      const chatId = payload.chatId;
      const text = payload.text;
      if (typeof chatId !== "string" || typeof text !== "string") return;
      sendMessageToChat(chatId, text).catch((err) => {
        debug("response_delivery whatsapp send error: %o", err);
      });
    } catch (err) {
      debug("response_delivery parse/handle error: %o", err);
    }
  });
  debug("MCP + connection RPC + response delivery subscribers started");
}

runWorker({
  name: "whatsapp",
  reloadScopes: ["whatsapp"],
  start: async () => {
    await startAdapter();
    setupMcpSubscriber();
  },
  stop: async () => {
    if (mcpSubscriber) await mcpSubscriber.close();
    mcpSubscriber = null;
    if (eventQueue) {
      await eventQueue.close();
      eventQueue = null;
    }
    await stopWhatsAppAdapter();
  },
  onReload: () => startAdapter(),
});
