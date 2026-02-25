import { randomUUID } from "crypto";
import { auth } from "@ai-sdk/mcp";
import type { MCPConnectionsStore } from "./connections-store.js";
import {
  createOAuthProvider,
  getAndClearPendingAuthUrl,
} from "./oauth-provider.js";
import {
  type MCPConnection,
  type MCPConnectionHosted,
  type MCPConnectionStreamableHttp,
  type MCPConnectionStdio,
} from "../../types.js";
import { env } from "../../env.js";

export interface McpService {
  getAllConnections(): Promise<MCPConnection[]>;
  getConnectionById(id: string): Promise<MCPConnection | null>;
  addConnection(
    body: Partial<MCPConnection> & { id?: string },
  ): Promise<MCPConnection>;
  updateConnection(
    id: string,
    patch: Partial<MCPConnection>,
  ): Promise<MCPConnection>;
  removeConnection(id: string): Promise<boolean>;
  getOAuthCallbackUrl(): string;
  startOAuth(
    connectionId: string,
  ): Promise<{ status: "already_authorized" } | { authorizationUrl: string }>;
  completeOAuth(code: string, state: string): Promise<"AUTHORIZED" | "FAILED">;
  maskConnection(
    c: MCPConnection,
  ): MCPConnection & { oauth_has_tokens?: boolean };
}

