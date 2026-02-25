import type { Express, Request, Response } from "express";
import createDebug from "debug";
import type { AppContext } from "../utils/helpers.js";
import { getParam } from "../utils/helpers.js";
import { getRedis } from "../data/redis.js";
import { DISCOVERED_TOOLS_KEY } from "../capabilities/mcp/manager.js";
import { requestResponse } from "../utils/pubsub.js";
const debug = createDebug("hooman:routes:capabilities");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function registerCapabilityRoutes(app: Express, ctx: AppContext): void {
  const { mcpService } = ctx;

  app.get(
    "/api/capabilities/mcp/tools",
    async (_req: Request, res: Response) => {
      try {
        const redis = getRedis();
        if (!redis) {
          res.json({ tools: [] });
          return;
        }
        const raw = await redis.get(DISCOVERED_TOOLS_KEY);
        const tools = raw ? JSON.parse(raw) : [];
        res.json({ tools });
      } catch (err) {
        debug("list tools error: %o", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/api/capabilities/mcp/reload",
    async (_req: Request, res: Response) => {
      try {
        await requestResponse(
          "hooman:mcp-reload:request",
          "hooman:mcp-reload:response",
          "reload",
          {},
          60_000,
        );
        const redis = getRedis();
        const raw = redis ? await redis.get(DISCOVERED_TOOLS_KEY) : null;
        const tools = raw ? JSON.parse(raw) : [];
        res.json({ tools });
      } catch (err) {
        debug("mcp reload error: %o", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/capabilities/mcp/connections",
    async (_req: Request, res: Response) => {
      try {
        const connections = await mcpService.getAllConnections();
        res.json({
          connections: connections.map((c) => mcpService.maskConnection(c)),
        });
      } catch (err) {
        debug("get connections error: %o", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/api/capabilities/mcp/connections",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const conn = await mcpService.addConnection(req.body);
        res.status(201).json({ connection: mcpService.maskConnection(conn) });
      } catch (err) {
        debug("add connection error: %o", err);
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    "/api/capabilities/mcp/connections/:id",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const conn = await mcpService.updateConnection(
          getParam(req, "id"),
          req.body,
        );
        res.json({ connection: mcpService.maskConnection(conn) });
      } catch (err) {
        debug("patch connection error: %o", err);
        res
          .status(
            err instanceof Error && err.message.includes("not found")
              ? 404
              : 400,
          )
          .json({
            error: (err as Error).message,
          });
      }
    },
  );

  app.delete(
    "/api/capabilities/mcp/connections/:id",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const ok = await mcpService.removeConnection(getParam(req, "id"));
        if (!ok) {
          res.status(404).json({ error: "MCP connection not found." });
          return;
        }
        res.status(204).send();
      } catch (err) {
        debug("delete connection error: %o", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/capabilities/mcp/oauth/callback-url",
    (_req: Request, res: Response) => {
      res.json({ callbackUrl: mcpService.getOAuthCallbackUrl() });
    },
  );

  app.get(
    "/api/capabilities/mcp/oauth/callback",
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

      try {
        const result = await mcpService.completeOAuth(code, state);
        if (result === "AUTHORIZED") {
          res.send(
            "<!DOCTYPE html><html><body><p>Authorization successful. You can close this window.</p></body></html>",
          );
        } else {
          res
            .status(400)
            .send(
              "<!DOCTYPE html><html><body><p>Token exchange did not complete.</p></body></html>",
            );
        }
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
    "/api/capabilities/mcp/oauth/start",
    async (req: Request, res: Response): Promise<void> => {
      const connectionId =
        typeof req.body?.connectionId === "string"
          ? req.body.connectionId.trim()
          : "";
      if (!connectionId) {
        res.status(400).json({ error: "Missing connectionId." });
        return;
      }
      try {
        const result = await mcpService.startOAuth(connectionId);
        res.json(result);
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
      const skills = await ctx.skillService.list();
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
      const content = await ctx.skillService.getContent(id);
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
      const result = await ctx.skillService.add({
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
      const result = await ctx.skillService.remove(skills);
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
