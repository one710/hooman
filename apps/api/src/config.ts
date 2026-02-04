import createDebug from "debug";
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const debug = createDebug("hooman:config");

const __dirname = dirname(fileURLToPath(import.meta.url));
/** API package root (apps/api when built). Data lives in <root>/data. */
const API_ROOT = join(__dirname, "..");

/** Settings UI / persisted config (API key, embedding model, LLM model, web search, MCP). */
export interface PersistedConfig {
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_EMBEDDING_MODEL: string;
  OPENAI_WEB_SEARCH: boolean;
  MCP_USE_SERVER_MANAGER: boolean;
}

/** Full config: persisted + QDRANT_URL and PORT from .env only. */
export interface AppConfig extends PersistedConfig {
  QDRANT_URL: string;
  PORT: number;
}

const DEFAULTS: PersistedConfig = {
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-5.2",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  OPENAI_WEB_SEARCH: false,
  MCP_USE_SERVER_MANAGER: false,
};

const ENV_DEFAULTS = {
  PORT: 3000,
};

let store: PersistedConfig = { ...DEFAULTS };

const CONFIG_PATH = join(API_ROOT, "data", "config.json");

export function getConfig(): AppConfig {
  const qdrantUrl = (process.env.QDRANT_URL ?? "").trim();
  const port = Number(process.env.PORT) || ENV_DEFAULTS.PORT;
  return { ...store, QDRANT_URL: qdrantUrl, PORT: port };
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
  persist().catch((err) => debug("persist error: %o", err));
  return { ...store };
}

async function persist(): Promise<void> {
  try {
    const { mkdir } = await import("fs/promises");
    await mkdir(join(API_ROOT, "data"), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

export async function loadPersisted(): Promise<void> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
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
    }
  } catch {
    // no file or invalid
  }
}
