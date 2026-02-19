import createDebug from "debug";
import type { RawDispatchInput, NormalizedEvent } from "../types.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { createNormalizedEvent, eventKey } from "./normalize.js";

const debug = createDebug("hooman:event-router");

export type EventHandler = (event: NormalizedEvent) => void | Promise<void>;

const seenEventKeys = new Set<string>();
const DEDUP_TTL_MS = 60_000;

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
    const event = createNormalizedEvent(raw, options);

    const key = eventKey(event);
    if (seenEventKeys.has(key)) return event.id;
    seenEventKeys.add(key);
    setTimeout(() => seenEventKeys.delete(key), DEDUP_TTL_MS);

    if (this.queueAdapter) {
      await this.queueAdapter.add(event);
      return event.id;
    }

    this.queue.push(event);
    this.queue.sort((a, b) => b.priority - a.priority);
    await this.processQueue();
    return event.id;
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
