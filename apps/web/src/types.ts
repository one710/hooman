export type View =
  | "chat"
  | "colleagues"
  | "schedule"
  | "audit"
  | "safety"
  | "capabilities"
  | "settings";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Set when the response came from a colleague (handoff). */
  lastAgentName?: string;
}

export type AutonomyLevel = "ask_first" | "autonomous" | "report_only";

export interface ColleagueConfig {
  id: string;
  description: string;
  responsibilities: string;
  allowed_capabilities: string[];
  autonomy: { default: AutonomyLevel };
  memory: { scope: string };
  reporting: { on: string[] };
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
  created_at?: string;
}

export type MCPConnection =
  | MCPConnectionHosted
  | MCPConnectionStreamableHttp
  | MCPConnectionStdio;
