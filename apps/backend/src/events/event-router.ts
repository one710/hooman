import createDebug from "debug";
import type {
  RawDispatchInput,
  NormalizedEvent,
  NormalizedPayload,
  ChannelMeta,
} from "../types.js";
import { randomUUID } from "crypto";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";

const debug = createDebug("hooman:event-router");

export type EventHandler = (event: NormalizedEvent) => void | Promise<void>;

const DEFAULT_PRIORITY: Record<string, number> = {
  "message.sent": 10,
  "task.scheduled": 5,
  internal: 8,
};

const seenEventKeys = new Set<string>();
const DEDUP_TTL_MS = 60_000;

function eventKey(e: NormalizedEvent): string {
  return `${e.source}:${e.type}:${JSON.stringify(e.payload)}`;
}

function normalizePriority(raw: RawDispatchInput): number {
  if (raw.priority != null) return raw.priority;
  return DEFAULT_PRIORITY[raw.type] ?? 5;
}

/**
 * Normalize raw dispatch input into a canonical payload shape (PRD §8).
 * All handlers receive NormalizedEvent so sources (UI, API, MCP, scheduler) are handled uniformly.
 */
function normalizePayload(
  source: RawDispatchInput["source"],
  type: string,
  payload: Record<string, unknown>,
): NormalizedPayload {
  if (type === "message.sent") {
    const text = typeof payload.text === "string" ? payload.text : "";
    const userId =
      typeof payload.userId === "string" ? payload.userId : "default";
    const attachments = Array.isArray(payload.attachments)
      ? (
          payload.attachments as Array<{
            name: string;
            contentType: string;
            data: string;
          }>
        ).filter(
          (a) =>
            typeof a?.name === "string" &&
            typeof a?.contentType === "string" &&
            typeof a?.data === "string",
        )
      : undefined;
    const attachment_ids = Array.isArray(payload.attachment_ids)
      ? (payload.attachment_ids as string[]).filter(
          (id) => typeof id === "string",
        )
      : undefined;
    const channelMeta =
      payload.channelMeta &&
      typeof payload.channelMeta === "object" &&
      (payload.channelMeta as ChannelMeta).channel &&
      ((payload.channelMeta as ChannelMeta).directness === "direct" ||
        (payload.channelMeta as ChannelMeta).directness === "neutral")
        ? (payload.channelMeta as ChannelMeta)
        : undefined;
    const sourceMessageType =
      payload.sourceMessageType === "audio" ? ("audio" as const) : undefined;
    return {
      kind: "message",
      text,
      userId,
      attachments,
      attachment_ids,
      ...(channelMeta ? { channelMeta } : {}),
      ...(sourceMessageType ? { sourceMessageType } : {}),
    };
  }
  if (type === "task.scheduled") {
    const execute_at =
      typeof payload.execute_at === "string" ? payload.execute_at : "";
    const intent = typeof payload.intent === "string" ? payload.intent : "";
    const context =
      payload.context && typeof payload.context === "object"
        ? (payload.context as Record<string, unknown>)
        : {};
    return { kind: "scheduled_task", execute_at, intent, context };
  }
  if (type === "chat.turn_completed") {
    return { kind: "internal", data: payload };
  }
  // Future: MCP/integration events → kind: "integration_event"
  if (
    source === "mcp" &&
    typeof payload.integrationId === "string" &&
    typeof payload.originalType === "string"
  ) {
    return {
      kind: "integration_event",
      integrationId: payload.integrationId as string,
      originalType: payload.originalType as string,
      payload: (payload.payload as Record<string, unknown>) ?? {},
    };
  }
  // Unknown: wrap as internal
  return { kind: "internal", data: payload };
}

/** Adapter for pushing events to a queue (e.g. BullMQ). When set, dispatch() enqueues; worker runs runHandlersForEvent. */
export type EventQueueAdapter = {
  add(event: NormalizedEvent): Promise<string>;
};

export class EventRouter {
  private handlers: EventHandler[] = [];
  private queue: NormalizedEvent[] = [];
  private processing = false;
  private queueAdapter: EventQueueAdapter | null = null;

  /** Use a queue (e.g. BullMQ) so dispatch() enqueues and a worker calls runHandlersForEvent. */
  setQueueAdapter(adapter: EventQueueAdapter | null): void {
    this.queueAdapter = adapter;
  }

  register(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /**
   * Run all registered handlers for one event. Used by the queue worker.
   */
  async runHandlersForEvent(event: NormalizedEvent): Promise<void> {
    if (getKillSwitchEnabled()) return;
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (err) {
        debug("handler error: %o", err);
      }
    }
  }

  /**
   * Dispatch a raw event. Normalizes, dedupes, then either enqueues (if queue adapter set) or processes in-memory.
   */
  async dispatch(
    raw: RawDispatchInput,
    options?: { correlationId?: string },
  ): Promise<string> {
    const id = options?.correlationId ?? randomUUID();
    const timestamp = new Date().toISOString();
    const priority = normalizePriority(raw);
    const payload = normalizePayload(raw.source, raw.type, raw.payload);

    const event: NormalizedEvent = {
      id,
      source: raw.source,
      type: raw.type,
      payload,
      timestamp,
      priority,
    };

    const key = eventKey(event);
    if (seenEventKeys.has(key)) return id;
    seenEventKeys.add(key);
    setTimeout(() => seenEventKeys.delete(key), DEDUP_TTL_MS);

    if (this.queueAdapter) {
      await this.queueAdapter.add(event);
      return id;
    }

    this.queue.push(event);
    this.queue.sort((a, b) => b.priority - a.priority);
    await this.processQueue();
    return id;
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    if (getKillSwitchEnabled()) return;
    this.processing = true;
    while (this.queue.length > 0) {
      if (getKillSwitchEnabled()) break;
      const event = this.queue.shift()!;
      await this.runHandlersForEvent(event);
    }
    this.processing = false;
  }
}
