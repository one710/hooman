/**
 * Realtime transcription business logic: provider dispatch, Deepgram/Azure
 * proxy behaviour, and client-secret (OpenAI ephemeral key) creation.
 * Used by routes/settings.ts (POST /api/realtime/client-secret) and
 * routes/transcribe-ws.ts (WebSocket transcription).
 */
import createDebug from "debug";
import { WebSocket } from "ws";
import type { AppConfig } from "../config.js";

const debug = createDebug("hooman:realtime-service");

function toBuf(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Deepgram proxy
// ---------------------------------------------------------------------------
function handleDeepgram(clientWs: WebSocket, config: AppConfig): void {
  const apiKey = (config.DEEPGRAM_API_KEY ?? "").trim();
  const model = (config.TRANSCRIPTION_MODEL ?? "").trim() || "nova-2";

  if (!apiKey) {
    clientWs.close(1011, "DEEPGRAM_API_KEY not configured");
    return;
  }

  const params = new URLSearchParams({
    model,
    interim_results: "true",
    smart_format: "true",
    language: "en",
  });
  const deepgramUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  debug("Connecting to Deepgram (key length %d)", apiKey.length);
  const upstreamWs = new WebSocket(deepgramUrl, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  let ready = false;
  const pendingAudio: Buffer[] = [];

  upstreamWs.on("open", () => {
    debug(
      "Deepgram WebSocket open, flushing %d buffered chunks",
      pendingAudio.length,
    );
    ready = true;
    for (const chunk of pendingAudio) upstreamWs.send(chunk);
    pendingAudio.length = 0;
  });

  upstreamWs.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    clientWs.send(toBuf(data).toString("utf8"));
  });

  upstreamWs.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    debug("Deepgram WebSocket error: %o", err);
    if (clientWs.readyState === WebSocket.OPEN) {
      const reason =
        msg.includes("403") || msg.includes("401")
          ? "Deepgram rejected the connection. Check your API key in Settings and that it has streaming access."
          : "Transcription service error";
      clientWs.close(1011, reason);
    }
  });

  upstreamWs.on("close", () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = toBuf(data);
    if (buf.length === 0) return;
    try {
      const msg = JSON.parse(buf.toString("utf8")) as { type?: string };
      if (msg.type === "CloseStream") {
        upstreamWs.close();
        return;
      }
    } catch {
      // not JSON — treat as audio
    }
    if (ready) {
      upstreamWs.send(buf);
    } else {
      pendingAudio.push(buf);
    }
  });

  clientWs.on("close", () => upstreamWs.close());
  clientWs.on("error", () => upstreamWs.close());
}

// ---------------------------------------------------------------------------
// Azure OpenAI Realtime proxy
// ---------------------------------------------------------------------------

const AZURE_TRANSCRIPTION_EVENT_TYPES = new Set([
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
  "error",
]);

