import dotenv from "dotenv";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(join(__dirname, ".."));
const PROJECT_ROOT = resolve(join(__dirname, "..", "..", ".."));
const WORKSPACE_ROOT = join(PROJECT_ROOT, "workspace");

// Load .env from project root so it works when PM2/tsx runs from project root
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

function str(name: string, defaultValue: string): string {
  const v = process.env[name];
  return (typeof v === "string" && v.trim()) || defaultValue;
}
function num(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

/** Loaded once at startup. Use this instead of process.env everywhere. */
export const env = {
  NODE_ENV: str("NODE_ENV", "development"),
  PORT: num("PORT", 3000),
  REDIS_URL: str("REDIS_URL", "redis://localhost:6379"),
  API_BASE_URL: str("API_BASE_URL", "http://localhost:3000"),
  DATABASE_URL: str("DATABASE_URL", ""),
  MCP_STDIO_DEFAULT_CWD: str(
    "MCP_STDIO_DEFAULT_CWD",
    join(WORKSPACE_ROOT, "mcpcwd"),
  ),
  SKILLS_CWD: str("SKILLS_CWD", PROJECT_ROOT),
  /** Optional path to Chrome/Chromium for whatsapp-web.js (Puppeteer). If unset, adapter may use a platform default (e.g. macOS Chrome). */
  PUPPETEER_EXECUTABLE_PATH: str("PUPPETEER_EXECUTABLE_PATH", ""),
  /** Web UI auth: username (plain). When set with WEB_AUTH_PASSWORD_HASH and JWT_SECRET, login is required. */
  WEB_AUTH_USERNAME: str("WEB_AUTH_USERNAME", ""),
  /** Web UI auth: argon2id hash of password. Use `yarn hash-password` to generate. */
  WEB_AUTH_PASSWORD_HASH: str("WEB_AUTH_PASSWORD_HASH", ""),
  /** Secret to sign JWTs when web auth is enabled. */
  JWT_SECRET: str("JWT_SECRET", ""),
  /** MCP manager: max ms to build session (connect all MCPs). Default 5 minutes. */
  MCP_CONNECT_TIMEOUT_MS: num("MCP_CONNECT_TIMEOUT_MS", 300_000),
  /** MCP manager: max ms to close session. Default 10 seconds. */
  MCP_CLOSE_TIMEOUT_MS: num("MCP_CLOSE_TIMEOUT_MS", 10_000),
} as const;

export { BACKEND_ROOT, PROJECT_ROOT, WORKSPACE_ROOT };

/** True when all web auth env vars are set; then protected routes and Socket.IO require JWT. */
export function isWebAuthEnabled(): boolean {
  const u = env.WEB_AUTH_USERNAME.trim();
  const h = env.WEB_AUTH_PASSWORD_HASH.trim();
  const s = env.JWT_SECRET.trim();
  return u !== "" && h !== "" && s !== "";
}

export function getDatabaseUrl(): string {
  return env.DATABASE_URL || `file:${join(WORKSPACE_ROOT, "hooman.db")}`;
}
