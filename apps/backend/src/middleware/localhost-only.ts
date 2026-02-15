import type { Request, Response, NextFunction } from "express";

/** Paths that are allowed when the request is from the public (e.g. via ngrok). All other paths 403. */
const PUBLIC_PATHS = new Set(["/v1/chat/completions", "/chat/completions"]);

const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Host pattern for ngrok and similar tunnels (e.g. xxx.ngrok-free.app, xxx.ngrok.io). */
const PUBLIC_TUNNEL_HOST = /\.ngrok(-free)?\.(app|io)$/i;

function isLocalhostIp(ip: string): boolean {
  return LOCALHOST_IPS.has((ip || "").trim());
}

/**
 * Returns true if the request should be treated as "from the public" (through ngrok or direct
 * non-local connection). For such requests we only allow PUBLIC_PATHS.
 */
function isFromPublic(req: Request): boolean {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const clientIp = String(forwardedFor).split(",")[0].trim();
    if (clientIp && !isLocalhostIp(clientIp)) return true;
  }

  const host = (req.headers.host ?? "").split(":")[0];
  if (PUBLIC_TUNNEL_HOST.test(host)) return true;

  const remote = req.socket.remoteAddress ?? req.ip ?? "";
  return remote !== "" && !isLocalhostIp(remote);
}

/**
 * When the server is exposed via ngrok (or similar), only PUBLIC_PATHS are allowed for
 * requests that come from the public. Requests from localhost can access all endpoints.
 */
export function localhostOnly(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isFromPublic(req)) {
    next();
    return;
  }
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }
  res.status(403).json({
    error: "Forbidden",
    message: "This endpoint is only accessible from localhost.",
  });
}
