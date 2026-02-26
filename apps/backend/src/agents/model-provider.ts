import { createOpenAI } from "@ai-sdk/openai";
import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { AppConfig } from "../config.js";

export const DEFAULT_CHAT_MODEL = "gpt-5.2";

/** Raw AI SDK model (no aisdk wrapper). */
export function getHoomanModel(config: AppConfig) {
  const modelId = config.CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  const provider = config.LLM_PROVIDER ?? "openai";

  switch (provider) {
    case "openai": {
      const apiKey = config.OPENAI_API_KEY;
      return createOpenAI({
        apiKey: apiKey?.trim() || undefined,
      })(modelId);
    }
    case "azure": {
      const resourceName = (config.AZURE_CHAT_RESOURCE_NAME ?? "").trim();
      const apiKey = (config.AZURE_API_KEY ?? "").trim();
      if (!resourceName || !apiKey) {
        throw new Error(
          "Azure provider requires Azure chat resource name and API key. Set them in Settings.",
        );
      }
      return createAzure({
        resourceName,
        apiKey,
        apiVersion: (config.AZURE_API_VERSION ?? "").trim() || undefined,
      })(modelId);
    }
    case "anthropic": {
      const apiKey = (config.ANTHROPIC_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error(
          "Anthropic provider requires ANTHROPIC_API_KEY. Set it in Settings.",
        );
      }
      return createAnthropic({ apiKey })(modelId);
    }
    case "amazon-bedrock": {
      const region = (config.AWS_REGION ?? "").trim();
      const accessKeyId = (config.AWS_ACCESS_KEY_ID ?? "").trim();
      const secretAccessKey = (config.AWS_SECRET_ACCESS_KEY ?? "").trim();
      if (!region || !accessKeyId || !secretAccessKey) {
        throw new Error(
          "Amazon Bedrock provider requires AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY. Set them in Settings.",
        );
      }
      return createAmazonBedrock({
        region,
        accessKeyId,
        secretAccessKey,
        sessionToken: (config.AWS_SESSION_TOKEN ?? "").trim() || undefined,
      })(modelId);
    }
    case "google": {
      const apiKey = (config.GOOGLE_GENERATIVE_AI_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error(
          "Google Generative AI provider requires GOOGLE_GENERATIVE_AI_API_KEY. Set it in Settings.",
        );
      }
      return createGoogleGenerativeAI({ apiKey })(modelId);
    }
    case "google-vertex": {
      const project = (config.GOOGLE_VERTEX_PROJECT ?? "").trim();
      const location = (config.GOOGLE_VERTEX_LOCATION ?? "").trim();
      const apiKey = (config.GOOGLE_VERTEX_API_KEY ?? "").trim();
      if (!project || !location) {
        throw new Error(
          "Google Vertex provider requires GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_LOCATION. Set them in Settings (or use GOOGLE_APPLICATION_CREDENTIALS for service account).",
        );
      }
      return createVertex({
        project,
        location,
        apiKey: apiKey || undefined,
      })(modelId);
    }
    case "mistral": {
      const apiKey = (config.MISTRAL_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error(
          "Mistral provider requires MISTRAL_API_KEY. Set it in Settings.",
        );
      }
      return createMistral({ apiKey })(modelId);
    }
    case "deepseek": {
      const apiKey = (config.DEEPSEEK_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new Error(
          "DeepSeek provider requires DEEPSEEK_API_KEY. Set it in Settings.",
        );
      }
      return createDeepSeek({ apiKey })(modelId);
    }
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}
