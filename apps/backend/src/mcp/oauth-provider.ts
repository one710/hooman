import type { OAuthClientProvider } from "@ai-sdk/mcp";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@ai-sdk/mcp";
import type { MCPConnectionsStore } from "../data/mcp-connections-store.js";
import type {
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPOAuthClientInformation,
  MCPOAuthTokens,
} from "../types.js";

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingAuthUrls = new Map<string, { url: string; expiresAt: number }>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, entry] of pendingAuthUrls.entries()) {
    if (entry.expiresAt <= now) pendingAuthUrls.delete(id);
  }
}

export function setPendingAuthUrl(connectionId: string, url: string): void {
  pruneExpired();
  pendingAuthUrls.set(connectionId, {
    url,
    expiresAt: Date.now() + PENDING_AUTH_TTL_MS,
  });
}

export function getAndClearPendingAuthUrl(
  connectionId: string,
): string | undefined {
  const entry = pendingAuthUrls.get(connectionId);
  pendingAuthUrls.delete(connectionId);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.url;
}

function isHttpConnection(
  c: Awaited<ReturnType<MCPConnectionsStore["getById"]>>,
): c is MCPConnectionHosted | MCPConnectionStreamableHttp {
  return c?.type === "hosted" || c?.type === "streamable_http";
}

/**
 * Creates an OAuthClientProvider for a single MCP HTTP connection.
 * Uses initialConnection for sync getters (redirectUrl, clientMetadata); other methods read/write via store.
 */
export function createOAuthProvider(
  connectionId: string,
  store: MCPConnectionsStore,
  initialConnection: MCPConnectionHosted | MCPConnectionStreamableHttp,
): OAuthClientProvider {
  return {
    get redirectUrl(): string {
      return initialConnection.oauth?.redirect_uri ?? "";
    },

    get clientMetadata(): OAuthClientMetadata {
      const redirectUrl = initialConnection.oauth?.redirect_uri ?? "";
      const scope = initialConnection.oauth?.scope;
      const hasSecret =
        (initialConnection.oauth_client_information?.client_secret ??
          initialConnection.oauth?.client_secret) != null;
      const clientName =
        initialConnection.type === "streamable_http"
          ? (initialConnection as MCPConnectionStreamableHttp).name ||
            "Hooman MCP"
          : (initialConnection as MCPConnectionHosted).server_label ||
            "Hooman MCP";
      return {
        redirect_uris: [redirectUrl],
        scope: scope ?? undefined,
        token_endpoint_auth_method: hasSecret ? "client_secret_basic" : "none",
        client_name: clientName,
      };
    },

    async tokens(): Promise<OAuthTokens | undefined> {
      const conn = await store.getById(connectionId);
      if (!isHttpConnection(conn) || !conn.oauth_tokens?.access_token)
        return undefined;
      const t = conn.oauth_tokens;
      return {
        access_token: t.access_token,
        token_type: t.token_type ?? "Bearer",
        expires_in: t.expires_in,
        refresh_token: t.refresh_token,
      };
    },

    async saveTokens(tokens: OAuthTokens): Promise<void> {
      const conn = await store.getById(connectionId);
      if (!isHttpConnection(conn)) return;
      const next: MCPConnectionHosted | MCPConnectionStreamableHttp = {
        ...conn,
        oauth_tokens: {
          access_token: tokens.access_token,
          token_type: tokens.token_type,
          expires_in: tokens.expires_in,
          refresh_token: tokens.refresh_token,
        } as MCPOAuthTokens,
      };
      await store.addOrUpdate(next);
    },

    async clientInformation(): Promise<OAuthClientInformation | undefined> {
      const conn = await store.getById(connectionId);
      if (!isHttpConnection(conn)) return undefined;
      if (conn.oauth_client_information?.client_id) {
        return {
          client_id: conn.oauth_client_information.client_id,
          client_secret: conn.oauth_client_information.client_secret,
        };
      }
      if (conn.oauth?.client_id) {
        return {
          client_id: conn.oauth.client_id,
          client_secret: conn.oauth.client_secret,
        };
      }
      return undefined;
    },

    async saveClientInformation(info: OAuthClientInformation): Promise<void> {
      const conn = await store.getById(connectionId);
      if (!isHttpConnection(conn)) return;
      const next: MCPConnectionHosted | MCPConnectionStreamableHttp = {
        ...conn,
        oauth_client_information: {
          client_id: info.client_id,
          client_secret: info.client_secret,
        } as MCPOAuthClientInformation,
      };
      await store.addOrUpdate(next);
    },

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
      const conn = await store.getById(connectionId);
      if (!isHttpConnection(conn)) return;
      const next: MCPConnectionHosted | MCPConnectionStreamableHttp = {
        ...conn,
        oauth_code_verifier: codeVerifier,
      };
      await store.addOrUpdate(next);
    },

    async codeVerifier(): Promise<string> {
      const conn = await store.getById(connectionId);
      return isHttpConnection(conn) ? (conn.oauth_code_verifier ?? "") : "";
    },

    redirectToAuthorization(authorizationUrl: URL): void {
      setPendingAuthUrl(connectionId, authorizationUrl.href);
    },

    state(): string {
      return connectionId;
    },

    invalidateCredentials(
      scope: "all" | "client" | "tokens" | "verifier",
    ): void {
      void (async () => {
        const conn = await store.getById(connectionId);
        if (!isHttpConnection(conn)) return;
        const next = { ...conn };
        if (scope === "all" || scope === "tokens") {
          next.oauth_tokens = undefined;
        }
        if (scope === "all" || scope === "verifier") {
          next.oauth_code_verifier = undefined;
        }
        if (scope === "all" || scope === "client") {
          next.oauth_client_information = undefined;
        }
        await store.addOrUpdate(next);
      })();
    },
  };
}
