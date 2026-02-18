import type { Request, Response, NextFunction } from "express";
import { getConfig } from "../config.js";

/**
 * Middleware for /v1/chat/completions and /chat/completions.
 * Requires Authorization: Bearer <token> to match COMPLETIONS_API_KEY from config.
 * Sends 401 with OpenAI-style error JSON when key is unset or token does not match.
 */
export function completionsAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expectedKey = getConfig().COMPLETIONS_API_KEY?.trim();
  if (!expectedKey) {
    res.status(401).json({
      error: {
        message:
          "Completions API key not configured. Set COMPLETIONS_API_KEY in Settings.",
        type: "invalid_request_error",
      },
    });
    return;
  }
  const auth = req.headers.authorization;
  const token =
    typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
  if (token !== expectedKey) {
    res.status(401).json({
      error: {
        message: "Invalid or missing Bearer token.",
        type: "invalid_request_error",
      },
    });
    return;
  }
  next();
}
