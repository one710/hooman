import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import type { AppContext } from "./helpers.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { getConfig } from "../config.js";
import { completionsAuth } from "../middleware/completions-auth.js";

/** Paths for the completions API; excluded from JWT and used as public paths when exposed (e.g. ngrok). */
export const COMPLETION_ROUTES = new Set([
  "/v1/chat/completions",
  "/chat/completions",
]);

const POLL_INTERVAL_MS = 200;
const WAIT_TIMEOUT_MS = 90_000;

/** Extract plain text from OpenAI message content (string or array of parts). */
function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text: unknown }).text === "string"
      ) {
        return (part as { text: string }).text.trim();
      }
    }
  }
  return "";
}

/**
 * Parse OpenAI messages and return the last user message text.
 * Used to feed the same pipeline as /api/chat (no attachments).
 */
function getLastUserMessage(messages: unknown[]): string | null {
  let last = "";
  for (const m of messages) {
    if (!m || typeof m !== "object" || !("role" in m) || !("content" in m))
      continue;
    const role = (m as { role: string }).role;
    if (role !== "user") continue;
    last =
      messageContentToText((m as { content: unknown }).content) || "(empty)";
  }
  return last || null;
}

export function registerCompletionsRoutes(app: Express, ctx: AppContext): void {
  const { enqueue, responseStore } = ctx;

  const completionsHandler = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    if (getKillSwitchEnabled()) {
      res.status(503).json({
        error: {
          message: `${getConfig().AGENT_NAME} is paused (kill switch).`,
          type: "server_error",
        },
      });
      return;
    }

    const body = req.body as { messages?: unknown[]; model?: string };
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: {
          message: "Request body must include a non-empty 'messages' array.",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const text = getLastUserMessage(body.messages);
    if (text === null) {
      res.status(400).json({
        error: {
          message: "At least one 'user' message is required in 'messages'.",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const eventId = randomUUID();
    const userId = "default";

    await enqueue(
      {
        source: "api",
        type: "message.sent",
        payload: { text, userId },
      },
      { correlationId: eventId },
    );

    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    let list: Array<{ role: "user" | "assistant"; text: string }> | undefined;
    while (Date.now() < deadline) {
      list = responseStore.get(eventId);
      if (list && list.length > 0) {
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    const assistantText =
      (list && list.length > 0 ? list[list.length - 1].text : null) ??
      "This is taking longer than expected. The agent may be using a tool or waiting on a handoff. You can try again or rephrase.";

    responseStore.delete(eventId);

    const config = getConfig();
    const completionId = `chatcmpl-${randomUUID().replace(/-/g, "")}`;
    res.json({
      id: completionId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: config.OPENAI_MODEL,
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content: assistantText },
          finish_reason: "stop" as const,
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  };

  for (const path of COMPLETION_ROUTES) {
    app.post(path, completionsAuth, completionsHandler);
  }
}
