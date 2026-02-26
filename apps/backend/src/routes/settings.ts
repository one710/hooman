import type { Express, Request, Response } from "express";
import type { AppContext } from "../utils/helpers.js";
import type { LLMProviderId, TranscriptionProviderId } from "../config.js";
import { getConfig, updateConfig } from "../config.js";

import {
  getKillSwitchEnabled,
  setKillSwitchEnabled,
} from "../agents/kill-switch.js";
import { getRealtimeClientSecret } from "../chats/realtime-service.js";

export function registerSettingsRoutes(app: Express, _ctx: AppContext): void {
  app.get("/api/config", (_req: Request, res: Response) => {
    const c = getConfig();
    res.json({
      LLM_PROVIDER: c.LLM_PROVIDER,
      TRANSCRIPTION_PROVIDER: c.TRANSCRIPTION_PROVIDER,
      OPENAI_API_KEY: c.OPENAI_API_KEY,
      CHAT_MODEL: c.CHAT_MODEL,

      TRANSCRIPTION_MODEL: c.TRANSCRIPTION_MODEL,
      AGENT_NAME: c.AGENT_NAME,
      AGENT_INSTRUCTIONS: c.AGENT_INSTRUCTIONS,
      AZURE_CHAT_RESOURCE_NAME: c.AZURE_CHAT_RESOURCE_NAME,
      AZURE_TRANSCRIPTION_RESOURCE_NAME: c.AZURE_TRANSCRIPTION_RESOURCE_NAME,
      AZURE_API_KEY: c.AZURE_API_KEY,
      AZURE_API_VERSION: c.AZURE_API_VERSION,
      DEEPGRAM_API_KEY: c.DEEPGRAM_API_KEY,
      ANTHROPIC_API_KEY: c.ANTHROPIC_API_KEY,
      AWS_REGION: c.AWS_REGION,
      AWS_ACCESS_KEY_ID: c.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: c.AWS_SECRET_ACCESS_KEY,
      AWS_SESSION_TOKEN: c.AWS_SESSION_TOKEN,
      GOOGLE_GENERATIVE_AI_API_KEY: c.GOOGLE_GENERATIVE_AI_API_KEY,
      GOOGLE_VERTEX_PROJECT: c.GOOGLE_VERTEX_PROJECT,
      GOOGLE_VERTEX_LOCATION: c.GOOGLE_VERTEX_LOCATION,
      GOOGLE_VERTEX_API_KEY: c.GOOGLE_VERTEX_API_KEY,
      MISTRAL_API_KEY: c.MISTRAL_API_KEY,
      DEEPSEEK_API_KEY: c.DEEPSEEK_API_KEY,
      COMPLETIONS_API_KEY: c.COMPLETIONS_API_KEY,
      MAX_INPUT_TOKENS: c.MAX_INPUT_TOKENS,
      CHAT_TIMEOUT_MS: c.CHAT_TIMEOUT_MS,
    });
  });

  app.patch(
    "/api/config",
    async (req: Request, res: Response): Promise<void> => {
      const patch = req.body as Record<string, unknown>;
      if (!patch || typeof patch !== "object") {
        res.status(400).json({ error: "Invalid body." });
        return;
      }
      const updated = updateConfig({
        LLM_PROVIDER: patch.LLM_PROVIDER as LLMProviderId | undefined,
        TRANSCRIPTION_PROVIDER: patch.TRANSCRIPTION_PROVIDER as
          | TranscriptionProviderId
          | undefined,
        OPENAI_API_KEY: patch.OPENAI_API_KEY as string | undefined,
        CHAT_MODEL: patch.CHAT_MODEL as string | undefined,
        TRANSCRIPTION_MODEL: patch.TRANSCRIPTION_MODEL as string | undefined,
        AGENT_NAME: patch.AGENT_NAME as string | undefined,
        AGENT_INSTRUCTIONS: patch.AGENT_INSTRUCTIONS as string | undefined,
        AZURE_CHAT_RESOURCE_NAME: patch.AZURE_CHAT_RESOURCE_NAME as
          | string
          | undefined,
        AZURE_TRANSCRIPTION_RESOURCE_NAME:
          patch.AZURE_TRANSCRIPTION_RESOURCE_NAME as string | undefined,
        AZURE_API_KEY: patch.AZURE_API_KEY as string | undefined,
        AZURE_API_VERSION: patch.AZURE_API_VERSION as string | undefined,
        DEEPGRAM_API_KEY: patch.DEEPGRAM_API_KEY as string | undefined,
        ANTHROPIC_API_KEY: patch.ANTHROPIC_API_KEY as string | undefined,
        AWS_REGION: patch.AWS_REGION as string | undefined,
        AWS_ACCESS_KEY_ID: patch.AWS_ACCESS_KEY_ID as string | undefined,
        AWS_SECRET_ACCESS_KEY: patch.AWS_SECRET_ACCESS_KEY as
          | string
          | undefined,
        AWS_SESSION_TOKEN: patch.AWS_SESSION_TOKEN as string | undefined,
        GOOGLE_GENERATIVE_AI_API_KEY: patch.GOOGLE_GENERATIVE_AI_API_KEY as
          | string
          | undefined,
        GOOGLE_VERTEX_PROJECT: patch.GOOGLE_VERTEX_PROJECT as
          | string
          | undefined,
        GOOGLE_VERTEX_LOCATION: patch.GOOGLE_VERTEX_LOCATION as
          | string
          | undefined,
        GOOGLE_VERTEX_API_KEY: patch.GOOGLE_VERTEX_API_KEY as
          | string
          | undefined,
        MISTRAL_API_KEY: patch.MISTRAL_API_KEY as string | undefined,
        DEEPSEEK_API_KEY: patch.DEEPSEEK_API_KEY as string | undefined,
        COMPLETIONS_API_KEY: patch.COMPLETIONS_API_KEY as string | undefined,
        MAX_INPUT_TOKENS: patch.MAX_INPUT_TOKENS as number | undefined,
        CHAT_TIMEOUT_MS: patch.CHAT_TIMEOUT_MS as number | undefined,
      });

      res.json(updated);
    },
  );

  app.post(
    "/api/realtime/client-secret",
    async (req: Request, res: Response) => {
      const config = getConfig();
      const result = await getRealtimeClientSecret(
        config,
        req.body as { model?: string } | undefined,
      );
      if ("error" in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    },
  );

  app.get("/api/safety/kill-switch", (_req: Request, res: Response) => {
    res.json({ enabled: getKillSwitchEnabled() });
  });

  app.post("/api/safety/kill-switch", (req: Request, res: Response) => {
    setKillSwitchEnabled(Boolean(req.body?.enabled));
    res.json({ enabled: getKillSwitchEnabled() });
  });
}
