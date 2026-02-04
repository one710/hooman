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
import type { RawDispatchInput } from "./lib/types/index.js";
import type { HoomanResponsePayload } from "./lib/hooman-runtime/index.js";
import { getConfig, loadPersisted } from "./config.js";
import { registerRoutes } from "./routes.js";
import { initChatHistory } from "./lib/chat-history/index.js";
import { createContext } from "./lib/context/index.js";
import { initColleagueStore } from "./lib/colleagues/store.js";
import { initScheduleStore } from "./lib/schedule-store/index.js";
import { initMCPConnectionsStore } from "./lib/mcp-connections/store.js";
import { runChat } from "./lib/agents-runner/index.js";
import { createHoomanAgentWithMcp } from "./lib/agents-runner/mcp-for-agents.js";

const CHAT_THREAD_LIMIT = 30;

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

const mcpConnectionsStore = await initMCPConnectionsStore(mongoUri);
debug("MCP connections using MongoDB");

eventRouter.register(async (event) => {
  if (
    event.source === "api" &&
    event.type === "chat.turn_completed" &&
    event.payload.kind === "internal"
  ) {
    const data = event.payload.data as {
      userId: string;
      userText: string;
      assistantText: string;
    };
    const { userId, userText, assistantText } = data;
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

/** Pending chat results: eventId -> resolve/reject for POST /api/chat awaiting event-driven response. */
export type PendingChatResult = {
  eventId: string;
  message: { role: "assistant"; text: string; lastAgentName?: string };
};
const pendingChatResults = new Map<
  string,
  {
    resolve: (value: PendingChatResult) => void;
    reject: (reason: unknown) => void;
  }
>();

// Chat handler: API-originated message.sent → run agents-runner, resolve pending promise (PRD: Event Router → Hooman path)
eventRouter.register(async (event) => {
  if (event.source !== "api" || event.payload.kind !== "message") return;
  const { text, userId } = event.payload;
  const pending = pendingChatResults.get(event.id);
  const config = getConfig();
  let assistantText = "";
  try {
    const recent = await context.getRecentMessages(userId, CHAT_THREAD_LIMIT);
    const thread = recent.map((m) => ({ role: m.role, content: m.text }));
    const memories = await context.search(text, { userId, limit: 5 });
    const memoryContext =
      memories.length > 0
        ? memories.map((m) => `- ${m.memory}`).join("\n")
        : "";
    const colleagues = colleagueEngine.getAll();
    const connections = await mcpConnectionsStore.getAll();
    const { agent, closeMcp } = await createHoomanAgentWithMcp(
      colleagues,
      connections,
      {
        apiKey: config.OPENAI_API_KEY || undefined,
        model: config.OPENAI_MODEL,
      },
    );
    try {
      const { finalOutput, lastAgentName, newItems } = await runChat(
        agent,
        thread,
        text,
        {
          memoryContext,
          apiKey: config.OPENAI_API_KEY || undefined,
          model: config.OPENAI_MODEL || undefined,
        },
      );
      assistantText =
        finalOutput?.trim() ||
        "I didn't get a clear response. Try rephrasing or check your API key and model settings.";
      const handoffs = (newItems ?? []).filter(
        (i) =>
          i.type === "handoff_call_item" || i.type === "handoff_output_item",
      );
      hooman.appendAuditEntry({
        type: "agent_run",
        payload: {
          userInput: text,
          response: assistantText,
          lastAgentName: lastAgentName ?? "Hooman",
          handoffs: handoffs.map((h) => ({
            type: h.type,
            from: h.agent?.name ?? h.sourceAgent?.name,
            to: h.targetAgent?.name,
          })),
        },
      });
      await eventRouter.dispatch({
        source: "api",
        type: "chat.turn_completed",
        payload: { userId, userText: text, assistantText },
      });
      if (pending) {
        pending.resolve({
          eventId: event.id,
          message: {
            role: "assistant",
            text: assistantText,
            lastAgentName: lastAgentName ?? undefined,
          },
        });
        pendingChatResults.delete(event.id);
      }
    } finally {
      await closeMcp();
    }
  } catch (err) {
    const msg = (err as Error).message;
    assistantText = !config.OPENAI_API_KEY?.trim()
      ? "[Hooman] No LLM API key configured. Set it in Settings to enable chat."
      : `Something went wrong: ${msg}. Check API logs.`;
    await eventRouter.dispatch({
      source: "api",
      type: "chat.turn_completed",
      payload: { userId, userText: text, assistantText },
    });
    if (pending) {
      pending.resolve({
        eventId: event.id,
        message: { role: "assistant", text: assistantText },
      });
      pendingChatResults.delete(event.id);
    }
  }
});

const scheduler = new Scheduler(
  (raw: RawDispatchInput) => eventRouter.dispatch(raw),
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
  pendingChatResults,
  mcpConnectionsStore,
});

const PORT = getConfig().PORT;
app.listen(PORT, () => {
  debug("Hooman API listening on http://localhost:%s", PORT);
});
