/**
 * Event normalisation: raw dispatch input → NormalizedEvent.
 * Shared by API, workers, and EventRouter so any process can enqueue directly.
 */
import type {
  RawDispatchInput,
  NormalizedEvent,
  NormalizedPayload,
  ChannelMeta,
} from "../types.js";
import { randomUUID } from "crypto";

const DEFAULT_PRIORITY: Record<string, number> = {
  "message.sent": 10,
  "task.scheduled": 5,
  internal: 8,
};

export function normalizePriority(raw: RawDispatchInput): number {
  if (raw.priority != null) return raw.priority;
  return DEFAULT_PRIORITY[raw.type] ?? 5;
}

/**
 * Normalize raw dispatch input into a canonical payload shape (PRD §8).
 */
export function normalizePayload(
  source: RawDispatchInput["source"],
  type: string,
  payload: Record<string, unknown>,
): NormalizedPayload {
  if (type === "message.sent") {
    const text = typeof payload.text === "string" ? payload.text : "";
    const userId =
      typeof payload.userId === "string" ? payload.userId : "default";
    const attachmentContents = Array.isArray(payload.attachmentContents)
      ? (
          payload.attachmentContents as Array<{
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
    const attachments = Array.isArray(payload.attachments)
      ? (payload.attachments as string[]).filter((id) => typeof id === "string")
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
      ...(attachmentContents?.length ? { attachmentContents } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(channelMeta ? { channelMeta } : {}),
      ...(sourceMessageType ? { sourceMessageType } : {}),
    };
  }
  if (type === "task.scheduled") {
    const execute_at =
      typeof payload.execute_at === "string" && payload.execute_at.trim() !== ""
        ? payload.execute_at.trim()
        : undefined;
    const intent = typeof payload.intent === "string" ? payload.intent : "";
    const context =
      payload.context && typeof payload.context === "object"
        ? (payload.context as Record<string, unknown>)
        : {};
    const cron =
      typeof payload.cron === "string" && payload.cron.trim() !== ""
        ? payload.cron.trim()
        : undefined;
    return {
      kind: "scheduled_task",
      intent,
      context,
      ...(execute_at !== undefined ? { execute_at } : {}),
      ...(cron ? { cron } : {}),
    };
  }
  if (type === "chat.turn_completed") {
    return { kind: "internal", data: payload };
  }
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
  return { kind: "internal", data: payload };
}

export function eventKey(e: NormalizedEvent): string {
  return `${e.source}:${e.type}:${JSON.stringify(e.payload)}`;
}

export function createNormalizedEvent(
  raw: RawDispatchInput,
  options?: { correlationId?: string },
): NormalizedEvent {
  const id = options?.correlationId ?? randomUUID();
  const timestamp = new Date().toISOString();
  const priority = normalizePriority(raw);
  const payload = normalizePayload(raw.source, raw.type, raw.payload);
  return {
    id,
    source: raw.source,
    type: raw.type,
    payload,
    timestamp,
    priority,
  };
}
