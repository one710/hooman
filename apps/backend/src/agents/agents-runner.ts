import { Agent, Runner, run } from "@openai/agents";

/** Simple thread item for building input; we convert to SDK format (content as array) before run(). */
export type AgentInputItem = { role: "user" | "assistant"; content: string };

/** SDK protocol: user content parts. */
const inputText = (text: string) => ({ type: "input_text" as const, text });
const inputImage = (image: string) => ({ type: "input_image" as const, image });
const inputFile = (file: string, filename?: string) => ({
  type: "input_file" as const,
  file,
  ...(filename ? { filename } : {}),
});
/** SDK protocol: assistant content part. */
const outputText = (text: string) => ({ type: "output_text" as const, text });

type UserContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image: string }
  | { type: "input_file"; file: string; filename?: string };

/**
 * Convert simple { role, content: string } items to SDK format where content is an array of parts.
 * The OpenAI provider expects item.content to be an array (it calls item.content.map).
 */
function toProtocolItems(
  items: AgentInputItem[],
  lastUserContent?: UserContentPart[],
): Array<
  | { role: "user"; content: UserContentPart[] }
  | {
      role: "assistant";
      content: Array<{ type: "output_text"; text: string }>;
      status: "completed";
    }
> {
  return items.map((item, i) => {
    const isLastUser =
      lastUserContent && i === items.length - 1 && item.role === "user";
    if (item.role === "user") {
      return {
        role: "user" as const,
        content: isLastUser ? lastUserContent : [inputText(item.content)],
      };
    }
    return {
      role: "assistant" as const,
      content: [outputText(item.content)],
      status: "completed" as const,
    };
  });
}

/** MIME types sent as image (input_image); all others sent as file (input_file). */
const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

function buildAttachmentParts(
  attachments: Array<{ name: string; contentType: string; data: string }>,
): UserContentPart[] {
  const parts: UserContentPart[] = [];
  for (const a of attachments) {
    const data = typeof a.data === "string" ? a.data.trim() : "";
    if (!data) continue;
    const contentType = a.contentType.toLowerCase().split(";")[0].trim();
    const dataUrl = `data:${contentType};base64,${data}`;
    if (
      IMAGE_MIME_TYPES.includes(
        contentType as (typeof IMAGE_MIME_TYPES)[number],
      )
    ) {
      parts.push(inputImage(dataUrl));
    } else {
      parts.push(inputFile(dataUrl, a.name));
    }
  }
  return parts;
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
    /** Channel metadata JSON injected so the agent knows where the message came from and can reply via channel MCP tools. */
    channelContext?: string;
    apiKey?: string;
    model?: string;
    maxTurns?: number;
    attachments?: Array<{ name: string; contentType: string; data: string }>;
  },
): Promise<{
  finalOutput: string;
  history: AgentInputItem[];
  /** Name of the agent that produced the final output (Hooman or a persona id). */
  lastAgentName?: string;
  /** Run items from the SDK (includes handoff_call_item / handoff_output_item for tracing). */
  newItems: Array<{
    type: string;
    agent?: { name: string };
    sourceAgent?: { name: string };
    targetAgent?: { name: string };
  }>;
}> {
  const input: AgentInputItem[] = [];
  if (options?.memoryContext?.trim()) {
    input.push({
      role: "user",
      content: `[Relevant memory from past conversations]\n${options.memoryContext.trim()}\n\n---`,
    });
  }
  if (options?.channelContext?.trim()) {
    input.push({
      role: "user",
      content: `[Channel context] This message arrived from an external channel. You MUST use the matching MCP tool to send your reply back on this channel.\n${options.channelContext.trim()}\n\n---`,
    });
  }
  input.push(...thread, { role: "user", content: newUserMessage });

  const lastUserContent: UserContentPart[] | undefined = options?.attachments
    ?.length
    ? [inputText(newUserMessage), ...buildAttachmentParts(options.attachments)]
    : undefined;

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
  const protocolInput = toProtocolItems(input, lastUserContent);
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
