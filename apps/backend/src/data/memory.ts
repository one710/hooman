import fs from "node:fs";
import type { MemoryType } from "../types.js";
import {
  getWorkspaceMemoryDbPath,
  getWorkspaceVectorDbPath,
  WORKSPACE_ROOT,
} from "../workspace.js";

export interface MemorySearchResult {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
  userId?: string;
}

export interface MemoryServiceConfig {
  /** OpenAI API key (required for Mem0 LLM; embeddings are local via embeddings.js). */
  openaiApiKey: string;
  /** LLM model for Mem0 (e.g. gpt-5.2). Default: gpt-5.2. */
  llmModel?: string;
}

export interface IMemoryService {
  add(
    messages: Array<{ role: string; content: string }>,
    options?: {
      userId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  search(
    query: string,
    options?: { userId?: string; limit?: number },
  ): Promise<MemorySearchResult[]>;
  getAll(options?: { userId?: string }): Promise<MemorySearchResult[]>;
  delete(memoryId: string): Promise<void>;
  deleteAll(options?: { userId?: string }): Promise<void>;
}

const DEFAULT_LLM_MODEL = "gpt-5.2";

/** Local embeddings via @themaximalist/embeddings.js (Xenova/all-MiniLM-L6-v2). */
const LOCAL_EMBEDDING_DIMS = 384;

/**
 * Adapter that implements the interface Mem0's LangchainEmbedder expects
 * (embedQuery, embedDocuments) using @themaximalist/embeddings.js for local generation.
 */
async function createLocalEmbedder(): Promise<{
  embedQuery: (text: string) => Promise<number[]>;
  embedDocuments: (texts: string[]) => Promise<number[][]>;
}> {
  const embeddings = (await import("@themaximalist/embeddings.js")).default;
  return {
    embedQuery: (text: string) => embeddings(text, { service: "transformers" }),
    embedDocuments: (texts: string[]) =>
      Promise.all(
        texts.map((text) => embeddings(text, { service: "transformers" })),
      ),
  };
}

interface Mem0Like {
  add(
    messages: Array<{ role: string; content: string }>,
    options?: {
      userId?: string;
      metadata?: Record<string, unknown>;
      infer?: boolean;
    },
  ): Promise<unknown>;
  search(
    query: string,
    options?: { userId?: string },
  ): Promise<{
    results: Array<{
      id: string;
      memory: string;
      score?: number;
      metadata?: Record<string, unknown>;
      userId?: string;
    }>;
  }>;
  getAll(options?: { userId?: string }): Promise<{
    results?: Array<{
      id: string;
      memory: string;
      metadata?: Record<string, unknown>;
      userId?: string;
    }>;
  }>;
  delete(memoryId: string): Promise<unknown>;
  deleteAll(options?: { userId?: string }): Promise<unknown>;
}

class Mem0Adapter implements IMemoryService {
  constructor(private mem: Mem0Like) {}

  async add(
    messages: Array<{ role: string; content: string }>,
    options?: {
      userId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.mem.add(messages, {
      userId: options?.userId ?? "default",
      metadata: options?.metadata,
      infer: false,
    });
  }

  async search(
    query: string,
    options?: { userId?: string; limit?: number },
  ): Promise<MemorySearchResult[]> {
    const out = await this.mem.search(query, {
      userId: options?.userId ?? "default",
    });
    const results = out?.results ?? [];
    const limit = options?.limit ?? 10;
    return results.slice(0, limit).map((r) => ({
      id: r.id,
      memory: r.memory,
      score: r.score,
      metadata: r.metadata,
      userId: r.userId,
    }));
  }

  async getAll(options?: { userId?: string }): Promise<MemorySearchResult[]> {
    const out = await this.mem.getAll({ userId: options?.userId ?? "default" });
    const results = Array.isArray(out) ? out : (out?.results ?? []);
    return results.map(
      (r: {
        id: string;
        memory: string;
        metadata?: Record<string, unknown>;
        userId?: string;
      }) => ({
        id: r.id,
        memory: r.memory,
        metadata: r.metadata,
        userId: r.userId,
      }),
    );
  }

  async delete(memoryId: string): Promise<void> {
    await this.mem.delete(memoryId);
  }

  async deleteAll(options?: { userId?: string }): Promise<void> {
    await this.mem.deleteAll({ userId: options?.userId ?? "default" });
  }
}

/** No-op memory when API key is missing; allows API and Settings to start. */
class StubMemoryService implements IMemoryService {
  async add(): Promise<void> {}
  async search(): Promise<MemorySearchResult[]> {
    return [];
  }
  async getAll(): Promise<MemorySearchResult[]> {
    return [];
  }
  async delete(): Promise<void> {}
  async deleteAll(): Promise<void> {}
}

/**
 * Create a Mem0-backed memory service.
 * - Embeddings: local via @themaximalist/embeddings.js (Xenova/all-MiniLM-L6-v2), no API.
 * - Vector store: SQLite at workspace/vector.db.
 * - History store: SQLite at workspace/memory.db.
 * If openaiApiKey is missing, returns a no-op stub so the API (and Settings page) can start.
 */
export async function createMemoryService(
  config: MemoryServiceConfig,
): Promise<IMemoryService> {
  const apiKey = (config.openaiApiKey ?? "").trim();
  if (!apiKey) {
    return new StubMemoryService();
  }

  const [mod, localEmbedder] = await Promise.all([
    import("mem0ai/oss"),
    createLocalEmbedder(),
  ]);
  const Memory = (
    mod as unknown as {
      Memory: new (opts: Record<string, unknown>) => Mem0Like;
    }
  ).Memory;

  const llmModel =
    (config.llmModel ?? DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL;

  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const memoryDbPath = getWorkspaceMemoryDbPath();

  const memory = new Memory({
    version: "v1.1",
    embedder: {
      provider: "langchain",
      config: { model: localEmbedder },
    },
    vectorStore: {
      provider: "memory",
      config: {
        collectionName: "hooman_memories",
        dimension: LOCAL_EMBEDDING_DIMS,
        dbPath: getWorkspaceVectorDbPath(),
      },
    },
    llm: {
      provider: "openai",
      config: { apiKey, model: llmModel },
    },
    historyStore: {
      provider: "sqlite",
      config: { historyDbPath: memoryDbPath },
    },
  });

  return new Mem0Adapter(memory);
}

export type { MemoryType };
