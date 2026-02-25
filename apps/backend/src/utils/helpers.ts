import type { Request } from "express";
import type { Server as SocketServer } from "socket.io";
import type { RawDispatchInput } from "../types.js";
import type { ChatService } from "../chats/chat-service.js";
import type { AttachmentService } from "../attachments/attachment-service.js";
import type { AuditLog } from "../audit/audit.js";
import type { ScheduleService } from "../scheduling/schedule-service.js";
import type { MCPConnectionsStore } from "../capabilities/mcp/connections-store.js";
import type { SkillService } from "../capabilities/skills/skills-service.js";
import type { McpService } from "../capabilities/mcp/mcp-service.js";
import type { ChannelService } from "../channels/channel-service.js";

export interface AppContext {
  enqueue: (
    raw: RawDispatchInput,
    options?: { correlationId?: string },
  ) => Promise<string>;
  chatService: ChatService;
  attachmentService: AttachmentService;
  auditLog: AuditLog;
  responseStore: Map<
    string,
    Array<{ role: "user" | "assistant"; text: string }>
  >;
  scheduler: ScheduleService;
  io: SocketServer;
  mcpConnectionsStore: MCPConnectionsStore;
  skillService: SkillService;
  mcpService: McpService;
  channelService: ChannelService;
}

export function getParam(req: Request, key: string): string {
  const v = req.params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function mask(s: string): string {
  return s?.length ? `${s.slice(0, 4)}…` : "";
}

export function isMasked(s: unknown): boolean {
  return typeof s === "string" && (s.endsWith("…") || s.length < 10);
}

/**
 * Serialize value to string and truncate to at most maxChars, appending "… (N chars total)" when truncated.
 */
export function truncateForMax(value: unknown, maxChars: number): string {
  const s =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}… (${s.length} chars total)`;
}

export async function runWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number | null,
  timeoutError: Error,
): Promise<T> {
  if (timeoutMs === null) {
    return fn();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const task = fn();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) task.catch(() => undefined);
  }
}
