import createDebug from "debug";
import { readFile, writeFile, mkdir } from "fs/promises";
import { getWorkspaceConfigPath, WORKSPACE_ROOT } from "./utils/workspace.js";
import type { ChannelsConfig } from "./types.js";
import { env } from "./env.js";
import {
  getDefaultAgentInstructions,
  getFullStaticAgentInstructionsAppend as buildFullStaticAppend,
} from "./utils/prompts.js";

const debug = createDebug("hooman:config");

const CONFIG_PATH = getWorkspaceConfigPath();

/**
 * Full static instructions: base + channel-specific formatting (only for enabled channels).
 * Use this when building the Hooman agent instructions.
 */
export function getFullStaticAgentInstructionsAppend(): string {
  return buildFullStaticAppend(getChannelsConfig());
}

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

/** Transcription provider identifier (separate from LLM provider). */
export type TranscriptionProviderId = "openai" | "azure" | "deepgram";

/** Settings UI / persisted config (API key, LLM model, MCP, transcription, agent). */
export interface PersistedConfig {
  LLM_PROVIDER: LLMProviderId;
  /** Transcription provider (for audio/voice message transcription). */
  TRANSCRIPTION_PROVIDER: TranscriptionProviderId;
  OPENAI_API_KEY: string;
  CHAT_MODEL: string;
  /** Model/deployment id for the selected transcription provider. */
  TRANSCRIPTION_MODEL: string;
  AGENT_NAME: string;
  AGENT_INSTRUCTIONS: string;
  /** Azure OpenAI */
  AZURE_RESOURCE_NAME: string;
  AZURE_API_KEY: string;
  AZURE_API_VERSION: string;
  /** Deepgram (when TRANSCRIPTION_PROVIDER === 'deepgram'). */
  DEEPGRAM_API_KEY: string;
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
  /** Bearer token for OpenAI-compatible /v1/chat/completions endpoint. */
  COMPLETIONS_API_KEY: string;
  /** Max input tokens (context window). 0 or unset = use 100_000 default. Conversation and memory are trimmed to stay under this. */
  MAX_INPUT_TOKENS?: number;
  /** Max turns (steps) the agent can take per run. Default 999. */
  MAX_TURNS?: number;
  /** Chat timeout in milliseconds. After this, user gets a timeout message. 0 or unset = 300000 (5 min). */
  CHAT_TIMEOUT_MS?: number;
}

/** Full config: persisted + PORT from env. */
export interface AppConfig extends PersistedConfig {
  PORT: number;
}

const DEFAULTS: PersistedConfig = {
  LLM_PROVIDER: "openai",
  TRANSCRIPTION_PROVIDER: "openai",
  OPENAI_API_KEY: "",
  CHAT_MODEL: "gpt-5.2",
  TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
  AGENT_NAME: "Hooman",
  AGENT_INSTRUCTIONS: getDefaultAgentInstructions(),
  AZURE_RESOURCE_NAME: "",
  AZURE_API_KEY: "",
  AZURE_API_VERSION: "",
  DEEPGRAM_API_KEY: "",
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
  COMPLETIONS_API_KEY: "",
  MAX_INPUT_TOKENS: 0,
  MAX_TURNS: 999,
  CHAT_TIMEOUT_MS: 300_000,
};

let store: PersistedConfig = { ...DEFAULTS };
let channelsStore: ChannelsConfig = {};

