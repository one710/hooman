import { clearToken, getToken } from "./auth";
import type { AuditEntry, MCPConnection } from "./types";

/** API base URL. Set VITE_API_BASE when building, or defaults to http://localhost:3000. */
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

function apiError(res: Response, body: string): string {
  const msg =
    body?.trim() ||
    `${res.status} ${res.statusText}`.trim() ||
    "Request failed";
  return msg;
}

/** Fetch with Authorization header when token exists; on 401 clear token and redirect to login. */
async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  return res;
}

/** Login (no auth header). Returns token on success; throws on failure. */
export async function login(
  username: string,
  password: string,
): Promise<{ token: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(apiError(res, body));
  const data = JSON.parse(body) as { token?: string };
  if (typeof data?.token !== "string")
    throw new Error("Invalid login response");
  return { token: data.token };
}

export interface ChatAttachmentMeta {
  id: string;
  originalName: string;
  mimeType: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  text: string;
  /** ISO timestamp from server. */
  timestamp?: string;
  attachments?: string[];
  attachment_metas?: ChatAttachmentMeta[];
}

export interface ChatHistoryResponse {
  messages: ChatHistoryMessage[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getChatHistory(params?: {
  page?: number;
  pageSize?: number;
}): Promise<ChatHistoryResponse> {
  const sp = new URLSearchParams();
  if (params?.page != null) sp.set("page", String(params.page));
  if (params?.pageSize != null) sp.set("pageSize", String(params.pageSize));
  const url = `${BASE}/api/chat/history` + (sp.toString() ? `?${sp}` : "");
  const res = await authFetch(url);
  if (!res.ok)
    return {
      messages: [],
      total: 0,
      page: 1,
      pageSize: params?.pageSize ?? 50,
    };
  const data = await res.json();
  return {
    messages: data.messages ?? [],
    total: data.total ?? data.messages?.length ?? 0,
    page: data.page ?? 1,
    pageSize: data.pageSize ?? params?.pageSize ?? 50,
  };
}

export async function clearChatHistory(): Promise<{ cleared: boolean }> {
  const res = await authFetch(`${BASE}/api/chat/history`, { method: "DELETE" });
  if (!res.ok) throw new Error(apiError(res, await res.text()));
  return res.json();
}

/** Upload files; returns server attachment ids and meta for state/send. */
export async function uploadAttachments(
  files: File[],
): Promise<{ attachments: ChatAttachmentMeta[] }> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await authFetch(`${BASE}/api/chat/attachments`, {
    method: "POST",
    body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(apiError(res, body));
  const data = JSON.parse(body) as {
    attachments?: { id: string; originalName: string; mimeType: string }[];
  };
  return {
    attachments: (data.attachments ?? []).map((a) => ({
      id: a.id,
      originalName: a.originalName,
      mimeType: a.mimeType,
    })),
  };
}

/** URL to load an attachment (image src or download link). */
export function getAttachmentUrl(id: string): string {
  return `${BASE}/api/chat/attachments/${encodeURIComponent(id)}`;
}

/** WebSocket URL for Deepgram live transcription proxy (voice input when provider is deepgram). */
export function getRealtimeWsUrl(token: string | null): string {
  const base = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
  const wsBase = base.replace(/^http/, "ws");
  const path = "/ws/transcribe";
  return token
    ? `${wsBase}${path}?token=${encodeURIComponent(token)}`
    : `${wsBase}${path}`;
}

/** Provider and optional ephemeral secret for realtime transcription (voice input). */
export async function getRealtimeClientSecret(model?: string): Promise<{
  provider: string;
  value?: string;
}> {
  const res = await authFetch(`${BASE}/api/realtime/client-secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model != null ? { model } : {}),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(apiError(res, body));
  return JSON.parse(body) as { provider: string; value?: string };
}

/** POST /api/chat returns 202 with eventId; the actual reply is delivered via Socket.IO (use waitForChatResult in socket.ts). */
export async function sendMessage(
  text: string,
  attachments?: string[],
): Promise<{ eventId: string }> {
  const res = await authFetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      attachments?.length ? { text, attachments } : { text },
    ),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(apiError(res, body));
  const data = JSON.parse(body) as { eventId: string };
  return { eventId: data.eventId };
}

export async function getAudit(): Promise<{
  entries: AuditEntry[];
}> {
  const res = await authFetch(`${BASE}/api/audit`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getKillSwitch(): Promise<{ enabled: boolean }> {
  const res = await authFetch(`${BASE}/api/safety/kill-switch`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function setKillSwitch(
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const res = await authFetch(`${BASE}/api/safety/kill-switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Channel list and config (secrets masked). */
export interface ChannelEntry {
  id: string;
  name: string;
  alwaysOn?: boolean;
  enabled?: boolean;
  config: Record<string, unknown> | null;
}

export async function getChannels(): Promise<{
  channels: Record<string, ChannelEntry>;
}> {
  const res = await authFetch(`${BASE}/api/channels`);
  if (!res.ok) throw new Error(apiError(res, await res.text()));
  return res.json();
}

/** Patch channel config (partial merge; masked secrets are not overwritten). */
export async function patchChannels(patch: {
  slack?: Record<string, unknown>;
  whatsapp?: Record<string, unknown>;
}): Promise<{ channels: Record<string, unknown> }> {
  const res = await authFetch(`${BASE}/api/channels`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(apiError(res, await res.text()));
  return res.json();
}

/** WhatsApp connection status (for showing QR in Settings when linking device). */
export async function getWhatsAppConnection(): Promise<{
  status: "disconnected" | "pairing" | "connected";
  qr?: string;
  /** Logged-in user ID (e.g. 1234567890@c.us). */
  selfId?: string;
  /** Display number (e.g. +1234567890). */
  selfNumber?: string;
}> {
  const res = await authFetch(`${BASE}/api/channels/whatsapp/connection`);
  if (!res.ok) return { status: "disconnected" };
  return res.json();
}

const EXPECTED_STATUSES = ["ok", "degraded"] as const;

export type HealthData = {
  status: (typeof EXPECTED_STATUSES)[number];
  killSwitch?: boolean;
  services?: {
    redis?: { status: string; error?: string; latencyMs?: number };
    chroma?: { status: string; error?: string; latencyMs?: number };
    eventQueue?: { status: string; error?: string; latencyMs?: number };
  };
};

/**
 * Returns health payload when API is reachable and response is valid JSON with status "ok" or "degraded".
 * Returns null when API is unreachable: 4xx/5xx (other than 503 with valid degraded body), invalid JSON, or missing/invalid status.
 */
export async function getHealth(): Promise<HealthData | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/health`);
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || !("status" in data)) {
    return null;
  }
  const status = (data as { status?: string }).status;
  if (status !== "ok" && status !== "degraded") {
    return null;
  }
  if (res.ok && status === "ok") {
    return data as HealthData;
  }
  if (res.status === 503 && status === "degraded") {
    return data as HealthData;
  }
  return null;
}

export interface DiscoveredTool {
  id: string;
  name: string;
  description?: string;
  connectionId: string;
  connectionName: string;
}

export async function getDiscoveredTools(): Promise<{
  tools: DiscoveredTool[];
}> {
  const res = await authFetch(`${BASE}/api/capabilities/mcp/tools`);
  if (!res.ok) return { tools: [] };
  return res.json();
}

export async function reloadMcpTools(): Promise<{
  tools: DiscoveredTool[];
}> {
  const res = await authFetch(`${BASE}/api/capabilities/mcp/reload`, {
    method: "POST",
  });
  if (!res.ok) return { tools: [] };
  return res.json();
}

export type LLMProviderId =
  | "openai"
  | "azure"
  | "anthropic"
  | "amazon-bedrock"
  | "google"
  | "google-vertex"
  | "mistral"
  | "deepseek";

export type TranscriptionProviderId = "openai" | "azure" | "deepgram";

export interface AppConfig {
  LLM_PROVIDER?: LLMProviderId;
  TRANSCRIPTION_PROVIDER?: TranscriptionProviderId;
  OPENAI_API_KEY: string;
  CHAT_MODEL: string;
  TRANSCRIPTION_MODEL: string;
  AGENT_NAME: string;
  AGENT_INSTRUCTIONS: string;
  AZURE_CHAT_RESOURCE_NAME?: string;
  AZURE_TRANSCRIPTION_RESOURCE_NAME?: string;
  AZURE_API_KEY?: string;
  AZURE_API_VERSION?: string;
  DEEPGRAM_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  GOOGLE_VERTEX_PROJECT?: string;
  GOOGLE_VERTEX_LOCATION?: string;
  GOOGLE_VERTEX_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  COMPLETIONS_API_KEY?: string;
  /** Max input tokens (context window). 0 or unset = 100000 default. Conversation and memory are trimmed to stay under this. */
  MAX_INPUT_TOKENS?: number;
  /** Chat timeout in milliseconds. 0 or unset = 300000 (5 min). */
  CHAT_TIMEOUT_MS?: number;
}

export async function getConfig(): Promise<AppConfig> {
  const res = await authFetch(`${BASE}/api/config`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveConfig(
  patch: Partial<AppConfig>,
): Promise<AppConfig> {
  const res = await authFetch(`${BASE}/api/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getSchedule(): Promise<{
  tasks: {
    id: string;
    execute_at?: string;
    cron?: string;
    intent: string;
    context: Record<string, unknown>;
  }[];
}> {
  const res = await authFetch(`${BASE}/api/schedule`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createScheduledTask(
  intent: string,
  context: Record<string, unknown>,
  options: { execute_at?: string; cron?: string },
): Promise<{ id: string }> {
  const { execute_at, cron } = options;
  if (!execute_at && !cron) {
    throw new Error("Provide either execute_at or cron.");
  }
  const res = await authFetch(`${BASE}/api/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent,
      context,
      ...(execute_at ? { execute_at } : {}),
      ...(cron ? { cron } : {}),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateScheduledTask(
  id: string,
  intent: string,
  context: Record<string, unknown>,
  options: { execute_at?: string; cron?: string },
): Promise<void> {
  const { execute_at, cron } = options;
  if (!execute_at && !cron) {
    throw new Error("Provide either execute_at or cron.");
  }
  const res = await authFetch(`${BASE}/api/schedule/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent,
      context,
      ...(execute_at ? { execute_at } : {}),
      ...(cron ? { cron } : {}),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function cancelScheduledTask(id: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/schedule/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
}

// MCP connections (Hosted, Streamable HTTP, Stdio)
export async function getMCPConnections(): Promise<{
  connections: MCPConnection[];
}> {
  const res = await authFetch(`${BASE}/api/capabilities/mcp/connections`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createMCPConnection(
  connection: MCPConnection,
): Promise<{ connection: MCPConnection }> {
  const res = await authFetch(`${BASE}/api/capabilities/mcp/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateMCPConnection(
  id: string,
  patch: Partial<MCPConnection>,
): Promise<{ connection: MCPConnection }> {
  const res = await authFetch(
    `${BASE}/api/capabilities/mcp/connections/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteMCPConnection(id: string): Promise<void> {
  const res = await authFetch(
    `${BASE}/api/capabilities/mcp/connections/${id}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) throw new Error(await res.text());
}

/** OAuth callback URL for MCP (to prefill redirect_uri). */
export async function getOAuthCallbackUrl(): Promise<{ callbackUrl: string }> {
  const res = await authFetch(
    `${BASE}/api/capabilities/mcp/oauth/callback-url`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Start OAuth flow for an MCP connection; returns URL to open or already_authorized. */
export async function startMCPOAuth(
  connectionId: string,
): Promise<{ authorizationUrl: string } | { status: "already_authorized" }> {
  const res = await authFetch(`${BASE}/api/capabilities/mcp/oauth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Skills (list from project .agents/skills; add/remove via npx skills CLI)
export interface SkillsListResponse {
  output?: string;
  error?: string;
  code?: number | null;
}

export interface SkillEntry {
  id: string;
  name: string;
  description?: string;
}

export interface SkillsListApiResponse {
  skills: SkillEntry[];
  error?: string;
}

export async function getSkillsList(): Promise<SkillsListApiResponse> {
  const res = await authFetch(`${BASE}/api/skills/list`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getSkillContent(skillId: string): Promise<{
  content: string;
}> {
  const res = await authFetch(
    `${BASE}/api/skills/${encodeURIComponent(skillId)}/content`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addSkillsPackage(options: {
  package: string;
  skills?: string[];
}): Promise<SkillsListResponse> {
  const res = await authFetch(`${BASE}/api/skills/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function removeSkillsPackage(
  skills: string[],
): Promise<SkillsListResponse> {
  const res = await authFetch(`${BASE}/api/skills/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
