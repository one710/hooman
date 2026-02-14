/**
 * Shared event handlers for chat, turn_completed, and scheduled tasks.
 * Used by the API (in-memory mode) and by the workers process (BullMQ) so the worker is the only place that runs agents when Redis is used.
 */
import createDebug from "debug";
import type { EventRouter } from "./event-router.js";
import type { ContextStore } from "../agents/context.js";
import type { PersonaEngine } from "../agents/personas.js";
import type { MCPConnectionsStore } from "../data/mcp-connections-store.js";
import type { ScheduleService } from "../data/scheduler.js";
import type { AuditLog } from "../audit.js";
import { runChat } from "../agents/agents-runner.js";
import { createHoomanAgentWithMcp } from "../agents/agents-mcp.js";
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
  } else if (meta.channel === "email") {
    lines.push(`messageId: ${meta.messageId}`);
    lines.push(`from: ${meta.from}`);
    if (meta.fromName) lines.push(`fromName: ${meta.fromName}`);
    lines.push(`to: ${meta.to}`);
    if (meta.inReplyTo) lines.push(`inReplyTo: ${meta.inReplyTo}`);
  }
  lines.push(`directness: ${meta.directness}`);
  if (meta.directnessReason)
    lines.push(`directnessReason: ${meta.directnessReason}`);
  return lines.join("\n");
}

const CHAT_THREAD_LIMIT = 30;
/** Max time to wait for runChat (e.g. handoffs to WebBrowser can block). After this we deliver a timeout message so the UI doesn't stay on "Thinking...". */
const CHAT_TIMEOUT_MS = 90_000;

class ChatTimeoutError extends Error {
  constructor() {
    super("Chat timed out");
    this.name = "ChatTimeoutError";
  }
}

export interface EventHandlerDeps {
  eventRouter: EventRouter;
  context: ContextStore;
  personaEngine: PersonaEngine;
  mcpConnectionsStore: MCPConnectionsStore;
  getConfig: () => {
    OPENAI_API_KEY: string;
    OPENAI_MODEL: string;
    AGENT_NAME: string;
  };
  auditLog: AuditLog;
  /** Schedule service for main agent schedule tools (list/create/cancel). When set, worker passes it so the agent can schedule tasks. */
  scheduler?: ScheduleService;
  /** When set, called for api-source chat to deliver result (API: resolve pending; worker: POST to API). */
  deliverApiResult?: (
    eventId: string,
    message: { role: "assistant"; text: string; lastAgentName?: string },
  ) => void | Promise<void>;
}

