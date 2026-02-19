import type { Express, Request, Response } from "express";
import createDebug from "debug";
import { randomUUID } from "crypto";
import { auth } from "@ai-sdk/mcp";
import type { AppContext } from "./helpers.js";
import { getParam } from "./helpers.js";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types.js";
import {
  listSkillsFromFs,
  getSkillContent,
  addSkill,
  removeSkills,
} from "../agents/skills-cli.js";
import {
  createOAuthProvider,
  getAndClearPendingAuthUrl,
} from "../agents/oauth-provider.js";
import { env } from "../env.js";
import { setReloadFlag } from "../data/reload-flag.js";

const debug = createDebug("hooman:routes:capabilities");

function getMcpServerUrl(
  c: MCPConnectionHosted | MCPConnectionStreamableHttp,
): string {
  return c.type === "hosted" ? c.server_url : c.url;
}

/**
 * URL to pass to auth() for discovery and DCR. When the user has set an explicit
 * authorization server URL, use it so discovery/register hit the auth server instead
 * of the MCP endpoint (which often returns 404 for /.well-known and /register).
 */
function getOAuthServerUrlForAuth(
  c: MCPConnectionHosted | MCPConnectionStreamableHttp,
): string {
  const override = c.oauth?.authorization_server_url?.trim();
  return override && override.length > 0 ? override : getMcpServerUrl(c);
}

