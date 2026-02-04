import type {
  IncomingEvent,
  Decision,
  AuditLogEntry,
  ColleagueConfig,
} from "../types/index.js";
import type { EventRouter } from "../event-router/index.js";
import type { IMemoryService } from "../memory/index.js";
import type { LLMGateway } from "../llm-gateway/index.js";
import createDebug from "debug";
import { randomUUID } from "crypto";

const debug = createDebug("hooman:runtime");

const SYSTEM_PROMPT = `You are Hooman, an autonomous digital self that operates on behalf of the user. You are not a chatbot—you reason over memory, delegate to specialized colleagues when needed, and act through configured integrations. You are explainable, controllable, and never pose as the user silently.

Rules:
- Be conversational and human-first.
- When the user sends a message, decide one of: respond_directly (answer yourself), delegate_single (name one colleague id to handle it), ask_user (need clarification or approval), or ignore (not relevant).
- If you need an external capability (e.g. send email, Slack), respond with ask_user and suggest the capability; never assume.
- Use memory to tailor and remember preferences.
- Respond in JSON when you are making a decision: {"decision":"respond_directly"|"delegate_single"|"ask_user"|"ignore", "reasoning":"...", "response":"..." (if respond_directly), "colleagueId":"..." (if delegate_single), "capabilityRequest":{"integration":"...","capability":"...","reason":"..."} (if ask_user)}.
- If you're just replying in conversation, you may respond in plain text; the system will treat it as respond_directly with your message as response.`;

export type HoomanResponsePayload =
  | { type: "response"; text: string; eventId: string; userInput?: string }
  | {
      type: "decision";
      decision: Decision;
      eventId: string;
      userInput?: string;
    }
  | {
      type: "capability_request";
      integration: string;
      capability: string;
      reason: string;
      eventId: string;
      userInput?: string;
    };

export type HoomanResponseHandler = (payload: HoomanResponsePayload) => void;

export interface HoomanRuntimeConfig {
  eventRouter: EventRouter;
  memory: IMemoryService;
  llm?: LLMGateway;
  getLLM?: () => LLMGateway;
  getColleagues?: () => ColleagueConfig[];
  userId?: string;
}

const DEFAULT_USER_ID = "default";

export class HoomanRuntime {
  private config: HoomanRuntimeConfig;
  private onResponse: HoomanResponseHandler[] = [];
  private auditLog: AuditLogEntry[] = [];

  constructor(config: HoomanRuntimeConfig) {
    this.config = config;
    config.eventRouter.register(this.handleEvent.bind(this));
  }

  onResponseReceived(handler: HoomanResponseHandler): () => void {
    this.onResponse.push(handler);
    return () => {
      this.onResponse = this.onResponse.filter((h) => h !== handler);
    };
  }

