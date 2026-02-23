/**
 * Shared event handlers for chat, turn_completed, and scheduled tasks.
 * Used by the API (in-memory mode) and by the workers process (BullMQ) so the worker is the only place that runs agents when Redis is used.
 */
import createDebug from "debug";
import type { EventRouter } from "./event-router.js";
import type { ContextStore } from "../agents/context.js";
import { MCPConnectionsStore } from "../capabilities/mcp/connections-store.js";
import type { AuditLog } from "../audit/audit.js";
import { McpManager } from "../capabilities/mcp/manager.js";
import { getAllDefaultMcpConnections } from "../capabilities/mcp/system-mcps.js";
import { createHoomanRunner } from "../agents/hooman-runner.js";
import type {
  RawDispatchInput,
  ChannelMeta,
  ResponseDeliveryPayload,
  SlackChannelMeta,
  WhatsAppChannelMeta,
} from "../types.js";
import { HOOMAN_SKIP_MARKER } from "../types.js";

const debug = createDebug("hooman:event-handlers");

/** Build a human-readable channel context string from channelMeta so the agent knows where the message came from and can reply using channel MCP tools. */
function buildChannelContext(
  meta: ChannelMeta | undefined,
): string | undefined {
  if (!meta) return undefined;
  const lines: string[] = [`source_channel: ${meta.channel}`];
  if (meta.channel === "whatsapp") {
    lines.push(`chatId: ${meta.chatId}`);
    lines.push(`messageId: ${meta.messageId}`);
    lines.push(`destinationType: ${meta.destinationType}`);
    if (meta.pushName) lines.push(`senderName: ${meta.pushName}`);
    if (meta.selfMentioned) lines.push(`selfMentioned: true`);
  } else if (meta.channel === "slack") {
    lines.push(`channelId: ${meta.channelId}`);
    lines.push(`messageTs: ${meta.messageTs}`);
    if (meta.threadTs) lines.push(`threadTs: ${meta.threadTs}`);
    lines.push(`destinationType: ${meta.destinationType}`);
    lines.push(`senderId: ${meta.senderId}`);
    if (meta.senderName) lines.push(`senderName: ${meta.senderName}`);
    if (meta.yourSlackUserId)
      lines.push(`yourSlackUserId: ${meta.yourSlackUserId}`);
    if (meta.selfMentioned) lines.push(`selfMentioned: true`);
  }
  lines.push(`directness: ${meta.directness}`);
  if (meta.directnessReason)
    lines.push(`directnessReason: ${meta.directnessReason}`);
  return lines.join("\n");
}

/** Max time to wait for runChat. After this we deliver a timeout message so the UI doesn't stay on "Thinking...". */
const CHAT_TIMEOUT_MS = 300_000;

class ChatTimeoutError extends Error {
  constructor() {
    super("Chat timed out");
    this.name = "ChatTimeoutError";
  }
}

export interface EventHandlerDeps {
  eventRouter: EventRouter;
  context: ContextStore;
  mcpConnectionsStore: MCPConnectionsStore;
  auditLog: AuditLog;
  /** When set (event-queue worker), publishes response to Redis; API/Slack/WhatsApp subscribers deliver accordingly. */
  publishResponseDelivery?: (payload: ResponseDeliveryPayload) => void;
  /** When set and MCP_USE_SERVER_MANAGER is true, use long-lived MCP session instead of per-run create/close. */
  mcpManager?: McpManager;
  /** Prefer this over mcpManager so the worker can enable/disable the manager without restart. */
  getMcpManager?: () => McpManager | undefined;
}

