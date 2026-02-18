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

/**
 * Connect to the API's Socket.IO server. Call once (e.g. when the app or Chat mounts).
 * Uses the same base as the API (VITE_API_BASE or http://localhost:3000 in dev).
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
  socketInstance = io(origin, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: true,
  });
  return socketInstance;
}

/**
 * Wait for a chat-result event with the given eventId. Resolves with the message when the worker posts it.
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

    const handler = (payload: ChatResultPayload) => {
      if (payload.eventId !== eventId) return;
      cleanup();
      resolve(payload.message);
    };

    const onDisconnect = (reason: string) => {
      cleanup();
      reject(new Error(`Socket disconnected: ${reason}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      s.off("chat-result", handler);
      s.off("disconnect", onDisconnect);
    };

    s.on("chat-result", handler);
    s.once("disconnect", onDisconnect);
    if (s.connected) {
      // already connected
    } else {
      s.once("connect", () => {});
    }
  });
}
