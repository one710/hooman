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
