import type { IMemoryService } from "../memory/index.js";
import type { ChatHistoryStore } from "../chat-history/index.js";
import type { GetMessagesResult } from "../chat-history/index.js";
import type { MemorySearchResult } from "../memory/index.js";

export interface ContextStore {
  /** Persist one user/assistant turn to both memory (Mem0) and chat history (MongoDB). */
  addTurn(
    userId: string,
    userText: string,
    assistantText: string,
  ): Promise<void>;
  /** Last N messages in chronological order for agent thread. */
  getRecentMessages(
    userId: string,
    limit: number,
  ): Promise<Array<{ role: "user" | "assistant"; text: string }>>;
  /** Paginated messages for GET /api/chat/history. */
  getMessages(
    userId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<GetMessagesResult>;
  /** Clear all messages and memory for the user. */
  clearAll(userId: string): Promise<void>;
  /** Semantic search over memory for agent context. */
  search(
    query: string,
    options?: { userId?: string; limit?: number },
  ): Promise<MemorySearchResult[]>;
}

export function createContext(
  memory: IMemoryService,
  chatHistory: ChatHistoryStore,
): ContextStore {
  return {
    async addTurn(
      userId: string,
      userText: string,
      assistantText: string,
    ): Promise<void> {
      const createdAt = new Date().toISOString();
      await memory.add([{ role: "user", content: userText }], {
        userId,
        metadata: { createdAt, role: "user", messageIndex: 0 },
      });
      await memory.add([{ role: "assistant", content: assistantText }], {
        userId,
        metadata: { createdAt, role: "assistant", messageIndex: 1 },
      });
      await chatHistory.addMessage(userId, "user", userText);
      await chatHistory.addMessage(userId, "assistant", assistantText);
    },

    async getRecentMessages(
      userId: string,
      limit: number,
    ): Promise<Array<{ role: "user" | "assistant"; text: string }>> {
      return chatHistory.getRecentMessages(userId, limit);
    },

    async getMessages(
      userId: string,
      options?: { page?: number; pageSize?: number },
    ): Promise<GetMessagesResult> {
      return chatHistory.getMessages(userId, options);
    },

    async clearAll(userId: string): Promise<void> {
      await chatHistory.clearAll(userId);
      await memory.deleteAll({ userId });
    },

    async search(
      query: string,
      options?: { userId?: string; limit?: number },
    ): Promise<MemorySearchResult[]> {
      return memory.search(query, {
        userId: options?.userId ?? "default",
        limit: options?.limit ?? 10,
      });
    },
  };
}
