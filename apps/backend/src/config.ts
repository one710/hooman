import createDebug from "debug";
import { readFile, writeFile } from "fs/promises";
import { getWorkspaceConfigPath, WORKSPACE_ROOT } from "./workspace.js";
import type { ChannelsConfig } from "./types.js";
import { env } from "./env.js";

const debug = createDebug("hooman:config");

const CONFIG_PATH = getWorkspaceConfigPath();

/** Default configurable system instructions (personality, persona handoff). User can override in Settings. */
export const DEFAULT_AGENT_INSTRUCTIONS = `You are Hooman, a digital concierge that operates on behalf of the user.
Be conversational and human-first. Use memory context when provided to tailor and remember preferences.
When a task fits a specialized persona (by role and capabilities), hand off to that persona to do it; otherwise respond yourself.`;

/**
 * Static instructions always appended to the agent (not user-configurable).
 * Covers channel replies and WhatsApp chat ID so the agent always follows these rules.
 */
export const STATIC_AGENT_INSTRUCTIONS_APPEND = `
## Channel replies (IMPORTANT)

You receive messages from different channels (web chat, Slack, WhatsApp, Email).
When a "[Channel context]" block is present in the conversation, you MUST reply on that channel
using the available MCP tools. This is mandatory — do not skip it or just respond in text.

Steps when channel context is present:
1. Read the source_channel and identifiers (chatId, channelId, messageId, etc.) from the channel context.
2. Compose your reply text.
3. Call the appropriate MCP tool to send the reply on the source channel:
   - WhatsApp → call whatsapp_send_message with the chatId and your reply text.
   - Slack → call the Slack MCP tool to post a message in the channelId. Using threadTs to reply in-thread is optional — use your judgment (e.g. DMs often feel more natural without threading).
   - Email → call the email MCP tool to reply to the message.
4. Your final text output should be the same reply you sent via the tool.

## WhatsApp chat ID from phone number

When the user asks you to message them (or someone) on WhatsApp and gives a phone number, you can derive the chatId yourself. Format: digits only (country code + number, no + or spaces) followed by @c.us. Examples:
- +1 555 123 4567 → 15551234567@c.us
- +91 98765 43210 → 919876543210@c.us
- 44 20 7123 4567 → 442071234567@c.us
Strip all non-digits from the number, then append @c.us. Use that as chatId in whatsapp_send_message. Do not ask the user to "share the chat ID" or "message first" if they have already provided a phone number.

## Current time and time-critical operations

Before doing any time-critical operation or anything that involves the current date/time (e.g. scheduling, reminders, "in 2 hours", "by tomorrow", interpreting "now" or "today"), use the available time tool to get the current time. Use get_current_time from the _default_time MCP server (or the equivalent time tool if exposed under another name) so your answers and scheduled tasks are based on the actual current time, not guesswork.

Never fabricate tool results. If a tool call fails, report the actual error.`;

/** LLM provider identifier for agent chat model. */
export type LLMProviderId =
  | "openai"
  | "azure"
  | "anthropic"
  | "amazon-bedrock"
  | "google"
  | "google-vertex"
  | "mistral"
  | "deepseek";

/** Settings UI / persisted config (API key, embedding model, LLM model, web search, MCP, transcription, agent). */
export interface PersistedConfig {
  LLM_PROVIDER: LLMProviderId;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_EMBEDDING_MODEL: string;
  OPENAI_WEB_SEARCH: boolean;
  MCP_USE_SERVER_MANAGER: boolean;
  OPENAI_TRANSCRIPTION_MODEL: string;
  AGENT_NAME: string;
  AGENT_INSTRUCTIONS: string;
  /** Azure OpenAI */
  AZURE_RESOURCE_NAME: string;
  AZURE_API_KEY: string;
  AZURE_API_VERSION: string;
  /** Anthropic */
  ANTHROPIC_API_KEY: string;
  /** Amazon Bedrock */
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  /** Google Generative AI */
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  /** Google Vertex */
  GOOGLE_VERTEX_PROJECT: string;
  GOOGLE_VERTEX_LOCATION: string;
  GOOGLE_VERTEX_API_KEY: string;
  /** Mistral */
  MISTRAL_API_KEY: string;
  /** DeepSeek */
  DEEPSEEK_API_KEY: string;
}

