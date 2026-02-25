import { join } from "path";
import { MemoryLayer } from "@one710/recollect";
import type { ChatHistoryStore } from "../chats/chat-history.js";
import { getConfig } from "../config.js";
import { getHoomanModel } from "./model-provider.js";
import { WORKSPACE_ROOT } from "../utils/workspace.js";

export type ThreadMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export interface ContextStore {
  /** Persist one user/assistant turn to chat history and recollect. Call only for api-source chat. */
  addTurn(
    userId: string,
    userText: string,
    assistantText: string,
    userAttachments?: string[],
  ): Promise<void>;
  /** Token-limited thread for the agent (from recollect; may include system summary). */
  getThreadForAgent(userId: string): Promise<ThreadMessage[]>;
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

    async getThreadForAgent(userId: string): Promise<ThreadMessage[]> {
      const msgs = await memory.getMessages(userId);
      return msgs.map((m) => ({ role: m.role, content: m.content }));
    },

    async clearAll(userId: string): Promise<void> {
      await chatHistory.clearAll(userId);
      await memory.clearSession(userId);
    },
  };
}
