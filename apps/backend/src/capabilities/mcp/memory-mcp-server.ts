#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ChromaVectorStore,
  HFEmbeddingProvider,
  createServer,
} from "@one710/consciousness";
import { ChromaClient } from "chromadb";
import { env } from "../../env.js";

const embeddingProvider = new HFEmbeddingProvider();
const chromaUrl = env.CHROMA_URL;
const collectionName = env.CHROMA_COLLECTION;

const client = new ChromaClient({ path: chromaUrl });
const vectorStore = new ChromaVectorStore(
  embeddingProvider,
  client,
  collectionName,
);

const server = createServer("consciousness", "1.0.3", vectorStore);
const transport = new StdioServerTransport();
await server.connect(transport);
