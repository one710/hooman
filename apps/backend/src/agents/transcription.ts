/**
 * Audio transcription using the AI SDK (experimental_transcribe) with configurable
 * provider: OpenAI, Azure OpenAI, or Deepgram.
 */
import createDebug from "debug";
import { experimental_transcribe as transcribe } from "ai";
import { createAzure } from "@ai-sdk/azure";
import { createDeepgram } from "@ai-sdk/deepgram";
import { createOpenAI } from "@ai-sdk/openai";
import { getConfig } from "../config.js";
import type { TranscriptionProviderId } from "../config.js";

const debug = createDebug("hooman:transcription");

export interface TranscribeAudioOptions {
  mimeType?: string;
}

function isUnsupportedFormatError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const data =
    err && typeof err === "object" && "data" in err
      ? (err as { data?: unknown }).data
      : undefined;
  const code =
    data &&
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as { error?: { code?: string } }).error === "object"
      ? (data as { error: { code?: string } }).error?.code
      : undefined;
  return (
    msg.includes("does not support the format") ||
    msg.includes("unsupported format") ||
    code === "unsupported_format"
  );
}

/**
 * Transcribe audio buffer to text using the configured transcription provider
 * (OpenAI, Azure OpenAI, or Deepgram). Throws if the provider is misconfigured
 * or the API fails.
 * For OpenAI, if gpt-4o-transcribe rejects the format (e.g. some Slack WAVs),
 * falls back to whisper-1 automatically.
 */
export async function transcribeAudio(
  buffer: Buffer,
  _options?: TranscribeAudioOptions,
): Promise<string> {
  const config = getConfig();
  const provider = config.TRANSCRIPTION_PROVIDER as TranscriptionProviderId;

  const model = getTranscriptionModel(provider, config);

  try {
    const transcript = await transcribe({
      model,
      audio: buffer,
    });
    const text = transcript.text?.trim() ?? "";
    if (!text) {
      debug("Transcription returned empty text");
    }
    return text;
  } catch (err) {
    // OpenAI gpt-4o-transcribe can reject some WAV encodings (e.g. Slack voice clips).
    // Fall back to whisper-1 which accepts a wider range of formats.
    const configuredModel =
      (config.TRANSCRIPTION_MODEL ?? "").trim() || "gpt-4o-transcribe";
    if (
      provider === "openai" &&
      isUnsupportedFormatError(err) &&
      configuredModel.toLowerCase().includes("gpt-4o")
    ) {
      const apiKey = (config.OPENAI_API_KEY ?? "").trim();
      if (apiKey) {
        debug(
          "OpenAI transcription format rejected, retrying with whisper-1: %o",
          err,
        );
        const openai = createOpenAI({ apiKey });
        const fallbackModel = openai.transcription("whisper-1");
        const transcript = await transcribe({
          model: fallbackModel,
          audio: buffer,
        });
        const text = transcript.text?.trim() ?? "";
        if (!text) {
          debug("Transcription (whisper-1 fallback) returned empty text");
        }
        return text;
      }
    }
    throw err;
  }
}

type TranscriptionConfig = ReturnType<typeof getConfig>;

function getTranscriptionModel(
  provider: TranscriptionProviderId,
  config: TranscriptionConfig,
): ReturnType<ReturnType<typeof createOpenAI>["transcription"]> {
  switch (provider) {
    case "openai": {
      const apiKey = (config.OPENAI_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error(
          "Transcription (OpenAI) requires OPENAI_API_KEY. Set it in Settings.",
        );
      }
      const modelId =
        (config.TRANSCRIPTION_MODEL ?? "").trim() || "gpt-4o-transcribe";
      const openai = createOpenAI({ apiKey });
      return openai.transcription(modelId);
    }
    case "azure": {
      const resourceName = (config.AZURE_RESOURCE_NAME ?? "").trim();
      const apiKey = (config.AZURE_API_KEY ?? "").trim();
      if (!resourceName || !apiKey) {
        throw new Error(
          "Transcription (Azure) requires AZURE_RESOURCE_NAME and AZURE_API_KEY. Set them in Settings.",
        );
      }
      const deployment =
        (config.TRANSCRIPTION_MODEL ?? "").trim() || "whisper-1";
      const azure = createAzure({
        resourceName,
        apiKey,
        apiVersion: (config.AZURE_API_VERSION ?? "").trim() || undefined,
      });
      return azure.transcription(deployment) as ReturnType<
        ReturnType<typeof createOpenAI>["transcription"]
      >;
    }
    case "deepgram": {
      const apiKey = (config.DEEPGRAM_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error(
          "Transcription (Deepgram) requires DEEPGRAM_API_KEY. Set it in Settings.",
        );
      }
      const modelId = (config.TRANSCRIPTION_MODEL ?? "").trim() || "nova-2";
      const deepgram = createDeepgram({ apiKey });
      return deepgram.transcription(modelId) as ReturnType<
        ReturnType<typeof createOpenAI>["transcription"]
      >;
    }
    default: {
      throw new Error(
        `Unknown transcription provider: ${provider}. Set TRANSCRIPTION_PROVIDER to openai, azure, or deepgram.`,
      );
    }
  }
}
