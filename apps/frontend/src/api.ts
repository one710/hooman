/** API base URL. Set VITE_API_BASE when building, or defaults to http://localhost:3000. */
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

function apiError(res: Response, body: string): string {
  const msg =
    body?.trim() ||
    `${res.status} ${res.statusText}`.trim() ||
    "Request failed";
  return msg;
}

export interface ChatAttachmentMeta {
  id: string;
  originalName: string;
  mimeType: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  text: string;
  attachment_ids?: string[];
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
  const res = await fetch(url);
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
  const res = await fetch(`${BASE}/api/chat/history`, { method: "DELETE" });
  if (!res.ok) throw new Error(apiError(res, await res.text()));
  return res.json();
}

/** Upload files; returns server attachment ids and meta for state/send. */
export async function uploadAttachments(
  files: File[],
): Promise<{ attachments: ChatAttachmentMeta[] }> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch(`${BASE}/api/chat/attachments`, {
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

/** Ephemeral client secret for Realtime API transcription (voice input). */
export async function getRealtimeClientSecret(model?: string): Promise<{
  value: string;
}> {
  const res = await fetch(`${BASE}/api/realtime/client-secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model != null ? { model } : {}),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(apiError(res, body));
  return JSON.parse(body) as { value: string };
}

/** POST /api/chat returns 202 with eventId; the actual reply is delivered via Socket.IO (use waitForChatResult in socket.ts). */
export async function sendMessage(
  text: string,
  attachment_ids?: string[],
): Promise<{ eventId: string }> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      attachment_ids?.length ? { text, attachment_ids } : { text },
    ),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(apiError(res, body));
  const data = JSON.parse(body) as { eventId: string };
  return { eventId: data.eventId };
}

export async function getAudit(): Promise<{
  entries: import("./types").AuditEntry[];
}> {
  const res = await fetch(`${BASE}/api/audit`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getKillSwitch(): Promise<{ enabled: boolean }> {
  const res = await fetch(`${BASE}/api/safety/kill-switch`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Available capabilities from configured MCP connections. */
export async function getCapabilitiesAvailable(): Promise<{
  capabilities: { integrationId: string; capability: string }[];
}> {
  const res = await fetch(`${BASE}/api/capabilities/available`);
  if (!res.ok) return { capabilities: [] };
  return res.json();
}

export async function setKillSwitch(
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const res = await fetch(`${BASE}/api/safety/kill-switch`, {
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
  const res = await fetch(`${BASE}/api/channels`);
  if (!res.ok) throw new Error(apiError(res, await res.text()));
  return res.json();
}

/** Patch channel config (partial merge; masked secrets are not overwritten). */
export async function patchChannels(patch: {
  slack?: Record<string, unknown>;
  whatsapp?: Record<string, unknown>;
}): Promise<{ channels: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/channels`, {
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
  const res = await fetch(`${BASE}/api/channels/whatsapp/connection`);
  if (!res.ok) return { status: "disconnected" };
  return res.json();
}

export async function getHealth(): Promise<{
  status: string;
  killSwitch?: boolean;
}> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(await res.text());
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
  OPENAI_MODEL: string;
  OPENAI_WEB_SEARCH: boolean;
  MCP_USE_SERVER_MANAGER: boolean;
  OPENAI_TRANSCRIPTION_MODEL: string;
  AGENT_NAME: string;
  AGENT_INSTRUCTIONS: string;
  AZURE_RESOURCE_NAME?: string;
  AZURE_API_KEY?: string;
  AZURE_API_VERSION?: string;
  AZURE_TRANSCRIPTION_DEPLOYMENT?: string;
  DEEPGRAM_API_KEY?: string;
  DEEPGRAM_TRANSCRIPTION_MODEL?: string;
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
}

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch(`${BASE}/api/config`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveConfig(
  patch: Partial<AppConfig>,
): Promise<AppConfig> {
  const res = await fetch(`${BASE}/api/config`, {
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
    execute_at: string;
    intent: string;
    context: Record<string, unknown>;
  }[];
}> {
  const res = await fetch(`${BASE}/api/schedule`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createScheduledTask(
  execute_at: string,
  intent: string,
  context: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ execute_at, intent, context }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function cancelScheduledTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/schedule/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

// MCP connections (Hosted, Streamable HTTP, Stdio)
export async function getMCPConnections(): Promise<{
  connections: import("./types").MCPConnection[];
}> {
  const res = await fetch(`${BASE}/api/mcp/connections`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createMCPConnection(
  connection: import("./types").MCPConnection,
): Promise<{ connection: import("./types").MCPConnection }> {
  const res = await fetch(`${BASE}/api/mcp/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateMCPConnection(
  id: string,
  patch: Partial<import("./types").MCPConnection>,
): Promise<{ connection: import("./types").MCPConnection }> {
  const res = await fetch(`${BASE}/api/mcp/connections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteMCPConnection(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/mcp/connections/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
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
  const res = await fetch(`${BASE}/api/skills/list`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getSkillContent(skillId: string): Promise<{
  content: string;
}> {
  const res = await fetch(
    `${BASE}/api/skills/${encodeURIComponent(skillId)}/content`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addSkillsPackage(options: {
  package: string;
  skills?: string[];
}): Promise<SkillsListResponse> {
  const res = await fetch(`${BASE}/api/skills/add`, {
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
  const res = await fetch(`${BASE}/api/skills/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
