// Events
export type EventSource =
  | "ui"
  | "api"
  | "mcp"
  | "scheduler"
  | "internal"
  | "slack"
  | "whatsapp";

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

// Channel configuration (load/save in config; used by adapters and Channels API)
export type FilterMode = "all" | "allowlist" | "blocklist";

export type SlackConnectAs = "bot" | "user";

export interface SlackChannelConfig {
  enabled: boolean;
  /** App-level token (xapp-...) for Socket Mode connection. */
  appToken: string;
  /** Bot (xoxb) or User (xoxp) token for API and event subscription. */
  userToken: string;
  /** Whether the token is a bot or user token. Affects UI only; adapter uses userToken for both. */
  connectAs?: SlackConnectAs;
  /** Required when connectAs is "user" (identity for directness). Optional when bot. */
  designatedUserId?: string;
  filterMode?: FilterMode;
  filterList?: string[];
}

export interface WhatsAppChannelConfig {
  enabled: boolean;
  /** Folder name only; session is stored under workspace/whatsapp/<sessionPath>. Defaults to "default". */
  sessionPath?: string;
  filterMode?: FilterMode;
  filterList?: string[];
}

export interface ChannelsConfig {
  slack?: SlackChannelConfig;
  whatsapp?: WhatsAppChannelConfig;
}

// Normalized events: common payload shape regardless of source (PRD §8)
export type NormalizedPayloadKind =
  | "message"
  | "scheduled_task"
  | "integration_event"
  | "internal";

export interface ChatAttachment {
  name: string;
  contentType: string;
  data: string; // base64
}

/** Original message info when the inbound message is a reply (thread/quote). */
export interface OriginalMessageInfo {
  senderId?: string;
  senderName?: string;
  from?: string;
  fromName?: string;
  content?: string;
  messageId?: string;
  timestamp?: string;
}

/** Base channel metadata: directness and optional original message. All channel-specific meta extends this. */
export interface ChannelMetaBase {
  directness: "direct" | "neutral";
  directnessReason?: string;
  originalMessage?: OriginalMessageInfo;
}

/** Slack channel metadata. */
export interface SlackChannelMeta extends ChannelMetaBase {
  channel: "slack";
  channelId: string;
  messageTs: string;
  threadTs?: string;
  senderId: string;
  senderName?: string;
  destinationType: "dm" | "channel" | "group";
  mentionedIds?: string[];
  selfMentioned?: boolean;
  /** Designated Slack user ID for the agent in this workspace; when present, messages or mentions to this ID are addressing you. */
  yourSlackUserId?: string;
  /** When true, response delivery should use thread_ts to reply in thread. When false (im/mpim), post to channel root. */
  replyInThread?: boolean;
}

/** When the model outputs this marker, the dispatcher skips sending a reply to the user (no message to channel; web chat gets chat-skipped). */
export const HOOMAN_SKIP_MARKER = "[hooman:skip]";

/** Payload published to Redis for response delivery. API emits via Socket.IO; Slack/WhatsApp send via their clients. */
export type ResponseDeliveryPayload =
  | {
      channel: "api";
      eventId: string;
      message: { role: string; text: string };
    }
  | { channel: "api"; eventId: string; skipped: true }
  | { channel: "slack"; channelId: string; threadTs?: string; text: string }
  | { channel: "whatsapp"; chatId: string; text: string };

/** Redis channel for response delivery (event-queue publishes; API, Slack and WhatsApp workers subscribe). */
export const RESPONSE_DELIVERY_CHANNEL = "hooman:response_delivery";

/** WhatsApp channel metadata. */
export interface WhatsAppChannelMeta extends ChannelMetaBase {
  channel: "whatsapp";
  chatId: string;
  messageId: string;
  pushName?: string;
  destinationType: "dm" | "group";
  mentionedIds?: string[];
  selfMentioned?: boolean;
}

