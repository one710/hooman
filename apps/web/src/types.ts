export type View =
  | "chat"
  | "colleagues"
  | "schedule"
  | "audit"
  | "safety"
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
