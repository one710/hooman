import { randomUUID } from "crypto";
import createDebug from "debug";
import { auth, createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
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
import { filterToolNames } from "../../utils/tool-filter.js";

const debug = createDebug("hooman:mcp-service");
const DEFAULT_MCP_CWD = env.MCP_STDIO_DEFAULT_CWD;

export type McpClientEntry = {
  client: Awaited<ReturnType<typeof createMCPClient>>;
  id: string;
};

export interface CreateMcpClientsOptions {
  mcpConnectionsStore?: MCPConnectionsStore;
}

/**
 * Create MCP clients from a list of connections. Failed connections are skipped (logged at debug).
 */
export async function createMcpClients(
  connections: MCPConnection[],
  options?: CreateMcpClientsOptions,
): Promise<McpClientEntry[]> {
  const clients: McpClientEntry[] = [];
  for (const c of connections) {
    try {
      if (c.type === "stdio") {
        const stdio = c as MCPConnectionStdio;
        const hasArgs = Array.isArray(stdio.args) && stdio.args.length > 0;
        debug(
          "Connecting to Stdio MCP: %s (command: %s, args: %j)",
          c.id,
          stdio.command,
          stdio.args,
        );
        const transport = new Experimental_StdioMCPTransport({
          command: stdio.command,
          args: hasArgs ? stdio.args : [],
          env: stdio.env,
          cwd: stdio.cwd?.trim() || DEFAULT_MCP_CWD,
        });
        const client = await createMCPClient({ transport });
        debug("Connected to %s", c.id);
        clients.push({ client, id: c.id });
      } else if (c.type === "streamable_http") {
        const http = c as MCPConnectionStreamableHttp;
        const hasOAuth =
          http.oauth?.redirect_uri && options?.mcpConnectionsStore;
        debug(
          "Connecting to HTTP MCP: %s (url: %s, headers: %j)",
          c.id,
          http.url,
          http.headers,
        );
        const client = await createMCPClient({
          transport: {
            type: "http",
            url: http.url,
            headers: http.headers,
            ...(hasOAuth && {
              authProvider: createOAuthProvider(
                c.id,
                options.mcpConnectionsStore!,
                http,
              ),
            }),
          },
        });
        debug("Connected to %s", c.id);
        clients.push({ client, id: c.id });
      } else if (c.type === "hosted") {
        const hosted = c as MCPConnectionHosted;
        const hasOAuth =
          hosted.oauth?.redirect_uri && options?.mcpConnectionsStore;
        debug(
          "Connecting to Hosted MCP: %s (server_url: %s, headers: %j)",
          c.id,
          hosted.server_url,
          hosted.headers,
        );
        const client = await createMCPClient({
          transport: {
            type: "http",
            url: hosted.server_url,
            headers: hosted.headers,
            ...(hasOAuth && {
              authProvider: createOAuthProvider(
                c.id,
                options.mcpConnectionsStore!,
                hosted,
              ),
            }),
          },
        });
        debug("Connected to %s", c.id);
        clients.push({ client, id: c.id });
      }
    } catch (err) {
      debug("MCP connection %s failed to connect: %o", c.id, err);
    }
  }
  return clients;
}

/** Some APIs (e.g. AWS Bedrock) limit tool names to 64 chars. Prefix with short connection id and truncate if needed. */
const DEFAULT_MAX_TOOL_NAME_LEN = 64;
const DEFAULT_SHORT_CONN_ID_LEN = 8;

/** Shape for UI: tool name + connection info. name = actual tool name (e.g. read_file), not connection name. */
export type McpDiscoveredTool = {
  id: string;
  name: string;
  description?: string;
  connectionId: string;
  connectionName: string;
};

export interface ClientsToToolsResult {
  prefixedTools: Record<string, unknown>;
  tools: McpDiscoveredTool[];
}

/**
 * Build a tools map and discovered-tools list from MCP clients. Failed client.tools() are skipped (logged at debug).
 */
export async function clientsToTools(
  clients: McpClientEntry[],
  connections: MCPConnection[],
  options?: {
    maxToolNameLen?: number;
    shortConnIdLen?: number;
  },
): Promise<ClientsToToolsResult> {
  const maxToolNameLen = options?.maxToolNameLen ?? DEFAULT_MAX_TOOL_NAME_LEN;
  const shortConnIdLen = options?.shortConnIdLen ?? DEFAULT_SHORT_CONN_ID_LEN;
  const prefixedTools: Record<string, unknown> = {};
  const tools: McpDiscoveredTool[] = [];

  for (const { client, id } of clients) {
    try {
      const toolSet = await client.tools();
      const toolNames = Object.keys(toolSet);
      const conn = connections.find((c) => c.id === id);
      const connName = (conn as { name?: string })?.name || conn?.id || id;
      const filtered = filterToolNames(toolNames, conn?.tool_filter);
      debug(
        "MCP client %s tool discovery: %d tools found, %d after filter (%j)",
        id,
        toolNames.length,
        filtered.length,
        filtered,
      );
      const shortId = id.replace(/-/g, "").slice(0, shortConnIdLen);
      const maxNameLen = maxToolNameLen - shortId.length - 1;
      const allowed = new Set(filtered);
      for (const [name, t] of Object.entries(toolSet)) {
        if (!allowed.has(name)) continue;
        const safeName =
          name.length <= maxNameLen ? name : name.slice(0, maxNameLen);
        const prefixed = `${shortId}_${safeName}`;
        prefixedTools[prefixed] = t;
        tools.push({
          id: `${id}/${name}`,
          name,
          description: (t as { description?: string }).description,
          connectionId: id,
          connectionName: connName,
        });
      }
    } catch (err) {
      debug("MCP client %s tools() failed: %o", id, err);
    }
  }

  return { prefixedTools, tools };
}

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
