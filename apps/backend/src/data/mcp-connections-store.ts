import { getPrisma } from "./db.js";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
  MCPOAuthConfig,
  MCPOAuthTokens,
  MCPOAuthClientInformation,
} from "../types.js";

const CONNECTION_TYPES = ["hosted", "streamable_http", "stdio"] as const;

export interface MCPConnectionsStore {
  getAll(): Promise<MCPConnection[]>;
  getById(id: string): Promise<MCPConnection | null>;
  addOrUpdate(conn: MCPConnection): Promise<void>;
  remove(id: string): Promise<boolean>;
}

function payloadToConnection(
  id: string,
  type: string,
  payload: unknown,
): MCPConnection | null {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  if (!p) return null;

  if (type === "hosted") {
    const d = p as Record<string, unknown>;
    return {
      id,
      type: "hosted",
      server_label: String(d.server_label ?? ""),
      server_url: String(d.server_url ?? ""),
      require_approval: (d.require_approval as "always" | "never") ?? "never",
      streaming: d.streaming as boolean | undefined,
      headers: d.headers as Record<string, string> | undefined,
      oauth: d.oauth as MCPOAuthConfig | undefined,
      oauth_tokens: d.oauth_tokens as MCPOAuthTokens | undefined,
      oauth_code_verifier: d.oauth_code_verifier as string | undefined,
      oauth_client_information: d.oauth_client_information as
        | MCPOAuthClientInformation
        | undefined,
      created_at: d.created_at as string | undefined,
    } as MCPConnectionHosted;
  }
  if (type === "streamable_http") {
    const d = p as Record<string, unknown>;
    return {
      id,
      type: "streamable_http",
      name: String(d.name ?? ""),
      url: String(d.url ?? ""),
      headers: d.headers as Record<string, string> | undefined,
      timeout_seconds: d.timeout_seconds as number | undefined,
      cache_tools_list: d.cache_tools_list as boolean | undefined,
      max_retry_attempts: d.max_retry_attempts as number | undefined,
      oauth: d.oauth as MCPOAuthConfig | undefined,
      oauth_tokens: d.oauth_tokens as MCPOAuthTokens | undefined,
      oauth_code_verifier: d.oauth_code_verifier as string | undefined,
      oauth_client_information: d.oauth_client_information as
        | MCPOAuthClientInformation
        | undefined,
      created_at: d.created_at as string | undefined,
    } as MCPConnectionStreamableHttp;
  }
  if (type === "stdio") {
    const d = p as Record<string, unknown>;
    return {
      id,
      type: "stdio",
      name: String(d.name ?? ""),
      command: String(d.command ?? ""),
      args: Array.isArray(d.args) ? d.args.map(String) : [],
      env:
        d.env && typeof d.env === "object"
          ? (d.env as Record<string, string>)
          : undefined,
      cwd: typeof d.cwd === "string" ? d.cwd : undefined,
      created_at: d.created_at as string | undefined,
    } as MCPConnectionStdio;
  }
  return null;
}

export async function initMCPConnectionsStore(): Promise<MCPConnectionsStore> {
  const prisma = getPrisma();

  return {
    async getAll(): Promise<MCPConnection[]> {
      const rows = await prisma.mCPConnection.findMany({
        where: { type: { in: [...CONNECTION_TYPES] } },
        orderBy: { id: "asc" },
      });
      const out: MCPConnection[] = [];
      for (const r of rows) {
        let payload: unknown;
        try {
          payload =
            typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
        } catch {
          continue;
        }
        const conn = payloadToConnection(r.id, r.type, payload);
        if (conn) out.push(conn);
      }
      return out;
    },

    async getById(id: string): Promise<MCPConnection | null> {
      const row = await prisma.mCPConnection.findUnique({ where: { id } });
      if (!row) return null;
      let payload: unknown;
      try {
        payload =
          typeof row.payload === "string"
            ? JSON.parse(row.payload)
            : row.payload;
      } catch {
        return null;
      }
      return payloadToConnection(row.id, row.type, payload);
    },

    async addOrUpdate(conn: MCPConnection): Promise<void> {
      const payload = {
        ...conn,
        created_at: conn.created_at ?? new Date().toISOString(),
      };
      await prisma.mCPConnection.upsert({
        where: { id: conn.id },
        create: {
          id: conn.id,
          type: conn.type,
          payload: JSON.stringify(payload),
        },
        update: {
          type: conn.type,
          payload: JSON.stringify(payload),
        },
      });
    },

    async remove(id: string): Promise<boolean> {
      const result = await prisma.mCPConnection.deleteMany({ where: { id } });
      return (result.count ?? 0) > 0;
    },
  };
}
