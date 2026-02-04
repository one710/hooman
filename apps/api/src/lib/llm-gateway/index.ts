export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMGatewayConfig {
  provider?: "openai" | "anthropic";
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** When true, use OpenAI Responses API with web_search tool (browsing). */
  webSearch?: boolean;
}

const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.7;

export class LLMGateway {
  private config: Required<LLMGatewayConfig>;

  constructor(config: LLMGatewayConfig = {}) {
    this.config = {
      provider: config.provider ?? "openai",
      apiKey: config.apiKey ?? "",
      model: config.model ?? DEFAULT_MODEL,
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: config.temperature ?? DEFAULT_TEMPERATURE,
      webSearch: config.webSearch ?? false,
    };
  }

  async complete(messages: LLMMessage[]): Promise<string> {
    if (!this.config.apiKey && this.config.provider === "openai") {
      return "[Hooman] No LLM API key configured. Set it in Settings to enable reasoning. I can still chat and remember things in this session.";
    }
    if (this.config.provider === "openai") {
      if (this.config.webSearch) {
        return this.completeOpenAIResponsesAPI(messages);
      }
      return this.completeOpenAI(messages);
    }
    throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
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

  /**
   * Uses OpenAI Responses API with web_search tool so the model can look up
   * current information. Converts chat-style messages to instructions + input.
   */
  private async completeOpenAIResponsesAPI(
    messages: LLMMessage[],
  ): Promise<string> {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: this.config.apiKey });

    const systemParts: string[] = [];
    const userParts: string[] = [];
    for (const m of messages) {
      if (m.role === "system") systemParts.push(m.content);
      else if (m.role === "user") userParts.push(m.content);
      else if (m.role === "assistant") {
        // Responses API input can include prior assistant messages; we only send one user turn here
        userParts.push(m.content);
      }
    }
    const instructions =
      systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
    const input =
      userParts.length === 1 ? userParts[0] : userParts.join("\n\n");

    const response = await client.responses.create({
      model: this.config.model,
      instructions: instructions ?? undefined,
      input,
      max_output_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      tools: [{ type: "web_search" }] as unknown as Array<{
        type: "web_search_preview";
      }>,
    });

    if (response.output_text != null && response.output_text !== "") {
      return response.output_text;
    }
    throw new Error("Empty response from LLM (Responses API)");
  }
}