export function createMcpService(store: MCPConnectionsStore): McpService {
  return {
    async getAllConnections() {
      return store.getAll();
    },

    async getConnectionById(id: string) {
      return store.getById(id);
    },

    async addConnection(body) {
      if (!body.type) {
        throw new Error("Missing connection type.");
      }
      const id = body.id?.trim() || randomUUID();
      const created_at = new Date().toISOString();
      let conn: MCPConnection;

      if (body.type === "hosted") {
        const serverUrl =
          typeof body.server_url === "string" ? body.server_url.trim() : "";
        if (!serverUrl)
          throw new Error("Server URL is required for hosted MCP.");
        conn = {
          id,
          type: "hosted",
          server_label: body.server_label ?? "",
          server_url: serverUrl,
          tool_filter:
            typeof body.tool_filter === "string"
              ? body.tool_filter.trim() || undefined
              : undefined,
          headers: body.headers,
          oauth: body.oauth,
          created_at,
        } as MCPConnectionHosted;
      } else if (body.type === "streamable_http") {
        conn = {
          id,
          type: "streamable_http",
          name: body.name ?? "",
          url: body.url ?? "",
          tool_filter:
            typeof body.tool_filter === "string"
              ? body.tool_filter.trim() || undefined
              : undefined,
          headers: body.headers,
          timeout_seconds: body.timeout_seconds,
          cache_tools_list: body.cache_tools_list ?? true,
          max_retry_attempts: body.max_retry_attempts,
          oauth: body.oauth,
          created_at,
        } as MCPConnectionStreamableHttp;
      } else if (body.type === "stdio") {
        conn = {
          id,
          type: "stdio",
          name: body.name ?? "",
          command: body.command ?? "",
          args: Array.isArray(body.args) ? body.args : [],
          tool_filter:
            typeof body.tool_filter === "string"
              ? body.tool_filter.trim() || undefined
              : undefined,
          env:
            body.env && typeof body.env === "object"
              ? (body.env as Record<string, string>)
              : undefined,
          cwd:
            typeof body.cwd === "string" && body.cwd.trim()
              ? body.cwd.trim()
              : undefined,
          created_at,
        } as MCPConnectionStdio;
      } else {
        throw new Error(`Unknown connection type: ${body.type}`);
      }

      await store.addOrUpdate(conn);
      return conn;
    },

    async updateConnection(id, patch) {
      const existing = await store.getById(id);
      if (!existing) throw new Error("MCP connection not found.");

      const merged = {
        ...existing,
        ...patch,
        id: existing.id,
      } as MCPConnection;

      if (merged.type === "streamable_http" || merged.type === "hosted") {
        const existingHttp = existing as
          | MCPConnectionHosted
          | MCPConnectionStreamableHttp;
        const mergedHttp = merged as
          | MCPConnectionHosted
          | MCPConnectionStreamableHttp;

        if (
          mergedHttp.headers?.Authorization === "Bearer ***" &&
          existingHttp.headers?.Authorization
        ) {
          mergedHttp.headers = {
            ...mergedHttp.headers,
            Authorization: existingHttp.headers.Authorization,
          };
        }
        if (
          mergedHttp.oauth?.client_secret === "***" &&
          existingHttp.oauth?.client_secret
        ) {
          mergedHttp.oauth = {
            ...mergedHttp.oauth,
            client_secret: existingHttp.oauth.client_secret,
          };
        }

        const patchAny = patch as any;
        if (patchAny.oauth_tokens === undefined)
          mergedHttp.oauth_tokens = existingHttp.oauth_tokens;
        if (patchAny.oauth_code_verifier === undefined)
          mergedHttp.oauth_code_verifier = existingHttp.oauth_code_verifier;
        if (patchAny.oauth_client_information === undefined)
          mergedHttp.oauth_client_information =
            existingHttp.oauth_client_information;
      }

      await store.addOrUpdate(merged);
      return merged;
    },

    async removeConnection(id) {
      const ok = await store.remove(id);
      return ok;
    },

    getOAuthCallbackUrl() {
      const base = env.API_BASE_URL.replace(/\/$/, "");
      return `${base}/api/capabilities/mcp/oauth/callback`;
    },

    async startOAuth(connectionId) {
      const existing = await store.getById(connectionId);
      if (
        !existing ||
        (existing.type !== "streamable_http" && existing.type !== "hosted") ||
        !existing.oauth?.redirect_uri
      ) {
        throw new Error("Connection not found or not OAuth-enabled.");
      }

      const serverUrl = getOAuthServerUrlForAuth(existing);
      const provider = createOAuthProvider(connectionId, store, existing);

      const result = await auth(provider, { serverUrl });
      if (result === "AUTHORIZED") return { status: "already_authorized" };

      const authorizationUrl = getAndClearPendingAuthUrl(connectionId);
      if (!authorizationUrl)
        throw new Error("Authorization URL not available. Please try again.");

      return { authorizationUrl };
    },

    async completeOAuth(code, state) {
      const connectionId = state;
      const existing = await store.getById(connectionId);
      if (
        !existing ||
        (existing.type !== "streamable_http" && existing.type !== "hosted") ||
        !existing.oauth?.redirect_uri
      ) {
        throw new Error("Invalid state or connection.");
      }

      const serverUrl = getOAuthServerUrlForAuth(existing);
      const provider = createOAuthProvider(connectionId, store, existing);

      const result = await auth(provider, {
        serverUrl,
        authorizationCode: code,
      });
      if (result !== "AUTHORIZED") return "FAILED";

      const updated = await store.getById(connectionId);
      if (
        updated &&
        (updated.type === "streamable_http" || updated.type === "hosted") &&
        updated.oauth_code_verifier
      ) {
        await store.addOrUpdate({ ...updated, oauth_code_verifier: undefined });
      }
      return "AUTHORIZED";
    },

    maskConnection(c) {
      if (c.type !== "streamable_http" && c.type !== "hosted") {
        return c;
      }
      const http = c as MCPConnectionHosted | MCPConnectionStreamableHttp;
      const hasTokens = Boolean(http.oauth_tokens?.access_token);
      const out: MCPConnection & { oauth_has_tokens?: boolean } = {
        ...http,
        oauth_has_tokens: http.oauth ? hasTokens : undefined,
      };
      const outRecord = out as unknown as Record<string, unknown>;
      delete outRecord.oauth_tokens;
      delete outRecord.oauth_code_verifier;
      delete outRecord.oauth_client_information;
      if (out.oauth?.client_secret) {
        out.oauth = { ...out.oauth, client_secret: "***" };
      }
      if (out.headers?.Authorization) {
        out.headers = { ...out.headers, Authorization: "Bearer ***" };
      }
      return out;
    },
  };
}

function getMcpServerUrl(
  c: MCPConnectionHosted | MCPConnectionStreamableHttp,
): string {
  return c.type === "hosted" ? c.server_url : c.url;
}

function getOAuthServerUrlForAuth(
  c: MCPConnectionHosted | MCPConnectionStreamableHttp,
): string {
  const override = c.oauth?.authorization_server_url?.trim();
  return override && override.length > 0 ? override : getMcpServerUrl(c);
}