/** Full config: persisted + PORT from env. */
export interface AppConfig extends PersistedConfig {
  PORT: number;
}

const DEFAULTS: PersistedConfig = {
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-5.2",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  OPENAI_WEB_SEARCH: false,
  MCP_USE_SERVER_MANAGER: false,
  OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
  AGENT_NAME: "Hooman",
  AGENT_INSTRUCTIONS: DEFAULT_AGENT_INSTRUCTIONS,
  AZURE_RESOURCE_NAME: "",
  AZURE_API_KEY: "",
  AZURE_API_VERSION: "",
  ANTHROPIC_API_KEY: "",
  AWS_REGION: "",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_SESSION_TOKEN: "",
  GOOGLE_GENERATIVE_AI_API_KEY: "",
  GOOGLE_VERTEX_PROJECT: "",
  GOOGLE_VERTEX_LOCATION: "",
  GOOGLE_VERTEX_API_KEY: "",
  MISTRAL_API_KEY: "",
  DEEPSEEK_API_KEY: "",
};

let store: PersistedConfig = { ...DEFAULTS };
let channelsStore: ChannelsConfig = {};

export function getConfig(): AppConfig {
  return { ...store, PORT: env.PORT };
}

const LLM_PROVIDER_IDS: LLMProviderId[] = [
  "openai",
  "azure",
  "anthropic",
  "amazon-bedrock",
  "google",
  "google-vertex",
  "mistral",
  "deepseek",
];

function isLLMProviderId(v: unknown): v is LLMProviderId {
  return typeof v === "string" && LLM_PROVIDER_IDS.includes(v as LLMProviderId);
}

