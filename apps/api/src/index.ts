import "dotenv/config";
import createDebug from "debug";
import express from "express";
import cors from "cors";

const debug = createDebug("hooman:api");
import {
  addTraceProcessor,
  BatchTraceProcessor,
  startTraceExportLoop,
} from "@openai/agents";
import { HumanFriendlyConsoleExporter } from "./lib/tracing/console-exporter.js";
import { EventRouter } from "./lib/event-router/index.js";
import { createMemoryService } from "./lib/memory/index.js";
import { LLMGateway } from "./lib/llm-gateway/index.js";
import { HoomanRuntime } from "./lib/hooman-runtime/index.js";
import { ColleagueEngine } from "./lib/colleagues/index.js";
import { Scheduler } from "./lib/scheduler/index.js";
import { MCPClientLayer } from "./lib/mcp-client/index.js";
import type { IncomingEvent } from "./lib/types/index.js";
import type { HoomanResponsePayload } from "./lib/hooman-runtime/index.js";
import { getConfig, loadPersisted } from "./config.js";
import { registerRoutes } from "./routes.js";
import { initChatHistory } from "./lib/chat-history/index.js";
import { createContext } from "./lib/context/index.js";
import { initColleagueStore } from "./lib/colleagues/store.js";
import { initScheduleStore } from "./lib/schedule-store/index.js";

await loadPersisted();

// Human-friendly console tracing: handoffs and agent runs as readable lines in API logs.
addTraceProcessor(new BatchTraceProcessor(new HumanFriendlyConsoleExporter()));
startTraceExportLoop();

const eventRouter = new EventRouter();
const config = getConfig();
const memory = await createMemoryService({
  openaiApiKey: config.OPENAI_API_KEY,
  qdrantUrl: config.QDRANT_URL,
  embeddingModel: config.OPENAI_EMBEDDING_MODEL,
  llmModel: config.OPENAI_MODEL,
});

const mongoUri = process.env.MONGO_URI?.trim();
if (!mongoUri) {
  throw new Error("MONGO_URI is required. Set it in .env.");
}

const chatHistory = await initChatHistory(mongoUri);
debug("Chat history using MongoDB");

const context = createContext(memory, chatHistory);

const colleagueStore = await initColleagueStore(mongoUri);
debug("Colleagues using MongoDB");

const colleagueEngine = new ColleagueEngine(colleagueStore);
await colleagueEngine.load();

const scheduleStore = await initScheduleStore(mongoUri);
debug("Schedules using MongoDB");

eventRouter.register(async (event) => {
  if (event.source === "api" && event.type === "chat.turn_completed") {
    const { userId, userText, assistantText } = event.payload as {
      userId: string;
      userText: string;
      assistantText: string;
    };
    await context.addTurn(userId, userText, assistantText);
  }
});

function getLLM(): LLMGateway {
  const c = getConfig();
  return new LLMGateway({
    apiKey: c.OPENAI_API_KEY,
    model: c.OPENAI_MODEL,
    webSearch: c.OPENAI_WEB_SEARCH,
  });
}

const hooman = new HoomanRuntime({
  eventRouter,
  memory,
  getLLM,
  getColleagues: () => colleagueEngine.getAll(),
  userId: "default",
});

// In-memory store for UI-bound responses (eventId -> messages)
const responseStore: Map<
  string,
  Array<{ role: "user" | "assistant"; text: string }>
> = new Map();

const scheduler = new Scheduler(
  (event: IncomingEvent) => eventRouter.dispatch(event),
  scheduleStore,
);
await scheduler.load();
scheduler.start();

const mcpClient = new MCPClientLayer();

hooman.onResponseReceived((payload: HoomanResponsePayload) => {
  if (payload.type === "response") {
    const list = responseStore.get(payload.eventId) ?? [];
    list.push({ role: "assistant", text: payload.text });
    responseStore.set(payload.eventId, list);
  }
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

registerRoutes(app, {
  eventRouter,
  context,
  hooman,
  colleagueEngine,
  responseStore,
  scheduler,
  mcpClient,
});

const PORT = getConfig().PORT;
app.listen(PORT, () => {
  debug("Hooman API listening on http://localhost:%s", PORT);
});
