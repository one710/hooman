/**
 * Socket.IO client for chat results. API returns 202 + eventId; worker posts result;
 * API emits "chat-result"; we wait for the matching eventId so the UI gets the reply without blocking.
 */
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 min

let socketInstance: Socket | null = null;

export interface ChatResultMessage {
  role: "assistant";
  text: string;
}

export interface ChatResultPayload {
  eventId: string;
  message: ChatResultMessage;
}

/** Emitted when the agent chose not to respond ([hooman:skip]). Reject from waitForChatResult so the UI can stop "thinking" without showing a message. */
export interface ChatSkippedPayload {
  eventId: string;
}

/** Thrown when the server emits chat-skipped for the requested eventId (agent chose not to respond). */
export class ChatSkippedError extends Error {
  constructor() {
    super("Chat skipped");
    this.name = "ChatSkippedError";
  }
}

import { getToken } from "./auth";

/**
 * Connect to the API's Socket.IO server. Call once (e.g. when the app or Chat mounts).
 * Uses the same base as the API (VITE_API_BASE or http://localhost:3000 in dev).
 * When web auth is enabled, passes JWT in auth for Socket.IO middleware.
 */
export function getSocket(baseUrl?: string): Socket {
  const url = (
    baseUrl ??
    import.meta.env.VITE_API_BASE ??
    "http://localhost:3000"
  ).trim();
  const origin = url || "http://localhost:3000";
  if (socketInstance?.connected) return socketInstance;
  if (socketInstance) socketInstance.disconnect();
  const token = getToken();
  socketInstance = io(origin, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: true,
    auth: token ? { token } : {},
  });
  return socketInstance;
}

/** Disconnect and clear cached socket (e.g. after login so next getSocket() uses new token). */
export function resetSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

/**
 * Wait for a chat-result event with the given eventId. Resolves with the message when the worker posts it.
 * Rejects with ChatSkippedError when the agent chose not to respond (chat-skipped).
 * Rejects on timeout or if the socket disconnects before receiving the result.
 */
export function waitForChatResult(
  eventId: string,
  options?: { timeoutMs?: number; baseUrl?: string },
): Promise<ChatResultMessage> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options?.baseUrl ?? import.meta.env.VITE_API_BASE;
  const s = getSocket(baseUrl);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Chat response timed out. The worker may be busy or unavailable.",
        ),
      );
    }, timeoutMs);

    const resultHandler = (payload: ChatResultPayload) => {
      if (payload.eventId !== eventId) return;
      cleanup();
      resolve(payload.message);
    };

    const skippedHandler = (payload: ChatSkippedPayload) => {
      if (payload.eventId !== eventId) return;
      cleanup();
      reject(new ChatSkippedError());
    };

    const onDisconnect = (reason: string) => {
      cleanup();
      reject(new Error(`Socket disconnected: ${reason}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      s.off("chat-result", resultHandler);
      s.off("chat-skipped", skippedHandler);
      s.off("disconnect", onDisconnect);
    };

    s.on("chat-result", resultHandler);
    s.on("chat-skipped", skippedHandler);
    s.once("disconnect", onDisconnect);
    if (s.connected) {
      // already connected
    } else {
      s.once("connect", () => {});
    }
  });
}