function getOAuthCallbackUrl(): string {
  const base = env.API_BASE_URL.replace(/\/$/, "");
  return `${base}/api/mcp/oauth/callback`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function maskConnectionForResponse(
  c: MCPConnection,
): MCPConnection & { oauth_has_tokens?: boolean } {
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
}

export function registerCapabilityRoutes(app: Express, ctx: AppContext): void {
  const { mcpConnectionsStore } = ctx;

  app.get(
    "/api/capabilities/available",
    async (_req: Request, res: Response) => {
      const connections = await mcpConnectionsStore.getAll();
      const capabilities = connections.map((c) => ({
        integrationId: c.id,
        capability:
          c.type === "hosted"
            ? c.server_label || c.id
            : (c as { name?: string }).name || c.id,
      }));
      res.json({ capabilities });
    },
  );

  app.get("/api/mcp/connections", async (_req: Request, res: Response) => {
    const connections = await mcpConnectionsStore.getAll();
    res.json({ connections: connections.map(maskConnectionForResponse) });
  });

  app.post(
    "/api/mcp/connections",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as Partial<MCPConnection> & { id?: string };
      if (!body?.type) {
        res.status(400).json({ error: "Missing connection type." });
        return;
      }
      const id = body.id?.trim() || randomUUID();
      const created_at = new Date().toISOString();
      let conn: MCPConnection;
      if (body.type === "hosted") {
        const serverUrl =
          typeof body.server_url === "string" ? body.server_url.trim() : "";
        if (!serverUrl) {
          res
            .status(400)
            .json({ error: "Server URL is required for hosted MCP." });
          return;
        }
        const c: MCPConnectionHosted = {
          id,
          type: "hosted",
          server_label: body.server_label ?? "",
          server_url: serverUrl,
          require_approval: body.require_approval ?? "never",
          streaming: body.streaming ?? false,
          headers: body.headers,
          oauth: body.oauth,
          created_at,
        };
        conn = c;
      } else if (body.type === "streamable_http") {
        const c: MCPConnectionStreamableHttp = {
          id,
          type: "streamable_http",
          name: body.name ?? "",
          url: body.url ?? "",
          headers: body.headers,
          timeout_seconds: body.timeout_seconds,
          cache_tools_list: body.cache_tools_list ?? true,
          max_retry_attempts: body.max_retry_attempts,
          oauth: body.oauth,
          created_at,
        };
        conn = c;
      } else if (body.type === "stdio") {
        const c: MCPConnectionStdio = {
          id,
          type: "stdio",
          name: body.name ?? "",
          command: body.command ?? "",
          args: Array.isArray(body.args) ? body.args : [],
          env:
            body.env && typeof body.env === "object"
              ? (body.env as Record<string, string>)
              : undefined,
          cwd:
            typeof body.cwd === "string" && body.cwd.trim()
              ? body.cwd.trim()
              : undefined,
          created_at,
        };
        conn = c;
      } else {
        res.status(400).json({
          error: `Unknown connection type: ${(body as { type?: string }).type}`,
        });
        return;
      }
      await mcpConnectionsStore.addOrUpdate(conn);
      if (env.REDIS_URL) await setReloadFlag(env.REDIS_URL, "mcp");
      res.status(201).json({ connection: maskConnectionForResponse(conn) });
    },
  );

  app.patch(
    "/api/mcp/connections/:id",
    async (req: Request, res: Response): Promise<void> => {
      const id = getParam(req, "id");
      const existing = await mcpConnectionsStore.getById(id);
      if (!existing) {
        res.status(404).json({ error: "MCP connection not found." });
        return;
      }
      const patch = req.body as Partial<MCPConnection>;
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
        const patchHttp = patch as Partial<MCPConnectionHosted>;
        if (patchHttp.oauth_tokens === undefined)
          mergedHttp.oauth_tokens = existingHttp.oauth_tokens;
        if (patchHttp.oauth_code_verifier === undefined)
          mergedHttp.oauth_code_verifier = existingHttp.oauth_code_verifier;
        if (patchHttp.oauth_client_information === undefined)
          mergedHttp.oauth_client_information =
            existingHttp.oauth_client_information;
      }
      await mcpConnectionsStore.addOrUpdate(merged);
      if (env.REDIS_URL) await setReloadFlag(env.REDIS_URL, "mcp");
      res.json({ connection: maskConnectionForResponse(merged) });
    },
  );

  app.delete(
    "/api/mcp/connections/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await mcpConnectionsStore.remove(getParam(req, "id"));
      if (!ok) {
        res.status(404).json({ error: "MCP connection not found." });
        return;
      }
      if (env.REDIS_URL) await setReloadFlag(env.REDIS_URL, "mcp");
      res.status(204).send();
    },
  );

  app.get("/api/mcp/oauth/callback-url", (_req: Request, res: Response) => {
    res.json({ callbackUrl: getOAuthCallbackUrl() });
  });

  app.get(
    "/api/mcp/oauth/callback",
    async (req: Request, res: Response): Promise<void> => {
      const code =
        typeof req.query.code === "string" ? req.query.code : undefined;
      const state =
        typeof req.query.state === "string" ? req.query.state : undefined;
      const errorParam =
        typeof req.query.error === "string" ? req.query.error : undefined;
      if (errorParam) {
        res
          .status(400)
          .send(
            `<!DOCTYPE html><html><body><p>Authorization failed: ${escapeHtml(errorParam)}</p></body></html>`,
          );
        return;
      }
      if (!code || !state) {
        res
          .status(400)
          .send(
            "<!DOCTYPE html><html><body><p>Missing code or state.</p></body></html>",
          );
        return;
      }
      const connectionId = state;
      const existing = await mcpConnectionsStore.getById(connectionId);
      if (
        !existing ||
        (existing.type !== "streamable_http" && existing.type !== "hosted") ||
        !existing.oauth?.redirect_uri
      ) {
        res
          .status(400)
          .send(
            "<!DOCTYPE html><html><body><p>Invalid state or connection.</p></body></html>",
          );
        return;
      }
      const serverUrl = getOAuthServerUrlForAuth(existing);
      const provider = createOAuthProvider(
        connectionId,
        mcpConnectionsStore,
        existing,
      );
      try {
        const result = await auth(provider, {
          serverUrl,
          authorizationCode: code,
        });
        if (result !== "AUTHORIZED") {
          res
            .status(400)
            .send(
              "<!DOCTYPE html><html><body><p>Token exchange did not complete.</p></body></html>",
            );
          return;
        }
        const updated = await mcpConnectionsStore.getById(connectionId);
        if (
          updated &&
          (updated.type === "streamable_http" || updated.type === "hosted") &&
          updated.oauth_code_verifier
        ) {
          const cleared = { ...updated, oauth_code_verifier: undefined };
          await mcpConnectionsStore.addOrUpdate(cleared);
        }
        res.send(
          "<!DOCTYPE html><html><body><p>Authorization successful. You can close this window.</p></body></html>",
        );
      } catch (err) {
        debug("OAuth callback error: %o", err);
        res
          .status(500)
          .send(
            "<!DOCTYPE html><html><body><p>Authorization failed. Please try again.</p></body></html>",
          );
      }
    },
  );

  app.post(
    "/api/mcp/oauth/start",
    async (req: Request, res: Response): Promise<void> => {
      const connectionId =
        typeof req.body?.connectionId === "string"
          ? req.body.connectionId.trim()
          : "";
      if (!connectionId) {
        res.status(400).json({ error: "Missing connectionId." });
        return;
      }
      const existing = await mcpConnectionsStore.getById(connectionId);
      if (
        !existing ||
        (existing.type !== "streamable_http" && existing.type !== "hosted") ||
        !existing.oauth?.redirect_uri
      ) {
        res.status(400).json({
          error: "Connection not found or not OAuth-enabled.",
        });
        return;
      }
      const serverUrl = getOAuthServerUrlForAuth(existing);
      const provider = createOAuthProvider(
        connectionId,
        mcpConnectionsStore,
        existing,
      );
      try {
        const result = await auth(provider, {
          serverUrl,
        });
        if (result === "AUTHORIZED") {
          res.json({ status: "already_authorized" });
          return;
        }
        const authorizationUrl = getAndClearPendingAuthUrl(connectionId);
        if (!authorizationUrl) {
          res.status(500).json({
            error: "Authorization URL not available. Please try again.",
          });
          return;
        }
        res.json({ authorizationUrl });
      } catch (err) {
        debug("OAuth start error: %o", err);
        let msg = (err as Error).message || "OAuth start failed.";
        if (
          msg.includes("404") &&
          (msg.includes("Not Found") || msg.includes("Invalid OAuth error"))
        ) {
          msg +=
            ' If your MCP server uses a separate OAuth server, set "Authorization server URL" in the connection form to that server (e.g. the OAuth provider base URL). Otherwise use a pre-registered client (Client ID and optional Client secret) so DCR is skipped.';
        }
        res.status(500).json({ error: msg });
      }
    },
  );

  app.get("/api/skills/list", async (_req: Request, res: Response) => {
    try {
      const skills = await listSkillsFromFs();
      res.json({ skills });
    } catch (err) {
      debug("skills list error: %o", err);
      res.status(500).json({
        skills: [],
        error: (err as Error).message,
      });
    }
  });

  app.get("/api/skills/:id/content", async (req: Request, res: Response) => {
    const id =
      typeof req.params.id === "string"
        ? req.params.id
        : (req.params.id?.[0] ?? "");
    if (!id) {
      res.status(400).json({ error: "Missing skill id." });
      return;
    }
    try {
      const content = await getSkillContent(id);
      if (content === null) {
        res.status(404).json({ error: "Skill not found." });
        return;
      }
      res.json({ content });
    } catch (err) {
      debug("skills content error: %o", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/skills/add", async (req: Request, res: Response) => {
    const body = req.body as { package?: string; skills?: string[] };
    const pkg = body?.package;
    if (!pkg || typeof pkg !== "string" || !pkg.trim()) {
      res.status(400).json({ error: "Missing or invalid 'package'." });
      return;
    }
    try {
      const result = await addSkill({
        package: pkg.trim(),
        skills: Array.isArray(body?.skills) ? body.skills : undefined,
      });
      res.json({
        output: result.stdout,
        error: result.stderr.trim() || undefined,
        code: result.code,
      });
    } catch (err) {
      debug("skills add error: %o", err);
      res.status(500).json({
        output: "",
        error: (err as Error).message,
        code: 1,
      });
    }
  });

  app.post("/api/skills/remove", async (req: Request, res: Response) => {
    const body = req.body as { skills?: string[] };
    const skills = Array.isArray(body?.skills) ? body.skills : [];
    if (skills.length === 0) {
      res.status(400).json({ error: "Missing or invalid 'skills' array." });
      return;
    }
    try {
      const result = await removeSkills(skills);
      res.json({
        output: result.stdout,
        error: result.stderr.trim() || undefined,
        code: result.code,
      });
    } catch (err) {
      debug("skills remove error: %o", err);
      res.status(500).json({
        output: "",
        error: (err as Error).message,
        code: 1,
      });
    }
  });
}
