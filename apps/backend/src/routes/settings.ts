import type { Express, Request, Response } from "express";
import createDebug from "debug";
import type { AppContext } from "./helpers.js";
import type { LLMProviderId, TranscriptionProviderId } from "../config.js";
import { getConfig, updateConfig } from "../config.js";
import {
  getKillSwitchEnabled,
  setKillSwitchEnabled,
} from "../agents/kill-switch.js";

const debug = createDebug("hooman:routes:settings");

export function registerSettingsRoutes(app: Express, _ctx: AppContext): void {
  app.get("/api/config", (_req: Request, res: Response) => {
    const c = getConfig();
    res.json({
      LLM_PROVIDER: c.LLM_PROVIDER,
      TRANSCRIPTION_PROVIDER: c.TRANSCRIPTION_PROVIDER,
      OPENAI_API_KEY: c.OPENAI_API_KEY,
      OPENAI_MODEL: c.OPENAI_MODEL,
      OPENAI_EMBEDDING_MODEL: c.OPENAI_EMBEDDING_MODEL,
      OPENAI_WEB_SEARCH: c.OPENAI_WEB_SEARCH,
      MCP_USE_SERVER_MANAGER: c.MCP_USE_SERVER_MANAGER,
      OPENAI_TRANSCRIPTION_MODEL: c.OPENAI_TRANSCRIPTION_MODEL,
      AGENT_NAME: c.AGENT_NAME,
      AGENT_INSTRUCTIONS: c.AGENT_INSTRUCTIONS,
      AZURE_RESOURCE_NAME: c.AZURE_RESOURCE_NAME,
      AZURE_API_KEY: c.AZURE_API_KEY,
      AZURE_API_VERSION: c.AZURE_API_VERSION,
      AZURE_TRANSCRIPTION_DEPLOYMENT: c.AZURE_TRANSCRIPTION_DEPLOYMENT,
      DEEPGRAM_API_KEY: c.DEEPGRAM_API_KEY,
      DEEPGRAM_TRANSCRIPTION_MODEL: c.DEEPGRAM_TRANSCRIPTION_MODEL,
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
    });
  });

  app.patch("/api/config", (req: Request, res: Response): void => {
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
      OPENAI_MODEL: patch.OPENAI_MODEL as string | undefined,
      OPENAI_EMBEDDING_MODEL: patch.OPENAI_EMBEDDING_MODEL as
        | string
        | undefined,
      OPENAI_WEB_SEARCH: patch.OPENAI_WEB_SEARCH as boolean | undefined,
      MCP_USE_SERVER_MANAGER: patch.MCP_USE_SERVER_MANAGER as
        | boolean
        | undefined,
      OPENAI_TRANSCRIPTION_MODEL: patch.OPENAI_TRANSCRIPTION_MODEL as
        | string
        | undefined,
      AGENT_NAME: patch.AGENT_NAME as string | undefined,
      AGENT_INSTRUCTIONS: patch.AGENT_INSTRUCTIONS as string | undefined,
      AZURE_RESOURCE_NAME: patch.AZURE_RESOURCE_NAME as string | undefined,
      AZURE_API_KEY: patch.AZURE_API_KEY as string | undefined,
      AZURE_API_VERSION: patch.AZURE_API_VERSION as string | undefined,
      AZURE_TRANSCRIPTION_DEPLOYMENT: patch.AZURE_TRANSCRIPTION_DEPLOYMENT as
        | string
        | undefined,
      DEEPGRAM_API_KEY: patch.DEEPGRAM_API_KEY as string | undefined,
      DEEPGRAM_TRANSCRIPTION_MODEL: patch.DEEPGRAM_TRANSCRIPTION_MODEL as
        | string
        | undefined,
      ANTHROPIC_API_KEY: patch.ANTHROPIC_API_KEY as string | undefined,
      AWS_REGION: patch.AWS_REGION as string | undefined,
      AWS_ACCESS_KEY_ID: patch.AWS_ACCESS_KEY_ID as string | undefined,
      AWS_SECRET_ACCESS_KEY: patch.AWS_SECRET_ACCESS_KEY as string | undefined,
      AWS_SESSION_TOKEN: patch.AWS_SESSION_TOKEN as string | undefined,
      GOOGLE_GENERATIVE_AI_API_KEY: patch.GOOGLE_GENERATIVE_AI_API_KEY as
        | string
        | undefined,
      GOOGLE_VERTEX_PROJECT: patch.GOOGLE_VERTEX_PROJECT as string | undefined,
      GOOGLE_VERTEX_LOCATION: patch.GOOGLE_VERTEX_LOCATION as
        | string
        | undefined,
      GOOGLE_VERTEX_API_KEY: patch.GOOGLE_VERTEX_API_KEY as string | undefined,
      MISTRAL_API_KEY: patch.MISTRAL_API_KEY as string | undefined,
      DEEPSEEK_API_KEY: patch.DEEPSEEK_API_KEY as string | undefined,
    });
    res.json(updated);
  });

  app.post(
    "/api/realtime/client-secret",
    async (req: Request, res: Response) => {
      const config = getConfig();
      const apiKey = config.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        res.status(400).json({
          error: "OPENAI_API_KEY not configured. Set it in Settings.",
        });
        return;
      }
      const model =
        (req.body as { model?: string })?.model ??
        config.OPENAI_TRANSCRIPTION_MODEL;
      try {
        const response = await fetch(
          "https://api.openai.com/v1/realtime/client_secrets",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expires_after: { anchor: "created_at", seconds: 300 },
              session: {
                type: "transcription",
                audio: {
                  input: {
                    format: { type: "audio/pcm", rate: 24000 },
                    noise_reduction: { type: "near_field" },
                    transcription: {
                      model: model || "gpt-4o-transcribe",
                      prompt: "",
                      language: "en",
                    },
                    turn_detection: {
                      type: "server_vad",
                      threshold: 0.5,
                      prefix_padding_ms: 300,
                      silence_duration_ms: 500,
                    },
                  },
                },
              },
            }),
          },
        );
        if (!response.ok) {
          const err = await response.text();
          debug("realtime client_secrets error: %s", err);
          res
            .status(response.status)
            .json({ error: err || "Failed to create client secret." });
          return;
        }
        const data = (await response.json()) as { value: string };
        res.json({ value: data.value });
      } catch (err) {
        debug("realtime client-secret error: %o", err);
        res
          .status(500)
          .json({ error: "Failed to create transcription session." });
      }
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
