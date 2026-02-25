import type { Request, Response, Express } from "express";
import argon2 from "argon2";
import { env, isWebAuthEnabled } from "../env.js";
import { signToken } from "../middleware/auth-jwt.js";

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    if (!isWebAuthEnabled()) {
      res.status(501).json({
        error: "Not implemented",
        message: "Web auth is not configured.",
      });
      return;
    }
    const body = req.body as { username?: string; password?: string };
    const username =
      typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password) {
      res.status(400).json({
        error: "Bad request",
        message: "username and password are required.",
      });
      return;
    }
    const expectedUser = env.WEB_AUTH_USERNAME.trim();
    const hash = env.WEB_AUTH_PASSWORD_HASH.trim();
    if (username !== expectedUser) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid username or password.",
      });
      return;
    }
    try {
      const valid = await argon2.verify(hash, password);
      if (!valid) {
        res.status(401).json({
          error: "Unauthorized",
          message: "Invalid username or password.",
        });
        return;
      }
      const token = await signToken(username);
      res.json({ token });
    } catch {
      res.status(500).json({
        error: "Internal server error",
        message: "Login failed.",
      });
    }
  });
}
