import type { Request } from "express";
import type { Server as SocketServer } from "socket.io";
import type { RawDispatchInput } from "../types.js";
import type { ContextStore } from "../agents/context.js";
import type { AuditLog } from "../audit.js";
import type { ScheduleService } from "../data/scheduler.js";
import type { MCPConnectionsStore } from "../data/mcp-connections-store.js";
import type { AttachmentStore } from "../data/attachment-store.js";

export interface AppContext {
  enqueue: (
    raw: RawDispatchInput,
    options?: { correlationId?: string },
  ) => Promise<string>;
  context: ContextStore;
  auditLog: AuditLog;
  responseStore: Map<
    string,
    Array<{ role: "user" | "assistant"; text: string }>
  >;
  scheduler: ScheduleService;
  io: SocketServer;
  mcpConnectionsStore: MCPConnectionsStore;
  attachmentStore: AttachmentStore;
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
