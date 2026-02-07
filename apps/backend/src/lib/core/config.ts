import createDebug from "debug";
import { readFile, writeFile } from "fs/promises";
import { getWorkspaceConfigPath, WORKSPACE_ROOT } from "./workspace.js";
import type { ChannelsConfig } from "./types.js";
import { env } from "../../env.js";

const debug = createDebug("hooman:config");

const CONFIG_PATH = getWorkspaceConfigPath();

/** Settings UI / persisted config (API key, embedding model, LLM model, web search, MCP, transcription). */
export interface PersistedConfig {
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_EMBEDDING_MODEL: string;
  OPENAI_WEB_SEARCH: boolean;
  MCP_USE_SERVER_MANAGER: boolean;
  OPENAI_TRANSCRIPTION_MODEL: string;
}

/** Full config: persisted + PORT from env. */
export interface AppConfig extends PersistedConfig {
  PORT: number;
}

const DEFAULTS: PersistedConfig = {
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-5.2",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  OPENAI_WEB_SEARCH: false,
  MCP_USE_SERVER_MANAGER: false,
  OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
};

let store: PersistedConfig = { ...DEFAULTS };
let channelsStore: ChannelsConfig = {};

export function getConfig(): AppConfig {
  return { ...store, PORT: env.PORT };
}

export function updateConfig(patch: Partial<PersistedConfig>): PersistedConfig {
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
  if (patch.jira !== undefined) channelsStore.jira = patch.jira;
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
      if (parsed.channels && typeof parsed.channels === "object")
        channelsStore = { ...parsed.channels };
    }
  } catch {
    // no file or invalid
  }
}
