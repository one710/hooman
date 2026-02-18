/**
 * Shared event handlers for chat, turn_completed, and scheduled tasks.
 * Used by the API (in-memory mode) and by the workers process (BullMQ) so the worker is the only place that runs agents when Redis is used.
 */
import createDebug from "debug";
import type { EventRouter } from "./event-router.js";
import type { ContextStore } from "../agents/context.js";
import type { MCPConnectionsStore } from "../data/mcp-connections-store.js";
import type { ScheduleService } from "../data/scheduler.js";
import type { AuditLog } from "../audit.js";
import { createHoomanRunner } from "../agents/hooman-runner.js";
import {
  trimContextToTokenBudget,
  RESERVED_TOKENS,
} from "../agents/trim-context.js";
import { getConfig } from "../config.js";
import type { RawDispatchInput, ChannelMeta } from "../types.js";

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

/** Chunk size when loading history for agent context. Fetch 50, trim to budget, then fetch older 50 and trim again until no space or no more messages. */
const CHAT_CONTEXT_CHUNK_SIZE = 50;

/** Max time to wait for runChat. After this we deliver a timeout message so the UI doesn't stay on "Thinking...". */
const CHAT_TIMEOUT_MS = 300_000;

/** Load messages in chunks of 50 via getMessages (last page first): fetch last 50, trim to budget; if there's space, fetch next 50 older, trim again; repeat until budget full or no more messages. Returns thread for runChat. */
async function getThreadForAgent(
  context: ContextStore,
  userId: string,
): Promise<{
  thread: Array<{ role: "user" | "assistant"; content: string }>;
}> {
  const effectiveMax = getConfig().MAX_INPUT_TOKENS ?? 100_000;
  let thread: Array<{ role: "user" | "assistant"; content: string }> = [];

  const first = await context.getMessages(userId, {
    page: 1,
    pageSize: CHAT_CONTEXT_CHUNK_SIZE,
  });
  if (first.total === 0) return { thread };

  const lastPage = Math.ceil(first.total / CHAT_CONTEXT_CHUNK_SIZE) || 1;
  for (let page = lastPage; page >= 1; page--) {
    const messages =
      page === 1 && lastPage === 1
        ? first.messages
        : (
            await context.getMessages(userId, {
              page,
              pageSize: CHAT_CONTEXT_CHUNK_SIZE,
            })
          ).messages;
    if (messages.length === 0) break;

    const chunkAsThread = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));
    thread = [...chunkAsThread, ...thread];
    const previousLen = thread.length - chunkAsThread.length;
    thread = trimContextToTokenBudget(thread, effectiveMax, RESERVED_TOKENS);
    if (thread.length <= previousLen) break;
  }

  return { thread };
}

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
  /** Schedule service for main agent schedule tools (list/create/cancel). When set, worker passes it so the agent can schedule tasks. */
  scheduler?: ScheduleService;
  /** When set, called for api-source chat to deliver result (API: resolve pending; worker: POST to API). */
  deliverApiResult?: (
    eventId: string,
    message: { role: "assistant"; text: string },
  ) => void | Promise<void>;
}

export function registerEventHandlers(deps: EventHandlerDeps): void {
  const {
    eventRouter,
    context,
    mcpConnectionsStore,
    auditLog,
    scheduler,
    deliverApiResult,
  } = deps;

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

  // Chat handler: message.sent → run agents; for api source call deliverApiResult when set
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
      const { thread } = await getThreadForAgent(context, userId);
      const connections = await mcpConnectionsStore.getAll();
      const session = await createHoomanRunner({
        connections,
        scheduleService: scheduler,
        mcpConnectionsStore,
      });
      try {
        const channelContext = buildChannelContext(
          channelMeta as ChannelMeta | undefined,
        );
        const runPromise = session.runChat(thread, text, {
          channelContext,
          attachments: attachmentContents,
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new ChatTimeoutError()), CHAT_TIMEOUT_MS);
        });
        const { finalOutput } = await Promise.race([
          runPromise,
          timeoutPromise,
        ]);
        assistantText =
          finalOutput?.trim() ||
          "I didn't get a clear response. Try rephrasing or check your API key and model settings.";
        await auditLog.appendAuditEntry({
          type: "agent_run",
          payload: {
            userInput: text,
            response: assistantText,
          },
        });
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
        if (deliverApiResult && event.source === "api") {
          await deliverApiResult(event.id, {
            role: "assistant",
            text: assistantText,
          });
        }
      } finally {
        await session.closeMcp();
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
      if (deliverApiResult && event.source === "api") {
        await deliverApiResult(event.id, {
          role: "assistant",
          text: assistantText,
        });
      }
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
      const connections = await mcpConnectionsStore.getAll();
      const session = await createHoomanRunner({
        connections,
        scheduleService: scheduler,
        mcpConnectionsStore,
      });
      try {
        const { finalOutput } = await session.runChat([], text, {});
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
        await auditLog.appendAuditEntry({
          type: "agent_run",
          payload: {
            userInput: text,
            response: assistantText,
          },
        });
        auditLog.emitResponse({
          type: "response",
          text: assistantText,
          eventId: event.id,
          userInput: text,
        });
      } finally {
        await session.closeMcp();
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
