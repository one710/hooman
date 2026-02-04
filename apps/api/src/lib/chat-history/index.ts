import { MongoClient, Collection, ObjectId } from "mongodb";

const COL = "chat_messages";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface ChatMessageDoc {
  _id?: ObjectId;
  userId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: Date;
}

export interface GetMessagesResult {
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  total: number;
  page: number;
  pageSize: number;
}

export interface ChatHistoryStore {
  addMessage(
    userId: string,
    role: "user" | "assistant",
    text: string,
  ): Promise<void>;
  getMessages(
    userId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<GetMessagesResult>;
  /** Last N messages in chronological order (oldest first) for agent context. */
  getRecentMessages(
    userId: string,
    limit: number,
  ): Promise<Array<{ role: "user" | "assistant"; text: string }>>;
  clearAll(userId: string): Promise<void>;
}

let client: MongoClient | null = null;
let coll: Collection<ChatMessageDoc> | null = null;

export async function initChatHistory(uri: string): Promise<ChatHistoryStore> {
  client = new MongoClient(uri);
  await client.connect();
  const db = client.db("hooman");
  coll = db.collection<ChatMessageDoc>(COL);
  await coll.createIndex({ userId: 1, createdAt: 1 });

  return {
    async addMessage(userId: string, role: "user" | "assistant", text: string) {
      await coll!.insertOne({ userId, role, text, createdAt: new Date() });
    },
    async getMessages(
      userId: string,
      options?: { page?: number; pageSize?: number },
    ) {
      const page = Math.max(1, options?.page ?? 1);
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE),
      );
      const skip = (page - 1) * pageSize;
      const [messages, total] = await Promise.all([
        coll!
          .find({ userId })
          .sort({ createdAt: 1 })
          .skip(skip)
          .limit(pageSize)
          .project<{
            role: "user" | "assistant";
            text: string;
          }>({ role: 1, text: 1, _id: 0 })
          .toArray(),
        coll!.countDocuments({ userId }),
      ]);
      return { messages, total, page, pageSize };
    },
    async getRecentMessages(userId: string, limit: number) {
      const n = Math.min(100, Math.max(1, limit));
      const messages = await coll!
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(n)
        .project<{
          role: "user" | "assistant";
          text: string;
        }>({ role: 1, text: 1, _id: 0 })
        .toArray();
      return messages.reverse();
    },
    async clearAll(userId: string) {
      await coll!.deleteMany({ userId });
    },
  };
}
