/**
 * Shared event handlers for chat, turn_completed, and scheduled tasks.
 * Used by the event-queue worker (BullMQ) — the only place that runs agents.
 */
import createDebug from "debug";
import type { EventRouter } from "./event-router.js";
import type { ContextStore } from "../agents/context.js";
import type { AuditLog } from "../audit/audit.js";
import { McpManager } from "../capabilities/mcp/manager.js";
import type {
  ChannelMeta,
  ResponseDeliveryPayload,
  SlackChannelMeta,
  WhatsAppChannelMeta,
} from "../types.js";
import { HOOMAN_SKIP_MARKER } from "../types.js";
import { getConfig } from "../config.js";

const debug = createDebug("hooman:event-handlers");

/** Default chat timeout when config CHAT_TIMEOUT_MS is 0 or unset. */
const DEFAULT_CHAT_TIMEOUT_MS = 300_000;

class ChatTimeoutError extends Error {
  constructor() {
    super("Chat timed out");
    this.name = "ChatTimeoutError";
  }
}

export interface EventHandlerDeps {
  eventRouter: EventRouter;
  context: ContextStore;
  auditLog: AuditLog;
  /** Publishes response to Redis; API/Slack/WhatsApp subscribers deliver accordingly. */
  publishResponseDelivery: (payload: ResponseDeliveryPayload) => void;
  /** Long-lived MCP session manager. */
  mcpManager: McpManager;
}

export function registerEventHandlers(deps: EventHandlerDeps): void {
  const {
    eventRouter,
    context,
    auditLog,
    publishResponseDelivery,
    mcpManager,
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
    try {
      const thread = await context.getThreadForAgent(userId);
      const session = await mcpManager.getSession();
      const runPromise = session.generate(thread, text, {
        channel: channelMeta as ChannelMeta | undefined,
        attachments: attachmentContents,
        sessionId: userId,
      });
      const chatTimeoutMs =
        getConfig().CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new ChatTimeoutError()), chatTimeoutMs);
      });
      const { output, messages } = await Promise.race([
        runPromise,
        timeoutPromise,
      ]);
      const rawOutput =
        output?.trim() ||
        "I didn't get a clear response. Try rephrasing or check your API key and model settings.";
      assistantText = rawOutput;
      auditLog.emitResponse({
        type: "response",
        text: assistantText,
        eventId: event.id,
        userInput: text,
      });
      // Notify frontend/channels immediately so the user sees the reply without waiting for persistence
      await dispatchResponseToChannel(
        event.id,
        event.source,
        channelMeta as ChannelMeta | undefined,
        assistantText,
      );
      if (messages?.length) {
        await context.addTurnMessages(userId, messages);
        await context.addTurnToChatHistory(
          userId,
          text,
          assistantText,
          attachments,
        );
      } else {
        await context.addTurn(userId, text, assistantText, attachments);
      }
    } catch (err) {
      if (err instanceof ChatTimeoutError) {
        const chatTimeoutMs =
          getConfig().CHAT_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS;
        debug("Chat timed out after %s ms", chatTimeoutMs);
        assistantText =
          "This is taking longer than expected. The agent may be using a tool. You can try again or rephrase.";
      } else {
        const msg = (err as Error).message;
        assistantText = `Something went wrong: ${msg}. Check API logs.`;
      }
      await context.addTurn(userId, text, assistantText, attachments);
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
    try {
      const session = await mcpManager.getSession();
      const { output } = await session.generate([], text, {
        sessionId: payload.context.userId
          ? String(payload.context.userId)
          : undefined,
      });
      const assistantText =
        output?.trim() ||
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