function handleAzureRealtime(clientWs: WebSocket, config: AppConfig): void {
  const resourceName = (config.AZURE_TRANSCRIPTION_RESOURCE_NAME ?? "").trim();
  const apiKey = (config.AZURE_API_KEY ?? "").trim();
  const deployment =
    (config.TRANSCRIPTION_MODEL ?? "").trim() || "gpt-4o-realtime-preview";
  const apiVersion =
    (config.AZURE_API_VERSION ?? "").trim() || "2024-10-01-preview";

  if (!resourceName || !apiKey) {
    clientWs.close(
      1011,
      "Azure transcription resource name and API key must be configured in Settings.",
    );
    return;
  }

  const azureUrl = `wss://${resourceName}.openai.azure.com/openai/realtime?api-version=${encodeURIComponent(apiVersion)}&deployment=${encodeURIComponent(deployment)}`;
  debug("Connecting to Azure OpenAI Realtime (%s)", azureUrl);
  const upstreamWs = new WebSocket(azureUrl, {
    headers: { "api-key": apiKey },
  });

  let ready = false;
  const pendingAudio: Buffer[] = [];

  upstreamWs.on("open", () => {
    debug("Azure OpenAI Realtime WebSocket open, sending session.update");
    upstreamWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text"],
          input_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: false,
          },
        },
      }),
    );
  });

  upstreamWs.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    const text = toBuf(data).toString("utf8");
    let event: { type?: string } | undefined;
    try {
      event = JSON.parse(text) as { type?: string };
    } catch {
      return;
    }

    if (event.type === "session.updated") {
      debug(
        "Azure session configured, flushing %d buffered chunks",
        pendingAudio.length,
      );
      ready = true;
      for (const chunk of pendingAudio) {
        upstreamWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: chunk.toString("base64"),
          }),
        );
      }
      pendingAudio.length = 0;
      return;
    }

    if (event.type === "error") {
      debug("Azure Realtime error: %s", text);
    }

    if (
      clientWs.readyState === WebSocket.OPEN &&
      AZURE_TRANSCRIPTION_EVENT_TYPES.has(event.type ?? "")
    ) {
      clientWs.send(text);
    }
  });

  upstreamWs.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    debug("Azure Realtime WebSocket error: %o", err);
    if (clientWs.readyState === WebSocket.OPEN) {
      const reason =
        msg.includes("403") || msg.includes("401")
          ? "Azure rejected the connection. Check your API key and resource name in Settings."
          : "Azure Realtime connection error";
      clientWs.close(1011, reason);
    }
  });

  upstreamWs.on("close", () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = toBuf(data);
    if (buf.length === 0) return;
    try {
      const msg = JSON.parse(buf.toString("utf8")) as { type?: string };
      if (msg.type === "CloseStream") {
        upstreamWs.close();
        return;
      }
    } catch {
      // Binary audio — PCM16 from client
    }
    if (ready) {
      upstreamWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: buf.toString("base64"),
        }),
      );
    } else {
      pendingAudio.push(buf);
    }
  });

  clientWs.on("close", () => upstreamWs.close());
  clientWs.on("error", () => upstreamWs.close());
}

// ---------------------------------------------------------------------------
// Public: handle a single client WebSocket (provider dispatch)
// ---------------------------------------------------------------------------
export function handleRealtimeConnection(
  clientWs: WebSocket,
  config: AppConfig,
): void {
  const provider = config.TRANSCRIPTION_PROVIDER ?? "openai";

  if (provider === "deepgram") {
    handleDeepgram(clientWs, config);
  } else if (provider === "azure") {
    handleAzureRealtime(clientWs, config);
  } else {
    clientWs.close(
      1011,
      "WebSocket transcription is not available for provider: " + provider,
    );
  }
}

// ---------------------------------------------------------------------------
// Public: get realtime client secret / provider info for voice input
// ---------------------------------------------------------------------------
export type RealtimeClientSecretResult =
  | { provider: "openai"; value: string }
  | { provider: "azure" }
  | { provider: "deepgram" }
  | { error: string; status: number };

export async function getRealtimeClientSecret(
  config: AppConfig,
  body?: { model?: string },
): Promise<RealtimeClientSecretResult> {
  const provider = config.TRANSCRIPTION_PROVIDER ?? "openai";

  if (provider === "deepgram") {
    return { provider: "deepgram" };
  }

  if (provider === "azure") {
    const resourceName = (
      config.AZURE_TRANSCRIPTION_RESOURCE_NAME ?? ""
    ).trim();
    const azureKey = (config.AZURE_API_KEY ?? "").trim();
    if (!resourceName || !azureKey) {
      return {
        error:
          "Azure transcription resource name and API key must be configured in Settings.",
        status: 400,
      };
    }
    return { provider: "azure" };
  }

  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      error: "OPENAI_API_KEY not configured. Set it in Settings.",
      status: 400,
    };
  }

  const model =
    body?.model ?? config.TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe";
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
      return {
        error: err || "Failed to create client secret.",
        status: response.status,
      };
    }
    const data = (await response.json()) as { value: string };
    return { provider: "openai", value: data.value };
  } catch (err) {
    debug("realtime client-secret error: %o", err);
    return {
      error: "Failed to create transcription session.",
      status: 500,
    };
  }
}