export function getConfig(): AppConfig {
  return {
    ...store,
    PORT: env.PORT,
    AGENT_INSTRUCTIONS:
      store.AGENT_INSTRUCTIONS.trim() || getDefaultAgentInstructions(),
  };
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

const TRANSCRIPTION_PROVIDER_IDS: TranscriptionProviderId[] = [
  "openai",
  "azure",
  "deepgram",
];

function isTranscriptionProviderId(v: unknown): v is TranscriptionProviderId {
  return (
    typeof v === "string" &&
    TRANSCRIPTION_PROVIDER_IDS.includes(v as TranscriptionProviderId)
  );
}

export function updateConfig(patch: Partial<PersistedConfig>): PersistedConfig {
  if (patch.LLM_PROVIDER !== undefined && isLLMProviderId(patch.LLM_PROVIDER))
    store.LLM_PROVIDER = patch.LLM_PROVIDER;
  if (
    patch.TRANSCRIPTION_PROVIDER !== undefined &&
    isTranscriptionProviderId(patch.TRANSCRIPTION_PROVIDER)
  )
    store.TRANSCRIPTION_PROVIDER = patch.TRANSCRIPTION_PROVIDER;
  if (patch.OPENAI_API_KEY !== undefined)
    store.OPENAI_API_KEY = String(patch.OPENAI_API_KEY);
  if (patch.CHAT_MODEL !== undefined)
    store.CHAT_MODEL = String(patch.CHAT_MODEL).trim() || DEFAULTS.CHAT_MODEL;

  if (patch.TRANSCRIPTION_MODEL !== undefined)
    store.TRANSCRIPTION_MODEL =
      String(patch.TRANSCRIPTION_MODEL).trim() || DEFAULTS.TRANSCRIPTION_MODEL;
  if (patch.AGENT_NAME !== undefined)
    store.AGENT_NAME = String(patch.AGENT_NAME).trim() || DEFAULTS.AGENT_NAME;
  if (patch.AGENT_INSTRUCTIONS !== undefined)
    store.AGENT_INSTRUCTIONS =
      String(patch.AGENT_INSTRUCTIONS).trim() || getDefaultAgentInstructions();
  if (patch.AZURE_RESOURCE_NAME !== undefined)
    store.AZURE_RESOURCE_NAME = String(patch.AZURE_RESOURCE_NAME);
  if (patch.AZURE_API_KEY !== undefined)
    store.AZURE_API_KEY = String(patch.AZURE_API_KEY);
  if (patch.AZURE_API_VERSION !== undefined)
    store.AZURE_API_VERSION = String(patch.AZURE_API_VERSION);
  if (patch.DEEPGRAM_API_KEY !== undefined)
    store.DEEPGRAM_API_KEY = String(patch.DEEPGRAM_API_KEY);
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
  if (patch.COMPLETIONS_API_KEY !== undefined)
    store.COMPLETIONS_API_KEY = String(patch.COMPLETIONS_API_KEY);
  if (patch.MAX_INPUT_TOKENS !== undefined)
    store.MAX_INPUT_TOKENS = Math.max(0, Number(patch.MAX_INPUT_TOKENS) || 0);
  if (patch.MAX_TURNS !== undefined)
    store.MAX_TURNS = Math.max(
      1,
      Number(patch.MAX_TURNS) || DEFAULTS.MAX_TURNS!,
    );
  if (patch.CHAT_TIMEOUT_MS !== undefined)
    store.CHAT_TIMEOUT_MS = Math.max(
      0,
      Number(patch.CHAT_TIMEOUT_MS) || DEFAULTS.CHAT_TIMEOUT_MS!,
    );
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
  if (patch.whatsapp !== undefined) channelsStore.whatsapp = patch.whatsapp;
  persist().catch((err) => debug("persist error: %o", err));
  return getChannelsConfig();
}

async function persist(): Promise<void> {
  try {
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
      if (parsed.CHAT_MODEL !== undefined)
        store.CHAT_MODEL =
          String(parsed.CHAT_MODEL).trim() || DEFAULTS.CHAT_MODEL;

      if (parsed.TRANSCRIPTION_MODEL !== undefined)
        store.TRANSCRIPTION_MODEL =
          String(parsed.TRANSCRIPTION_MODEL).trim() ||
          DEFAULTS.TRANSCRIPTION_MODEL;
      if (parsed.AGENT_NAME !== undefined)
        store.AGENT_NAME =
          String(parsed.AGENT_NAME).trim() || DEFAULTS.AGENT_NAME;
      if (parsed.AGENT_INSTRUCTIONS !== undefined)
        store.AGENT_INSTRUCTIONS =
          String(parsed.AGENT_INSTRUCTIONS).trim() ||
          getDefaultAgentInstructions();
      if (
        parsed.LLM_PROVIDER !== undefined &&
        isLLMProviderId(parsed.LLM_PROVIDER)
      )
        store.LLM_PROVIDER = parsed.LLM_PROVIDER;
      if (
        parsed.TRANSCRIPTION_PROVIDER !== undefined &&
        isTranscriptionProviderId(parsed.TRANSCRIPTION_PROVIDER)
      )
        store.TRANSCRIPTION_PROVIDER = parsed.TRANSCRIPTION_PROVIDER;
      if (parsed.AZURE_RESOURCE_NAME !== undefined)
        store.AZURE_RESOURCE_NAME = String(parsed.AZURE_RESOURCE_NAME);
      if (parsed.AZURE_API_KEY !== undefined)
        store.AZURE_API_KEY = String(parsed.AZURE_API_KEY);
      if (parsed.AZURE_API_VERSION !== undefined)
        store.AZURE_API_VERSION = String(parsed.AZURE_API_VERSION);
      if (parsed.DEEPGRAM_API_KEY !== undefined)
        store.DEEPGRAM_API_KEY = String(parsed.DEEPGRAM_API_KEY);
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
      if (parsed.COMPLETIONS_API_KEY !== undefined)
        store.COMPLETIONS_API_KEY = String(parsed.COMPLETIONS_API_KEY);
      if (parsed.MAX_INPUT_TOKENS !== undefined)
        store.MAX_INPUT_TOKENS = Math.max(
          0,
          Number(parsed.MAX_INPUT_TOKENS) || 0,
        );
      if (parsed.MAX_TURNS !== undefined)
        store.MAX_TURNS = Math.max(
          1,
          Number(parsed.MAX_TURNS) || DEFAULTS.MAX_TURNS!,
        );
      if (parsed.CHAT_TIMEOUT_MS !== undefined)
        store.CHAT_TIMEOUT_MS = Math.max(
          0,
          Number(parsed.CHAT_TIMEOUT_MS) || DEFAULTS.CHAT_TIMEOUT_MS!,
        );
      if (parsed.channels && typeof parsed.channels === "object")
        channelsStore = { ...parsed.channels };
    }
  } catch {
    // no file or invalid
  }
}
