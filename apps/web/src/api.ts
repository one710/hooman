const BASE = "";

function apiError(res: Response, body: string): string {
  const msg =
    body?.trim() ||
    `${res.status} ${res.statusText}`.trim() ||
    "Request failed";
  return msg;
}

export interface ChatHistoryResponse {
  messages: { role: "user" | "assistant"; text: string }[];
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

export async function sendMessage(text: string): Promise<{
  eventId: string;
  message: { role: "assistant"; text: string; lastAgentName?: string };
}> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(apiError(res, body));
  return JSON.parse(body);
}

export async function getColleagues(): Promise<{
  colleagues: import("./types").ColleagueConfig[];
}> {
  const res = await fetch(`${BASE}/api/colleagues`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createColleague(
  colleague: import("./types").ColleagueConfig,
): Promise<{ colleague: import("./types").ColleagueConfig }> {
  const res = await fetch(`${BASE}/api/colleagues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(colleague),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateColleague(
  id: string,
  patch: Partial<import("./types").ColleagueConfig>,
): Promise<{ colleague: import("./types").ColleagueConfig }> {
  const res = await fetch(`${BASE}/api/colleagues/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteColleague(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/colleagues/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
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

export async function getCapabilities(): Promise<{
  capabilities: {
    integrationId: string;
    capability: string;
    granted?: boolean;
  }[];
}> {
  const res = await fetch(`${BASE}/api/capabilities`);
  if (!res.ok) return { capabilities: [] };
  return res.json();
}

/** Available capabilities from configured MCP connections (for Colleagues dropdown). */
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

export async function getHealth(): Promise<{
  status: string;
  killSwitch?: boolean;
}> {
  const res = await fetch(`${BASE}/health`);
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
