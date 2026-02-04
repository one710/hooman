// Events
export type EventSource = "ui" | "api" | "mcp" | "scheduler" | "internal";

export interface BaseEvent {
  id: string;
  source: EventSource;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
  priority?: number;
}

export interface UIChatEvent extends BaseEvent {
  source: "ui";
  type: "message.sent";
  payload: { text: string; userId?: string };
}

export interface ScheduledEvent extends BaseEvent {
  source: "scheduler";
  type: "task.scheduled";
  payload: {
    execute_at: string;
    intent: string;
    context: Record<string, unknown>;
  };
}

export type IncomingEvent = BaseEvent | UIChatEvent | ScheduledEvent;

// Normalized events: common payload shape regardless of source (PRD §8)
export type NormalizedPayloadKind =
  | "message"
  | "scheduled_task"
  | "integration_event"
  | "internal";

export interface NormalizedMessagePayload {
  kind: "message";
  text: string;
  userId: string;
}

export interface NormalizedScheduledTaskPayload {
  kind: "scheduled_task";
  execute_at: string;
  intent: string;
  context: Record<string, unknown>;
}

export interface NormalizedIntegrationEventPayload {
  kind: "integration_event";
  integrationId: string;
  originalType: string;
  payload: Record<string, unknown>;
}

export interface NormalizedInternalPayload {
  kind: "internal";
  data: Record<string, unknown>;
}

export type NormalizedPayload =
  | NormalizedMessagePayload
  | NormalizedScheduledTaskPayload
  | NormalizedIntegrationEventPayload
  | NormalizedInternalPayload;

export interface NormalizedEvent {
  id: string;
  source: EventSource;
  type: string;
  payload: NormalizedPayload;
  timestamp: string;
  priority: number;
}

/** Raw input for dispatch; normalizer converts to NormalizedEvent. */
export interface RawDispatchInput {
  source: EventSource;
  type: string;
  payload: Record<string, unknown>;
  priority?: number;
}

// Decisions
export type DecisionType =
  | "ignore"
  | "respond_directly"
  | "delegate_single"
  | "delegate_multiple"
  | "schedule_future"
  | "ask_user"
  | "escalate_risk";

export interface Decision {
  type: DecisionType;
  eventId: string;
  reasoning?: string;
  payload?: {
    colleagueIds?: string[];
    response?: string;
    scheduledAt?: string;
    intent?: string;
    context?: Record<string, unknown>;
    capabilityRequest?: {
      integration: string;
      capability: string;
      reason: string;
    };
  };
}

// Memory
export type MemoryType =
  | "short_term"
  | "episodic"
  | "long_term"
  | "colleague_scoped"
  | "summary";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  colleagueId?: string;
  createdAt: string;
}

// Colleagues
export type AutonomyLevel = "ask_first" | "autonomous" | "report_only";

export interface ColleagueConfig {
  id: string;
  description: string;
  responsibilities: string;
  allowed_capabilities: string[];
  autonomy: { default: AutonomyLevel };
  memory: { scope: "role" | "global" };
  reporting: {
    on: ("task_complete" | "uncertainty" | "error")[];
  };
}

// Integrations & capabilities
export interface IntegrationCapability {
  integrationId: string;
  capability: string;
  granted: boolean;
  grantedAt?: string;
}

// Audit & safety
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  type:
    | "decision"
    | "action"
    | "permission"
    | "memory_write"
    | "escalation"
    | "agent_run"
    | "scheduled_task";
  payload: Record<string, unknown>;
}

export interface KillSwitchState {
  enabled: boolean;
  reason?: string;
  at?: string;
}

// MCP connection configs (aligned with OpenAI Agents SDK MCP: Hosted, Streamable HTTP, Stdio)
export type MCPRequireApproval =
  | "always"
  | "never"
  | Record<string, "always" | "never">;

export interface MCPConnectionHosted {
  id: string;
  type: "hosted";
  /** Server label exposed to the model (e.g. "gitmcp"). */
  server_label: string;
  /** Public MCP server URL (required). */
  server_url: string;
  /** "always" | "never" or per-tool map. */
  require_approval: MCPRequireApproval;
  /** When true, use streaming for hosted MCP results. */
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
