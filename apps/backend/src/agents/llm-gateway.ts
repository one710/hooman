export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMGatewayConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

import { getConfig } from "../config.js";

const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.7;

export class LLMGateway {
  private config: Required<LLMGatewayConfig>;

  constructor(config: LLMGatewayConfig = {}) {
    this.config = {
      apiKey: config.apiKey ?? "",
      model: config.model ?? DEFAULT_MODEL,
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: config.temperature ?? DEFAULT_TEMPERATURE,
    };
  }

  async complete(messages: LLMMessage[]): Promise<string> {
    if (!this.config.apiKey) {
      return `[${getConfig().AGENT_NAME}] No LLM API key configured. Set it in Settings to enable reasoning. I can still chat and remember things in this session.`;
    }
    return this.completeOpenAI(messages);
  }

  private async completeOpenAI(messages: LLMMessage[]): Promise<string> {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: this.config.apiKey });
    const response = await client.chat.completions.create({
      model: this.config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_completion_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
    });
    const choice = response.choices?.[0];
    if (!choice?.message?.content) {
      throw new Error("Empty response from LLM");
    }
    return choice.message.content;
  }
}
