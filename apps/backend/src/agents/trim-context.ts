/**
 * Token-based context trimming so thread + memory stay under the model context window.
 * Uses ai-tokenizer for counting; no character heuristics.
 */
import Tokenizer, { models } from "ai-tokenizer";
import { count } from "ai-tokenizer/sdk";
import type { CountOptions } from "ai-tokenizer/sdk";
import * as encoding from "ai-tokenizer/encoding";
import type { LLMProviderId } from "../config.js";
import { getConfig } from "../config.js";

/** Reserve tokens for system prompt, channel context, current user message, and tool round-trips. */
export const RESERVED_TOKENS = 50_000;

const DEFAULT_MODEL_KEY = "openai/gpt-4o";

/** Map LLM_PROVIDER and model name to an ai-tokenizer model key; fallback to openai/gpt-4o so only one encoding is loaded. */
function getModelKey(provider: LLMProviderId, modelName: string): string {
  const key = `${provider}/${modelName}`.toLowerCase();
  if (key in models) return key;
  if (provider === "openai") {
    if (modelName.includes("gpt-4o")) return "openai/gpt-4o";
    if (modelName.includes("gpt-4.1")) return "openai/gpt-4.1";
    if (modelName.includes("gpt-5")) return "openai/gpt-5";
    if (modelName.includes("o1") || modelName.includes("o3"))
      return "openai/o3";
  }
  if (provider === "anthropic" && modelName.toLowerCase().includes("claude"))
    return "anthropic/claude-3.5-sonnet";
  return DEFAULT_MODEL_KEY;
}

type ModelWithEncoding = (typeof models)[keyof typeof models];
type EncodingKey = keyof typeof encoding;

/** Get tokenizer and model for the current config. Uses a single default encoding when mapping is unknown. */
export function getTokenizerForConfig(): {
  tokenizer: Tokenizer;
  model: ModelWithEncoding;
} | null {
  try {
    const c = getConfig();
    const modelKey = getModelKey(
      c.LLM_PROVIDER,
      c.OPENAI_MODEL ?? "gpt-4o",
    ) as keyof typeof models;
    const model =
      models[modelKey] ?? models[DEFAULT_MODEL_KEY as keyof typeof models];
    if (!model) return null;
    const enc = encoding[model.encoding as EncodingKey];
    if (!enc) return null;
    const tokenizer = new Tokenizer(enc);
    return { tokenizer, model };
  } catch {
    return null;
  }
}

export type ThreadMessage = { role: "user" | "assistant"; content: string };

/**
 * Trim thread and memory so total tokens stay under (maxInputTokens - reservedTokens).
 * When maxInputTokens is 0 or unset, effective max is 100_000. Always uses token counting; no character fallback.
 */
export function trimContextToTokenBudget(
  thread: ThreadMessage[],
  memoryContext: string,
  maxInputTokens: number,
  reservedTokens: number = RESERVED_TOKENS,
): { thread: ThreadMessage[]; memoryContext: string } {
  const effectiveMax = maxInputTokens > 0 ? maxInputTokens : 100_000;
  const budget = effectiveMax - reservedTokens;
  const pair = getTokenizerForConfig();
  if (!pair) {
    return { thread, memoryContext };
  }
  const { tokenizer, model } = pair;

  let threadMessages: ThreadMessage[] = [...thread];
  let memory = memoryContext;

  function buildMessages(): ThreadMessage[] {
    const out = [...threadMessages];
    if (memory.trim().length > 0)
      out.push({
        role: "user",
        content: `[Relevant memory from past conversations]\n${memory}\n\n---`,
      });
    return out;
  }

  let messages = buildMessages();
  if (messages.length === 0)
    return { thread: threadMessages, memoryContext: memory };

  const countOpts: CountOptions = {
    tokenizer: tokenizer as unknown as CountOptions["tokenizer"],
    model,
    messages,
  };
  let result = count(countOpts);
  while (result.total > budget && messages.length > 1) {
    messages.shift();
    threadMessages = threadMessages.length > 0 ? threadMessages.slice(1) : [];
    messages = buildMessages();
    if (messages.length === 0) break;
    result = count({ ...countOpts, messages });
  }
  if (messages.length === 1 && result.total > budget) {
    memory = "";
  }

  return { thread: threadMessages, memoryContext: memory };
}
