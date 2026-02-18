/**
 * HTTP client for workers to post events to the API. Used by apps/workers (Slack, WhatsApp, etc.)
 * when running as separate processes. The API exposes POST /api/internal/dispatch.
 */
import type { RawDispatchInput } from "./types.js";

const DEFAULT_HEADERS = { "Content-Type": "application/json" };

export interface DispatchClientOptions {
  apiBaseUrl: string;
  /** Optional secret sent as X-Internal-Secret; must match API's INTERNAL_SECRET env. */
  secret?: string;
}

/**
 * Create a client that dispatches events by POSTing to the API. Returns a promise that resolves
 * to the event id returned by the API, or rejects on error.
 */
export function createDispatchClient(options: DispatchClientOptions): {
  dispatch: (raw: RawDispatchInput) => Promise<string>;
} {
  const { apiBaseUrl, secret } = options;
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/internal/dispatch`;
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };
  if (secret) headers["X-Internal-Secret"] = secret;

  return {
    async dispatch(
      raw: RawDispatchInput,
      _options?: { correlationId?: string },
    ): Promise<string> {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(raw),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`dispatch failed: ${res.status} ${text}`);
      }
      const data = (await res.json()) as { id?: string };
      return typeof data.id === "string" ? data.id : "";
    },
  };
}
