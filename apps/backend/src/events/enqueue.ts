/**
 * Shared enqueue: normalize raw input and add to queue. Used by API and workers
 * so all producers push events directly to BullMQ.
 */
import type { RawDispatchInput, EventDispatcher } from "../types.js";
import { createNormalizedEvent, eventKey } from "./normalize.js";
import type { EventQueueAdapter } from "./event-queue.js";

export async function enqueueRaw(
  queue: EventQueueAdapter,
  raw: RawDispatchInput,
  options?: {
    correlationId?: string;
    dedupSet?: Set<string>;
  },
): Promise<string> {
  const event = createNormalizedEvent(raw, {
    correlationId: options?.correlationId,
  });
  const key = eventKey(event);
  if (options?.dedupSet?.has(key)) return event.id;
  options?.dedupSet?.add(key);
  const id = await queue.add(event);
  return id;
}

export function createQueueDispatcher(
  queue: EventQueueAdapter,
  options?: { dedupSet?: Set<string> },
): EventDispatcher {
  return {
    async dispatch(raw, opts) {
      return enqueueRaw(queue, raw, {
        correlationId: opts?.correlationId,
        dedupSet: options?.dedupSet,
      });
    },
  };
}
