import type { Request, Response, NextFunction } from "express";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../env.js";

const JWT_ALG = "HS256";
const JWT_EXPIRY = "7d";

export interface AuthPayload {
  sub: string;
}

export interface RequestWithUser extends Request {
  user?: AuthPayload;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== "string") return null;
  const [scheme, token] = auth.trim().split(/\s+/);
  return scheme === "Bearer" && token ? token : null;
}

export function signToken(username: string): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET.trim());
  return new SignJWT({ sub: username })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET.trim());
    const { payload } = await jwtVerify(token, secret);
    const sub = payload.sub;
    if (typeof sub !== "string" || !sub) return null;
    return { sub };
  } catch {
    return null;
  }
}

/**
 * Requires valid JWT for all requests except GET /health and POST /api/auth/login.
 * Only mount this middleware when web auth is enabled.
 */
export function authJwt(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" && req.path === "/health") {
    next();
    return;
  }
  if (req.method === "POST" && req.path === "/api/auth/login") {
    next();
    return;
  }
  if (req.path.startsWith("/api/internal/")) {
    next();
    return;
  }
  const token = getBearerToken(req);
  if (!token) {
    res
      .status(401)
      .json({ error: "Unauthorized", message: "Missing or invalid token." });
    return;
  }
  verifyToken(token)
    .then((payload) => {
      if (!payload) {
        res.status(401).json({
          error: "Unauthorized",
          message: "Invalid or expired token.",
        });
        return;
      }
      (req as RequestWithUser).user = payload;
      next();
    })
    .catch(() => {
      res
        .status(401)
        .json({ error: "Unauthorized", message: "Invalid token." });
    });
}