export function registerEventHandlers(deps: EventHandlerDeps): void {
  const {
    eventRouter,
    context,
    mcpConnectionsStore,
    auditLog,
    publishResponseDelivery,
    mcpManager: mcpManagerDep,
    getMcpManager,
  } = deps;

  function dispatchResponseToChannel(
    eventId: string,
    source: string,
    channelMeta: ChannelMeta | undefined,
    assistantText: string,
  ): void | Promise<void> {
    if (assistantText.includes(HOOMAN_SKIP_MARKER)) {
      if (source === "api" && publishResponseDelivery) {
        return publishResponseDelivery({
          channel: "api",
          eventId,
          skipped: true,
        });
      }
      return;
    }
    if (source === "api" && publishResponseDelivery) {
      return publishResponseDelivery({
        channel: "api",
        eventId,
        message: { role: "assistant", text: assistantText },
      });
    }
    if (source === "slack" && publishResponseDelivery) {
      const meta = channelMeta as SlackChannelMeta | undefined;
      if (meta?.channel === "slack") {
        const payload: ResponseDeliveryPayload = {
          channel: "slack",
          channelId: meta.channelId,
          text: assistantText,
          ...(meta.replyInThread && meta.threadTs
            ? { threadTs: meta.threadTs }
            : {}),
        };
        return publishResponseDelivery(payload);
      }
    }
    if (source === "whatsapp" && publishResponseDelivery) {
      const meta = channelMeta as WhatsAppChannelMeta | undefined;
      if (meta?.channel === "whatsapp") {
        return publishResponseDelivery({
          channel: "whatsapp",
          chatId: meta.chatId,
          text: assistantText,
        });
      }
    }
  }

  // turn_completed: persist turn to chat history only for UI (api source)
  eventRouter.register(async (event) => {
    if (
      event.type === "chat.turn_completed" &&
      event.payload.kind === "internal" &&
      event.source === "api"
    ) {
      const data = event.payload.data as {
        userId: string;
        userText: string;
        assistantText: string;
        userAttachments?: string[];
      };
      const { userId, userText, assistantText, userAttachments } = data;
      await context.addTurn(userId, userText, assistantText, userAttachments);
    }
  });

  // Chat handler: message.sent → run agents; dispatch response via publishResponseDelivery when set (api → Socket.IO; slack/whatsapp → Redis)
  eventRouter.register(async (event) => {
    if (event.payload.kind !== "message") return;
    const {
      text,
      userId,
      attachmentContents,
      attachments,
      channelMeta,
      sourceMessageType,
    } = event.payload;
    const textPreview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
    await auditLog.appendAuditEntry({
      type: "incoming_message",
      payload: {
        source: event.source,
        userId,
        textPreview,
        channel: (channelMeta as { channel?: string } | undefined)?.channel,
        eventId: event.id,
        ...(sourceMessageType ? { sourceMessageType } : {}),
      },
    });
    let assistantText = "";
    const mcpManager = getMcpManager?.() ?? mcpManagerDep;
    try {
      const thread = await context.getThreadForAgent(userId);
      const session = mcpManager
        ? await mcpManager.getSession()
        : await createHoomanRunner({
            connections: [
              ...getAllDefaultMcpConnections(),
              ...(await mcpConnectionsStore.getAll()),
            ],
            mcpConnectionsStore,
            auditLog,
            sessionId: userId,
          });
      try {
        const channelContext = buildChannelContext(
          channelMeta as ChannelMeta | undefined,
        );
        const runPromise = session.runChat(thread, text, {
          channelContext,
          attachments: attachmentContents,
          sessionId: userId,
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new ChatTimeoutError()), CHAT_TIMEOUT_MS);
        });
        const { finalOutput } = await Promise.race([
          runPromise,
          timeoutPromise,
        ]);
        const rawOutput =
          finalOutput?.trim() ||
          "I didn't get a clear response. Try rephrasing or check your API key and model settings.";
        assistantText = rawOutput;
        auditLog.emitResponse({
          type: "response",
          text: assistantText,
          eventId: event.id,
          userInput: text,
        });
        await eventRouter.dispatch({
          source: "api",
          type: "chat.turn_completed",
          payload: {
            userId,
            userText: text,
            assistantText,
            ...(attachments?.length ? { userAttachments: attachments } : {}),
          },
        } as RawDispatchInput);
        await dispatchResponseToChannel(
          event.id,
          event.source,
          channelMeta as ChannelMeta | undefined,
          assistantText,
        );
      } finally {
        if (!mcpManager) await session.closeMcp();
      }
    } catch (err) {
      if (err instanceof ChatTimeoutError) {
        debug("Chat timed out after %s ms", CHAT_TIMEOUT_MS);
        assistantText =
          "This is taking longer than expected. The agent may be using a tool. You can try again or rephrase.";
      } else {
        const msg = (err as Error).message;
        assistantText = `Something went wrong: ${msg}. Check API logs.`;
      }
      await eventRouter.dispatch({
        source: "api",
        type: "chat.turn_completed",
        payload: {
          userId,
          userText: text,
          assistantText,
          ...(attachments?.length ? { userAttachments: attachments } : {}),
        },
      } as RawDispatchInput);
      await dispatchResponseToChannel(
        event.id,
        event.source,
        channelMeta as ChannelMeta | undefined,
        assistantText,
      );
    }
  });

  // Scheduled task handler
  eventRouter.register(async (event) => {
    if (event.payload.kind !== "scheduled_task") return;
    const payload = event.payload;
    const contextStr =
      Object.keys(payload.context).length === 0
        ? "(none)"
        : Object.entries(payload.context)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(", ");
    const text = `Scheduled task: ${payload.intent}. Context: ${contextStr}.`;
    const mcpManager = getMcpManager?.() ?? mcpManagerDep;
    try {
      const session = mcpManager
        ? await mcpManager.getSession()
        : await createHoomanRunner({
            connections: await mcpConnectionsStore.getAll(),
            mcpConnectionsStore,
            auditLog,
          });
      try {
        const { finalOutput } = await session.runChat([], text, {
          sessionId: payload.context.userId
            ? String(payload.context.userId)
            : undefined,
        });
        const assistantText =
          finalOutput?.trim() ||
          "Scheduled task completed (no clear response from agent).";
        await auditLog.appendAuditEntry({
          type: "scheduled_task",
          payload: {
            intent: payload.intent,
            context: payload.context,
            ...(payload.execute_at ? { execute_at: payload.execute_at } : {}),
            ...(payload.cron ? { cron: payload.cron } : {}),
          },
        });
        auditLog.emitResponse({
          type: "response",
          text: assistantText,
          eventId: event.id,
          userInput: text,
        });
      } finally {
        if (!mcpManager) await session.closeMcp();
      }
    } catch (err) {
      debug("scheduled task handler error: %o", err);
      const msg = (err as Error).message;
      await auditLog.appendAuditEntry({
        type: "scheduled_task",
        payload: {
          intent: payload.intent,
          context: payload.context,
          ...(payload.execute_at ? { execute_at: payload.execute_at } : {}),
          ...(payload.cron ? { cron: payload.cron } : {}),
          error: msg,
        },
      });
      auditLog.emitResponse({
        type: "response",
        text: `Scheduled task failed: ${msg}. Check API logs.`,
        eventId: event.id,
        userInput: text,
      });
    }
  });
}