  private emit(payload: HoomanResponsePayload): void {
    this.auditLog.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "decision",
      payload: payload as unknown as Record<string, unknown>,
    });
    this.onResponse.forEach((h) => h(payload));
  }

  private async handleEvent(event: IncomingEvent): Promise<void> {
    const userId = this.config.userId ?? DEFAULT_USER_ID;

    if (event.source === "ui" && event.type === "message.sent") {
      const text = (event.payload as { text: string }).text;
      try {
        await this.handleTextMessage(event, text, userId);
      } catch (err) {
        debug("handleEvent error: %o", err);
        this.emit({
          type: "response",
          text: `Something went wrong: ${(err as Error).message}. Check API logs.`,
          eventId: event.id,
          userInput: text,
        });
      }
      return;
    }

    if (event.source === "scheduler" && event.type === "task.scheduled") {
      const payload = event.payload as {
        execute_at: string;
        intent: string;
        context: Record<string, unknown>;
      };
      this.appendAuditEntry({
        type: "scheduled_task",
        payload: {
          execute_at: payload.execute_at,
          intent: payload.intent,
          context: payload.context,
        },
      });
      const contextStr =
        Object.keys(payload.context).length === 0
          ? "(none)"
          : Object.entries(payload.context)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", ");
      const text = `Scheduled task: ${payload.intent}. Context: ${contextStr}.`;
      try {
        await this.handleTextMessage(event, text, userId);
      } catch (err) {
        debug("handleEvent error (scheduled task): %o", err);
        this.emit({
          type: "response",
          text: `Scheduled task failed: ${(err as Error).message}. Check API logs.`,
          eventId: event.id,
          userInput: text,
        });
      }
      return;
    }
  }

  private async handleTextMessage(
    event: IncomingEvent,
    text: string,
    userId: string,
  ): Promise<void> {
    const memories = await this.config.memory.search(text, {
      userId,
      limit: 5,
    });
    const memoryContext =
      memories.length > 0
        ? "Relevant memory:\n" + memories.map((m) => `- ${m.memory}`).join("\n")
        : "";

    const colleagues = this.config.getColleagues?.() ?? [];
    const colleagueList =
      colleagues.length > 0
        ? "Available colleagues: " +
          colleagues.map((p) => `${p.id}: ${p.description}`).join("; ")
        : "No colleagues configured yet.";

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `${memoryContext}\n\n${colleagueList}\n\nUser said: "${text}". Decide and respond (JSON or plain text).`,
      },
    ];

    const llm = this.config.getLLM ? this.config.getLLM() : this.config.llm!;
    const raw = await llm.complete(messages);

    // Parse decision from LLM output (so we can store human-readable and emit correctly)
    const parsed = this.parseDecision(raw, event.id);
    const assistantDisplay =
      parsed.response != null && parsed.response !== "" ? parsed.response : raw;

    // Store in memory as two entries (user then assistant) so chat history can be built from Mem0 only
    const createdAt = new Date().toISOString();
    await this.config.memory.add([{ role: "user", content: text }], {
      userId,
      metadata: { createdAt, role: "user", messageIndex: 0 },
    });
    const assistantMeta: Record<string, unknown> = {
      createdAt,
      role: "assistant",
      messageIndex: 1,
    };
    if (parsed.reasoning != null && parsed.reasoning !== "") {
      assistantMeta.reasoning = parsed.reasoning;
    }
    await this.config.memory.add(
      [{ role: "assistant", content: assistantDisplay }],
      { userId, metadata: assistantMeta },
    );
    if (parsed.decision === "respond_directly" && parsed.response != null) {
      this.emit({
        type: "response",
        text: parsed.response,
        eventId: event.id,
        userInput: text,
      });
      return;
    }
    if (parsed.decision === "delegate_single" && parsed.colleagueId) {
      this.emit({
        type: "decision",
        decision: {
          type: "delegate_single",
          eventId: event.id,
          reasoning: parsed.reasoning,
          payload: { colleagueIds: [parsed.colleagueId] },
        },
        eventId: event.id,
        userInput: text,
      });
      // For now we don't have colleague execution in this package; API will handle delegation
      // Echo back to user that the task was delegated
      this.emit({
        type: "response",
        text: `I've delegated this to ${parsed.colleagueId}. (Colleague execution runs in the API layer.)`,
        eventId: event.id,
        userInput: text,
      });
      return;
    }
    if (parsed.decision === "ask_user" && parsed.capabilityRequest) {
      this.emit({
        type: "capability_request",
        ...parsed.capabilityRequest,
        eventId: event.id,
        userInput: text,
      });
      this.emit({
        type: "response",
        text:
          parsed.response ||
          `I need your approval to use: ${parsed.capabilityRequest.capability}. Reason: ${parsed.capabilityRequest.reason}`,
        eventId: event.id,
        userInput: text,
      });
      return;
    }
    if (parsed.decision === "ask_user") {
      this.emit({
        type: "response",
        text:
          parsed.response ||
          parsed.reasoning ||
          "I need a bit more detail to proceed.",
        eventId: event.id,
        userInput: text,
      });
      return;
    }
    // Default: if we parsed JSON with a response, show it; otherwise show raw
    const responseText =
      parsed.response != null && parsed.response !== "" ? parsed.response : raw;
    this.emit({
      type: "response",
      text: responseText,
      eventId: event.id,
      userInput: text,
    });
  }

  private parseDecision(
    raw: string,
    _eventId: string,
  ): {
    decision: Decision["type"];
    response?: string;
    colleagueId?: string;
    reasoning?: string;
    capabilityRequest?: {
      integration: string;
      capability: string;
      reason: string;
    };
  } {
    const trimmed = raw.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const o = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        return {
          decision: (o.decision as Decision["type"]) ?? "respond_directly",
          response: o.response as string | undefined,
          colleagueId: o.colleagueId as string | undefined,
          reasoning: o.reasoning as string | undefined,
          capabilityRequest: o.capabilityRequest as
            | { integration: string; capability: string; reason: string }
            | undefined,
        };
      } catch {
        // fall through to plain text
      }
    }
    return {
      decision: "respond_directly",
      response: trimmed,
    };
  }

  getAuditLog(): AuditLogEntry[] {
    return [...this.auditLog];
  }

  /** Append an audit entry (e.g. agent_run from POST /api/chat). */
  appendAuditEntry(entry: Omit<AuditLogEntry, "id" | "timestamp">): void {
    this.auditLog.push({
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    });
  }
}
