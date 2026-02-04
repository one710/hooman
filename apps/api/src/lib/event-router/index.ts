import createDebug from "debug";
import type { IncomingEvent } from "../types/index.js";
import { randomUUID } from "crypto";

const debug = createDebug("hooman:event-router");

export type EventHandler = (event: IncomingEvent) => void | Promise<void>;

const DEFAULT_PRIORITY: Record<string, number> = {
  "message.sent": 10,
  "task.scheduled": 5,
  internal: 8,
};

const seenEventKeys = new Set<string>();
const DEDUP_TTL_MS = 60_000;

function eventKey(e: IncomingEvent): string {
  return `${e.source}:${e.type}:${JSON.stringify(e.payload)}`;
}

function normalizePriority(e: IncomingEvent): number {
  if (e.priority != null) return e.priority;
  return DEFAULT_PRIORITY[e.type] ?? 5;
}

export class EventRouter {
  private handlers: EventHandler[] = [];
  private queue: IncomingEvent[] = [];
  private processing = false;

  register(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async dispatch(
    raw: Omit<IncomingEvent, "id" | "timestamp">,
    options?: { correlationId?: string },
  ): Promise<string> {
    const id = options?.correlationId ?? randomUUID();
    const event: IncomingEvent = {
      ...raw,
      id,
      timestamp: new Date().toISOString(),
      priority: normalizePriority({
        ...raw,
        id: "",
        timestamp: "",
      } as IncomingEvent),
    };

    const key = eventKey(event);
    if (seenEventKeys.has(key)) return id;
    seenEventKeys.add(key);
    setTimeout(() => seenEventKeys.delete(key), DEDUP_TTL_MS);

    this.queue.push(event);
    this.queue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    await this.processQueue();
    return id;
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      for (const handler of this.handlers) {
        try {
          await handler(event);
        } catch (err) {
          debug("handler error: %o", err);
        }
      }
    }
    this.processing = false;
  }
}
