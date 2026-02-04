import { Agent, Runner, run, setDefaultOpenAIKey } from "@openai/agents";
import type { ColleagueConfig } from "../types/index.js";

const HOOMAN_INSTRUCTIONS = `You are Hooman, an autonomous digital self that operates on behalf of the user.
Be conversational and human-first. Use memory context when provided to tailor and remember preferences.
When the user's request fits a specialized colleague you can hand off to, do so. Otherwise respond yourself.
If you need an external capability (e.g. send email, Slack), say so and ask for approval; never assume.`;

/** Simple thread item for building input; we convert to SDK format (content as array) before run(). */
export type AgentInputItem = { role: "user" | "assistant"; content: string };

/** SDK protocol: user content part. */
const inputText = (text: string) => ({ type: "input_text" as const, text });
/** SDK protocol: assistant content part. */
const outputText = (text: string) => ({ type: "output_text" as const, text });

/**
 * Convert simple { role, content: string } items to SDK format where content is an array of parts.
 * The OpenAI provider expects item.content to be an array (it calls item.content.map).
 */
function toProtocolItems(items: AgentInputItem[]): Array<
  | { role: "user"; content: Array<{ type: "input_text"; text: string }> }
  | {
      role: "assistant";
      content: Array<{ type: "output_text"; text: string }>;
      status: "completed";
    }
> {
  return items.map((item) => {
    if (item.role === "user") {
      return { role: "user" as const, content: [inputText(item.content)] };
    }
    return {
      role: "assistant" as const,
      content: [outputText(item.content)],
      status: "completed" as const,
    };
  });
}

/**
 * Build the top-level Hooman agent with optional handoffs to colleague agents.
 * When colleagues is empty, returns a single Hooman agent with no handoffs.
 */
export function createHoomanAgent(
  colleagues: ColleagueConfig[],
  options?: { apiKey?: string; model?: string },
): Agent {
  if (options?.apiKey) setDefaultOpenAIKey(options.apiKey);

  const colleagueAgents = colleagues.map((p) => {
    return new Agent({
      name: p.id,
      instructions: p.responsibilities?.trim() || p.description,
      handoffDescription: p.description,
    });
  });

  return Agent.create({
    name: "Hooman",
    instructions: HOOMAN_INSTRUCTIONS,
    handoffs: colleagueAgents,
  });
}

/**
 * Run the Hooman agent with the given thread and new user message.
 * Injects memoryContext as a leading user message when provided.
 * Returns the final text output, which agent responded (for handoff traceability), and run items.
 */
export async function runChat(
  agent: Agent,
  thread: AgentInputItem[],
  newUserMessage: string,
  options?: {
    memoryContext?: string;
    apiKey?: string;
    model?: string;
    maxTurns?: number;
  },
): Promise<{
  finalOutput: string;
  history: AgentInputItem[];
  /** Name of the agent that produced the final output (Hooman or a colleague id). */
  lastAgentName?: string;
  /** Run items from the SDK (includes handoff_call_item / handoff_output_item for tracing). */
  newItems: Array<{
    type: string;
    agent?: { name: string };
    sourceAgent?: { name: string };
    targetAgent?: { name: string };
  }>;
}> {
  if (options?.apiKey) setDefaultOpenAIKey(options.apiKey);

  const input: AgentInputItem[] = [];
  if (options?.memoryContext?.trim()) {
    input.push({
      role: "user",
      content: `[Relevant memory from past conversations]\n${options.memoryContext.trim()}\n\n---`,
    });
  }
  input.push(...thread, { role: "user", content: newUserMessage });

  const runOptions = {
    maxTurns: options?.maxTurns ?? 10,
    workflowName: "Hooman chat",
  };
  const runner = options?.model?.trim()
    ? new Runner({
        model: options.model.trim(),
        workflowName: runOptions.workflowName,
      })
    : undefined;

  // SDK expects content as array of parts (e.g. input_text / output_text); string content causes item.content.map to throw.
  const protocolInput = toProtocolItems(input);
  const result = runner
    ? await runner.run(
        agent,
        protocolInput as Parameters<typeof run>[1],
        runOptions,
      )
    : await run(agent, protocolInput as Parameters<typeof run>[1], runOptions);

  const finalText =
    typeof result.finalOutput === "string"
      ? result.finalOutput
      : result.finalOutput != null
        ? String(result.finalOutput)
        : "";

  const lastAgentName = result.lastAgent?.name;
  const newItems = (result.newItems ?? []).map(
    (item: {
      type: string;
      agent?: { name: string };
      sourceAgent?: { name: string };
      targetAgent?: { name: string };
    }) => ({
      type: item.type,
      agent: item.agent ? { name: item.agent.name } : undefined,
      sourceAgent: item.sourceAgent
        ? { name: item.sourceAgent.name }
        : undefined,
      targetAgent: item.targetAgent
        ? { name: item.targetAgent.name }
        : undefined,
    }),
  );

  return { finalOutput: finalText, history: [], lastAgentName, newItems };
}
