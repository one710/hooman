export type View =
  | "chat"
  | "channels"
  | "schedule"
  | "audit"
  | "safety"
  | "capabilities"
  | "settings";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Attachment IDs (for user messages); used when loaded from history. */
  attachment_ids?: string[];
  /** Attachment meta for display (from history or after upload). */
  attachment_metas?: { id: string; originalName: string; mimeType: string }[];
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

// MCP connection configs (mirror API types)
export type MCPRequireApproval = "always" | "never";

export interface MCPConnectionHosted {
  id: string;
  type: "hosted";
  server_label: string;
  server_url: string;
  require_approval: MCPRequireApproval | Record<string, MCPRequireApproval>;
  streaming?: boolean;
  created_at?: string;
}

export interface MCPConnectionStreamableHttp {
  id: string;
  type: "streamable_http";
  name: string;
  url: string;
  headers?: Record<string, string>;
  timeout_seconds?: number;
  cache_tools_list?: boolean;
  max_retry_attempts?: number;
  created_at?: string;
}

export interface MCPConnectionStdio {
  id: string;
  type: "stdio";
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  created_at?: string;
}

export type MCPConnection =
  | MCPConnectionHosted
  | MCPConnectionStreamableHttp
  | MCPConnectionStdio;