export function updateConfig(patch: Partial<PersistedConfig>): PersistedConfig {
  if (patch.LLM_PROVIDER !== undefined && isLLMProviderId(patch.LLM_PROVIDER))
    store.LLM_PROVIDER = patch.LLM_PROVIDER;
  if (patch.OPENAI_API_KEY !== undefined)
    store.OPENAI_API_KEY = String(patch.OPENAI_API_KEY);
  if (patch.OPENAI_MODEL !== undefined)
    store.OPENAI_MODEL =
      String(patch.OPENAI_MODEL).trim() || DEFAULTS.OPENAI_MODEL;
  if (patch.OPENAI_EMBEDDING_MODEL !== undefined)
    store.OPENAI_EMBEDDING_MODEL =
      String(patch.OPENAI_EMBEDDING_MODEL).trim() ||
      DEFAULTS.OPENAI_EMBEDDING_MODEL;
  if (patch.OPENAI_WEB_SEARCH !== undefined)
    store.OPENAI_WEB_SEARCH = Boolean(patch.OPENAI_WEB_SEARCH);
  if (patch.MCP_USE_SERVER_MANAGER !== undefined)
    store.MCP_USE_SERVER_MANAGER = Boolean(patch.MCP_USE_SERVER_MANAGER);
  if (patch.OPENAI_TRANSCRIPTION_MODEL !== undefined)
    store.OPENAI_TRANSCRIPTION_MODEL =
      String(patch.OPENAI_TRANSCRIPTION_MODEL).trim() ||
      DEFAULTS.OPENAI_TRANSCRIPTION_MODEL;
  if (patch.AGENT_NAME !== undefined)
    store.AGENT_NAME = String(patch.AGENT_NAME).trim() || DEFAULTS.AGENT_NAME;
  if (patch.AGENT_INSTRUCTIONS !== undefined)
    store.AGENT_INSTRUCTIONS =
      String(patch.AGENT_INSTRUCTIONS).trim() || DEFAULTS.AGENT_INSTRUCTIONS;
  if (patch.AZURE_RESOURCE_NAME !== undefined)
    store.AZURE_RESOURCE_NAME = String(patch.AZURE_RESOURCE_NAME);
  if (patch.AZURE_API_KEY !== undefined)
    store.AZURE_API_KEY = String(patch.AZURE_API_KEY);
  if (patch.AZURE_API_VERSION !== undefined)
    store.AZURE_API_VERSION = String(patch.AZURE_API_VERSION);
  if (patch.ANTHROPIC_API_KEY !== undefined)
    store.ANTHROPIC_API_KEY = String(patch.ANTHROPIC_API_KEY);
  if (patch.AWS_REGION !== undefined)
    store.AWS_REGION = String(patch.AWS_REGION);
  if (patch.AWS_ACCESS_KEY_ID !== undefined)
    store.AWS_ACCESS_KEY_ID = String(patch.AWS_ACCESS_KEY_ID);
  if (patch.AWS_SECRET_ACCESS_KEY !== undefined)
    store.AWS_SECRET_ACCESS_KEY = String(patch.AWS_SECRET_ACCESS_KEY);
  if (patch.AWS_SESSION_TOKEN !== undefined)
    store.AWS_SESSION_TOKEN = String(patch.AWS_SESSION_TOKEN);
  if (patch.GOOGLE_GENERATIVE_AI_API_KEY !== undefined)
    store.GOOGLE_GENERATIVE_AI_API_KEY = String(
      patch.GOOGLE_GENERATIVE_AI_API_KEY,
    );
  if (patch.GOOGLE_VERTEX_PROJECT !== undefined)
    store.GOOGLE_VERTEX_PROJECT = String(patch.GOOGLE_VERTEX_PROJECT);
  if (patch.GOOGLE_VERTEX_LOCATION !== undefined)
    store.GOOGLE_VERTEX_LOCATION = String(patch.GOOGLE_VERTEX_LOCATION);
  if (patch.GOOGLE_VERTEX_API_KEY !== undefined)
    store.GOOGLE_VERTEX_API_KEY = String(patch.GOOGLE_VERTEX_API_KEY);
  if (patch.MISTRAL_API_KEY !== undefined)
    store.MISTRAL_API_KEY = String(patch.MISTRAL_API_KEY);
  if (patch.DEEPSEEK_API_KEY !== undefined)
    store.DEEPSEEK_API_KEY = String(patch.DEEPSEEK_API_KEY);
  persist().catch((err) => debug("persist error: %o", err));
  return { ...store };
}

export function getChannelsConfig(): ChannelsConfig {
  return { ...channelsStore };
}

export function updateChannelsConfig(
  patch: Partial<ChannelsConfig>,
): ChannelsConfig {
  if (patch.slack !== undefined) channelsStore.slack = patch.slack;
  if (patch.email !== undefined) channelsStore.email = patch.email;
  if (patch.whatsapp !== undefined) channelsStore.whatsapp = patch.whatsapp;
  persist().catch((err) => debug("persist error: %o", err));
  return getChannelsConfig();
}

