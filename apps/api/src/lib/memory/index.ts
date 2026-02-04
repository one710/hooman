import fs from "node:fs";
import path from "node:path";
import type { MemoryType } from "../types/index.js";
import { QdrantClient } from "@qdrant/js-client-rest";

export interface MemorySearchResult {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
  userId?: string;
}

export interface MemoryServiceConfig {
  /** OpenAI API key (required for Mem0 embeddings). */
  openaiApiKey: string;
  /** Qdrant URL (required). Mem0 uses Qdrant as the vector store. */
  qdrantUrl: string;
  /** Embedding model for Mem0 (e.g. text-embedding-3-small). Default: text-embedding-3-small. */
  embeddingModel?: string;
  /** LLM model for Mem0 (e.g. gpt-5.2). Default: gpt-5.2. */
  llmModel?: string;
}

export interface IMemoryService {
  add(
    messages: Array<{ role: string; content: string }>,
    options?: {
      userId?: string;
      metadata?: Record<string, unknown>;
      colleagueId?: string;
    },
  ): Promise<void>;
  search(
    query: string,
    options?: { userId?: string; limit?: number; colleagueId?: string },
  ): Promise<MemorySearchResult[]>;
  getAll(options?: {
    userId?: string;
    colleagueId?: string;
  }): Promise<MemorySearchResult[]>;
  delete(memoryId: string): Promise<void>;
  deleteAll(options?: { userId?: string; colleagueId?: string }): Promise<void>;
}

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_LLM_MODEL = "gpt-5.2";

/** Embedding dimension for known OpenAI models; default 1536. */
function embeddingDimsForModel(model: string): number {
  const m = (model || "").toLowerCase();
  if (m.includes("3-large") || m.includes("embedding-3-large")) return 3072;
  return 1536;
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
      colleagueId?: string;
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
    options?: { userId?: string; limit?: number; colleagueId?: string },
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

  async getAll(options?: {
    userId?: string;
    colleagueId?: string;
  }): Promise<MemorySearchResult[]> {
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

  async deleteAll(options?: {
    userId?: string;
    colleagueId?: string;
  }): Promise<void> {
    await this.mem.deleteAll({ userId: options?.userId ?? "default" });
  }
}

/** No-op memory when API key or Qdrant is missing; allows API and Settings to start. */
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

const MEMORY_MIGRATIONS_COLLECTION = "memory_migrations";

/**
 * Ensure the `memory_migrations` collection exists in Qdrant so mem0ai's initialize() does not
 * call createCollection and hit "Collection already exists" (400). mem0ai only catches 409.
 */
async function ensureQdrantMigrationsCollection(url: string): Promise<void> {
  const client = new QdrantClient({ url });
  const { collections } = await client.getCollections();
  const exists = collections.some(
    (c: { name: string }) => c.name === MEMORY_MIGRATIONS_COLLECTION,
  );
  if (exists) return;
  try {
    await client.createCollection(MEMORY_MIGRATIONS_COLLECTION, {
      vectors: { size: 1, distance: "Cosine" },
    });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const msg =
      String(
        (err as { data?: { status?: { error?: string } }; message?: string })
          ?.data?.status?.error ?? "",
      ) + String((err as { message?: string })?.message ?? "");
    if (status === 400 && msg.includes("already exists")) return;
    throw err;
  }
}

/**
 * Create a Mem0-backed memory service using Qdrant as the vector store.
 * If openaiApiKey or qdrantUrl is missing, returns a no-op stub so the API (and Settings page) can start.
 */
export async function createMemoryService(
  config: MemoryServiceConfig,
): Promise<IMemoryService> {
  const apiKey = (config.openaiApiKey ?? "").trim();
  const qdrantUrl = (config.qdrantUrl ?? "").trim();
  if (!apiKey || !qdrantUrl) {
    return new StubMemoryService();
  }

  await ensureQdrantMigrationsCollection(qdrantUrl);

  const mod = await import("mem0ai/oss");
  const Memory = (
    mod as unknown as {
      Memory: new (opts: Record<string, unknown>) => Mem0Like;
    }
  ).Memory;

  const embeddingModel =
    (config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL).trim() ||
    DEFAULT_EMBEDDING_MODEL;
  const llmModel =
    (config.llmModel ?? DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL;
  const embeddingDims = embeddingDimsForModel(embeddingModel);

  const dataDir = path.join(process.cwd(), "data");
  const memoryDbPath = path.join(dataDir, "memory.db");
  fs.mkdirSync(dataDir, { recursive: true });

  const memory = new Memory({
    version: "v1.1",
    embedder: {
      provider: "openai",
      config: { apiKey, model: embeddingModel },
    },
    vectorStore: {
      provider: "qdrant",
      config: {
        url: qdrantUrl,
        collectionName: "hooman_memories",
        embeddingModelDims: embeddingDims,
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
