import { join } from "path";
import { MemoryLayer } from "@one710/recollect";
import type { ModelMessage } from "ai";
import type { ChatHistoryStore } from "../chats/chat-history.js";
import { getConfig } from "../config.js";
import { getHoomanModel } from "./model-provider.js";
import { WORKSPACE_ROOT } from "../utils/workspace.js";

/** @deprecated Use ModelMessage[] for full AI SDK format (tool calls, etc.). Kept for type compatibility. */
export type ThreadMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export interface ContextStore {
  /** Persist one user/assistant turn (plain text) to chat history and recollect. */
  addTurn(
    userId: string,
    userText: string,
    assistantText: string,
    userAttachments?: string[],
  ): Promise<void>;
  /** Persist a full turn as AI SDK messages (includes tool calls, tool results, etc.). Use when available. Call addTurnToChatHistory too so the UI has the turn. */
  addTurnMessages(userId: string, messages: ModelMessage[]): Promise<void>;
  /** Persist one user/assistant turn to chat history only (for UI). Use with addTurnMessages when storing full AI SDK messages in memory. */
  addTurnToChatHistory(
    userId: string,
    userText: string,
    assistantText: string,
    userAttachments?: string[],
  ): Promise<void>;
  /** Token-limited thread for the agent (from recollect; full AI SDK messages when stored with addTurnMessages). */
  getThreadForAgent(userId: string): Promise<ModelMessage[]>;
  /** Clear all messages for the user (chat history and recollect). */
  clearAll(userId: string): Promise<void>;
}

function createMemoryLayer(): MemoryLayer {
  const config = getConfig();
  const maxTokens = config.MAX_INPUT_TOKENS ?? 100_000;
  const summarizationModel = getHoomanModel(config);
  return new MemoryLayer({
    maxTokens,
    summarizationModel,
    threshold: 0.9,
    databasePath: join(WORKSPACE_ROOT, "context.db"),
  });
}

export function createContext(chatHistory: ChatHistoryStore): ContextStore {
  const memory = createMemoryLayer();

  return {
    async addTurn(
      userId: string,
      userText: string,
      assistantText: string,
      userAttachments?: string[],
    ): Promise<void> {
      await chatHistory.addMessage(userId, "user", userText, userAttachments);
      await chatHistory.addMessage(userId, "assistant", assistantText);
      await memory.addMessage(userId, "user", userText);
      await memory.addMessage(userId, "assistant", assistantText);
    },

    async addTurnMessages(
      userId: string,
      messages: ModelMessage[],
    ): Promise<void> {
      for (const msg of messages) {
        await memory.addMessage(userId, null, msg);
      }
    },

    async addTurnToChatHistory(
      userId: string,
      userText: string,
      assistantText: string,
      userAttachments?: string[],
    ): Promise<void> {
      await chatHistory.addMessage(userId, "user", userText, userAttachments);
      await chatHistory.addMessage(userId, "assistant", assistantText);
    },

    async getThreadForAgent(userId: string): Promise<ModelMessage[]> {
      const messages = await memory.getMessages(userId);
      return messages.map((msg) => {
        if (msg.role === "system") {
          return { ...msg, role: "user" as const };
        }
        // Bedrock rejects assistant messages with empty content (e.g. tool-call-only).
        if (
          msg.role === "assistant" &&
          Array.isArray(msg.content) &&
          msg.content.length === 0
        ) {
          return { ...msg, content: " " };
        }
        return msg;
      });
    },

    async clearAll(userId: string): Promise<void> {
      await chatHistory.clearAll(userId);
      await memory.clearSession(userId);
    },
  };
}