async function persist(): Promise<void> {
  try {
    const { mkdir } = await import("fs/promises");
    await mkdir(WORKSPACE_ROOT, { recursive: true });
    const blob = { ...store, channels: channelsStore };
    await writeFile(CONFIG_PATH, JSON.stringify(blob, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

export async function loadPersisted(): Promise<void> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistedConfig> & {
      channels?: ChannelsConfig;
    };
    if (parsed && typeof parsed === "object") {
      if (parsed.OPENAI_API_KEY !== undefined)
        store.OPENAI_API_KEY = String(parsed.OPENAI_API_KEY);
      if (parsed.OPENAI_MODEL !== undefined)
        store.OPENAI_MODEL =
          String(parsed.OPENAI_MODEL).trim() || DEFAULTS.OPENAI_MODEL;
      if (parsed.OPENAI_EMBEDDING_MODEL !== undefined)
        store.OPENAI_EMBEDDING_MODEL =
          String(parsed.OPENAI_EMBEDDING_MODEL).trim() ||
          DEFAULTS.OPENAI_EMBEDDING_MODEL;
      if (parsed.OPENAI_WEB_SEARCH !== undefined)
        store.OPENAI_WEB_SEARCH = Boolean(parsed.OPENAI_WEB_SEARCH);
      if (parsed.MCP_USE_SERVER_MANAGER !== undefined)
        store.MCP_USE_SERVER_MANAGER = Boolean(parsed.MCP_USE_SERVER_MANAGER);
      if (parsed.OPENAI_TRANSCRIPTION_MODEL !== undefined)
        store.OPENAI_TRANSCRIPTION_MODEL =
          String(parsed.OPENAI_TRANSCRIPTION_MODEL).trim() ||
          DEFAULTS.OPENAI_TRANSCRIPTION_MODEL;
      if (parsed.AGENT_NAME !== undefined)
        store.AGENT_NAME =
          String(parsed.AGENT_NAME).trim() || DEFAULTS.AGENT_NAME;
      if (parsed.AGENT_INSTRUCTIONS !== undefined)
        store.AGENT_INSTRUCTIONS =
          String(parsed.AGENT_INSTRUCTIONS).trim() ||
          DEFAULTS.AGENT_INSTRUCTIONS;
      if (
        parsed.LLM_PROVIDER !== undefined &&
        isLLMProviderId(parsed.LLM_PROVIDER)
      )
        store.LLM_PROVIDER = parsed.LLM_PROVIDER;
      if (parsed.AZURE_RESOURCE_NAME !== undefined)
        store.AZURE_RESOURCE_NAME = String(parsed.AZURE_RESOURCE_NAME);
      if (parsed.AZURE_API_KEY !== undefined)
        store.AZURE_API_KEY = String(parsed.AZURE_API_KEY);
      if (parsed.AZURE_API_VERSION !== undefined)
        store.AZURE_API_VERSION = String(parsed.AZURE_API_VERSION);
      if (parsed.ANTHROPIC_API_KEY !== undefined)
        store.ANTHROPIC_API_KEY = String(parsed.ANTHROPIC_API_KEY);
      if (parsed.AWS_REGION !== undefined)
        store.AWS_REGION = String(parsed.AWS_REGION);
      if (parsed.AWS_ACCESS_KEY_ID !== undefined)
        store.AWS_ACCESS_KEY_ID = String(parsed.AWS_ACCESS_KEY_ID);
      if (parsed.AWS_SECRET_ACCESS_KEY !== undefined)
        store.AWS_SECRET_ACCESS_KEY = String(parsed.AWS_SECRET_ACCESS_KEY);
      if (parsed.AWS_SESSION_TOKEN !== undefined)
        store.AWS_SESSION_TOKEN = String(parsed.AWS_SESSION_TOKEN);
      if (parsed.GOOGLE_GENERATIVE_AI_API_KEY !== undefined)
        store.GOOGLE_GENERATIVE_AI_API_KEY = String(
          parsed.GOOGLE_GENERATIVE_AI_API_KEY,
        );
      if (parsed.GOOGLE_VERTEX_PROJECT !== undefined)
        store.GOOGLE_VERTEX_PROJECT = String(parsed.GOOGLE_VERTEX_PROJECT);
      if (parsed.GOOGLE_VERTEX_LOCATION !== undefined)
        store.GOOGLE_VERTEX_LOCATION = String(parsed.GOOGLE_VERTEX_LOCATION);
      if (parsed.GOOGLE_VERTEX_API_KEY !== undefined)
        store.GOOGLE_VERTEX_API_KEY = String(parsed.GOOGLE_VERTEX_API_KEY);
      if (parsed.MISTRAL_API_KEY !== undefined)
        store.MISTRAL_API_KEY = String(parsed.MISTRAL_API_KEY);
      if (parsed.DEEPSEEK_API_KEY !== undefined)
        store.DEEPSEEK_API_KEY = String(parsed.DEEPSEEK_API_KEY);
      if (parsed.channels && typeof parsed.channels === "object")
        channelsStore = { ...parsed.channels };
    }
  } catch {
    // no file or invalid
  }
}