/** Union of all channel-specific metadata. Delivered in run context to the agent. */
export type ChannelMeta = SlackChannelMeta | WhatsAppChannelMeta;

export interface NormalizedMessagePayload {
  kind: "message";
  text: string;
  userId: string;
  /** Resolved attachment content for the agent (name, contentType, data). */
  attachmentContents?: ChatAttachment[];
  /** IDs of uploaded files (for persisting with chat history). */
  attachments?: string[];
  /** Present for slack/whatsapp; who, where, message ID, directness. Passed in run context to the agent. */
  channelMeta?: ChannelMeta;
  /** Set when the message text was transcribed from an audio/voice message. */
  sourceMessageType?: "audio";
}

export interface NormalizedScheduledTaskPayload {
  kind: "scheduled_task";
  execute_at?: string;
  intent: string;
  context: Record<string, unknown>;
  cron?: string;
}

export interface ScheduledTask {
  id: string;
  execute_at?: string; // ISO; required for one-shot, absent for recurring
  intent: string;
  context: Record<string, unknown>;
  cron?: string; // when set, task is recurring
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

/** Used by channel adapters: in-process (eventRouter) or remote (dispatch client). */
export type EventDispatcher = {
  dispatch(
    raw: RawDispatchInput,
    options?: { correlationId?: string },
  ): Promise<string>;
};

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
export type MemoryType = "short_term" | "episodic" | "long_term" | "summary";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
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
    | "scheduled_task"
    | "incoming_message"
    | "tool_call_start"
    | "tool_call_end";
  payload: Record<string, unknown>;
}

export interface KillSwitchState {
  enabled: boolean;
  reason?: string;
  at?: string;
}

// MCP connection configs (Hosted, Streamable HTTP, Stdio)
export type MCPRequireApproval =
  | "always"
  | "never"
  | Record<string, "always" | "never">;

/** OAuth config for MCP HTTP connections. When present, connection uses full OAuth (PKCE, optional DCR). */
export interface MCPOAuthConfig {
  redirect_uri: string;
  client_id?: string;
  client_secret?: string;
  scope?: string;
  /** Override when discovery from MCP URL is not desired. */
  authorization_server_url?: string;
}

/** Persisted OAuth tokens (internal to payload; do not expose in API). */
export interface MCPOAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** Persisted client info from DCR or pre-registration (internal to payload; do not expose in API). */
export interface MCPOAuthClientInformation {
  client_id: string;
  client_secret?: string;
}

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
  /** Optional headers (e.g. Bearer token for OAuth). */
  headers?: Record<string, string>;
  /** When set, use OAuth (PKCE, optional DCR) for this connection. */
  oauth?: MCPOAuthConfig;
  /** Internal: persisted tokens. Do not expose in API. */
  oauth_tokens?: MCPOAuthTokens;
  /** Internal: PKCE code_verifier during flow. Do not expose in API. */
  oauth_code_verifier?: string;
  /** Internal: client from DCR or pre-reg. Do not expose in API. */
  oauth_client_information?: MCPOAuthClientInformation;
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
  /** When set, use OAuth (PKCE, optional DCR) for this connection. */
  oauth?: MCPOAuthConfig;
  /** Internal: persisted tokens. Do not expose in API. */
  oauth_tokens?: MCPOAuthTokens;
  /** Internal: PKCE code_verifier during flow. Do not expose in API. */
  oauth_code_verifier?: string;
  /** Internal: client from DCR or pre-reg. Do not expose in API. */
  oauth_client_information?: MCPOAuthClientInformation;
  created_at?: string;
}

export interface MCPConnectionStdio {
  id: string;
  type: "stdio";
  name: string;
  command: string;
  args: string[];
  /** Optional env vars for the process. */
  env?: Record<string, string>;
  /** Optional working directory. */
  cwd?: string;
  created_at?: string;
}

export type MCPConnection =
  | MCPConnectionHosted
  | MCPConnectionStreamableHttp
  | MCPConnectionStdio;