export function registerEventHandlers(deps: EventHandlerDeps): void {
  const {
    eventRouter,
    context,
    personaEngine,
    mcpConnectionsStore,
    getConfig,
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
        userAttachmentIds?: string[];
      };
      const { userId, userText, assistantText, userAttachmentIds } = data;
      await context.addTurn(userId, userText, assistantText, userAttachmentIds);
    }
  });

  // Chat handler: message.sent → run agents; for api source call deliverApiResult when set
  eventRouter.register(async (event) => {
    if (event.payload.kind !== "message") return;
    const { text, userId, attachments, attachment_ids, channelMeta } =
      event.payload;
    const textPreview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
    await auditLog.appendAuditEntry({
      type: "incoming_message",
      payload: {
        source: event.source,
        userId,
        textPreview,
        channel: (channelMeta as { channel?: string } | undefined)?.channel,
        eventId: event.id,
      },
    });
    const sourceLabel = event.source === "api" ? "ui" : event.source;
    await context.addToMemory(
      [{ role: "user", content: `[${sourceLabel}] ${text}` }],
      { userId, metadata: { source: event.source } },
    );
    const config = getConfig();
    let assistantText = "";
    try {
      const recent = await context.getRecentMessages(userId, CHAT_THREAD_LIMIT);
      const thread = recent.map((m) => ({ role: m.role, content: m.text }));
      const memories = await context.search(text, { userId, limit: 5 });
      const memoryContext =
        memories.length > 0
          ? memories.map((m) => `- ${m.memory}`).join("\n")
          : "";
      const personas = personaEngine.getAll();
      const connections = await mcpConnectionsStore.getAll();
      const { agent, closeMcp } = await createHoomanAgentWithMcp(
        personas,
        connections,
        scheduler ? { scheduleService: scheduler } : undefined,
      );
      try {
        const channelContext = buildChannelContext(
          channelMeta as ChannelMeta | undefined,
        );
        const runPromise = runChat(agent, thread, text, {
          memoryContext,
          channelContext,
          attachments,
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new ChatTimeoutError()), CHAT_TIMEOUT_MS);
        });
        const { finalOutput, lastAgentName, newItems } = await Promise.race([
          runPromise,
          timeoutPromise,
        ]);
        assistantText =
          finalOutput?.trim() ||
          "I didn't get a clear response. Try rephrasing or check your API key and model settings.";
        const handoffs = (newItems ?? []).filter(
          (i) =>
            i.type === "handoff_call_item" || i.type === "handoff_output_item",
        );
        await auditLog.appendAuditEntry({
          type: "agent_run",
          payload: {
            userInput: text,
            response: assistantText,
            lastAgentName: lastAgentName ?? getConfig().AGENT_NAME,
            handoffs: handoffs.map((h) => ({
              type: h.type,
              from: h.agent?.name ?? h.sourceAgent?.name,
              to: h.targetAgent?.name,
            })),
          },
        });
        auditLog.emitResponse({
          type: "response",
          text: assistantText,
          eventId: event.id,
          userInput: text,
        });
        await context.addToMemory(
          [{ role: "assistant", content: assistantText }],
          { userId, metadata: { source: event.source } },
        );
        await eventRouter.dispatch({
          source: "api",
          type: "chat.turn_completed",
          payload: {
            userId,
            userText: text,
            assistantText,
            ...(attachment_ids?.length
              ? { userAttachmentIds: attachment_ids }
              : {}),
          },
        } as RawDispatchInput);
        if (deliverApiResult && event.source === "api") {
          await deliverApiResult(event.id, {
            role: "assistant",
            text: assistantText,
            lastAgentName: lastAgentName ?? undefined,
          });
        }
      } finally {
        await closeMcp();
      }
    } catch (err) {
      if (err instanceof ChatTimeoutError) {
        debug(
          "Chat timed out after %s ms (handoff may still be running)",
          CHAT_TIMEOUT_MS,
        );
        assistantText =
          "This is taking longer than expected. The agent may be using a tool or waiting on a handoff. You can try again or rephrase.";
      } else {
        const msg = (err as Error).message;
        assistantText = !config.OPENAI_API_KEY?.trim()
          ? `[${getConfig().AGENT_NAME}] No LLM API key configured. Set it in Settings to enable chat.`
          : `Something went wrong: ${msg}. Check API logs.`;
      }
      await context.addToMemory(
        [{ role: "assistant", content: assistantText }],
        { userId, metadata: { source: event.source } },
      );
      await eventRouter.dispatch({
        source: "api",
        type: "chat.turn_completed",
        payload: {
          userId,
          userText: text,
          assistantText,
          ...(attachment_ids?.length
            ? { userAttachmentIds: attachment_ids }
            : {}),
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
    await context.addToMemory(
      [{ role: "user", content: `[scheduler] ${text}` }],
      { userId: "default", metadata: { source: "scheduler" } },
    );
    try {
      const memories = await context.search(text, {
        userId: "default",
        limit: 5,
      });
      const memoryContext =
        memories.length > 0
          ? memories.map((m) => `- ${m.memory}`).join("\n")
          : "";
      const personas = personaEngine.getAll();
      const connections = await mcpConnectionsStore.getAll();
      const { agent, closeMcp } = await createHoomanAgentWithMcp(
        personas,
        connections,
        scheduler ? { scheduleService: scheduler } : undefined,
      );
      try {
        const { finalOutput, lastAgentName, newItems } = await runChat(
          agent,
          [],
          text,
          { memoryContext },
        );
        const assistantText =
          finalOutput?.trim() ||
          "Scheduled task completed (no clear response from agent).";
        const handoffs = (newItems ?? []).filter(
          (i) =>
            i.type === "handoff_call_item" || i.type === "handoff_output_item",
        );
        await auditLog.appendAuditEntry({
          type: "scheduled_task",
          payload: {
            execute_at: payload.execute_at,
            intent: payload.intent,
            context: payload.context,
          },
        });
        await auditLog.appendAuditEntry({
          type: "agent_run",
          payload: {
            userInput: text,
            response: assistantText,
            lastAgentName: lastAgentName ?? getConfig().AGENT_NAME,
            handoffs: handoffs.map((h) => ({
              type: h.type,
              from: h.agent?.name ?? h.sourceAgent?.name,
              to: h.targetAgent?.name,
            })),
          },
        });
        auditLog.emitResponse({
          type: "response",
          text: assistantText,
          eventId: event.id,
          userInput: text,
        });
        await context.addToMemory(
          [{ role: "assistant", content: assistantText }],
          { userId: "default", metadata: { source: "scheduler" } },
        );
      } finally {
        await closeMcp();
      }
    } catch (err) {
      debug("scheduled task handler error: %o", err);
      const msg = (err as Error).message;
      await context.addToMemory(
        [{ role: "assistant", content: `Scheduled task failed: ${msg}` }],
        { userId: "default", metadata: { source: "scheduler", error: true } },
      );
      await auditLog.appendAuditEntry({
        type: "scheduled_task",
        payload: {
          execute_at: payload.execute_at,
          intent: payload.intent,
          context: payload.context,
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
