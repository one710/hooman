import type { Request, Response, NextFunction } from "express";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../env.js";
import { COMPLETION_ROUTES } from "../routes/completions.js";

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

/** Paths that skip JWT (any method). */
const PUBLIC_PATHS = new Set([
  "/health",
  "/api/auth/login",
  "/api/capabilities/mcp/oauth/callback",
]);

/** Path prefixes that skip JWT (for signed attachment view URLs). */
const PUBLIC_PATH_PREFIXES = ["/api/chat/attachments/view/"];

/**
 * Requires valid JWT for all requests except PUBLIC_PATHS and completion routes.
 * Only mount this middleware when web auth is enabled.
 */
export function authJwt(req: Request, res: Response, next: NextFunction): void {
  if (
    PUBLIC_PATHS.has(req.path) ||
    COMPLETION_ROUTES.has(req.path) ||
    PUBLIC_PATH_PREFIXES.some((p) => req.path.startsWith(p))
  ) {
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
