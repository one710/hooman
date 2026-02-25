import type { FilePart, ImagePart, ModelMessage, TextPart } from "ai";

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type UserContentPart = TextPart | ImagePart | FilePart;

export interface UserContentAttachment {
  name: string;
  contentType: string;
  data: string;
}

/**
 * Build AI SDK user content parts (text + optional image/file attachments as data URLs).
 */
export function buildUserContentParts(
  text: string,
  attachments?: UserContentAttachment[],
): UserContentPart[] {
  const parts: UserContentPart[] = [{ type: "text", text }];
  if (attachments?.length) {
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
        parts.push({
          type: "image",
          image: dataUrl,
          mediaType: contentType,
        });
      } else {
        parts.push({
          type: "file",
          data: dataUrl,
          mediaType: contentType,
        });
      }
    }
  }
  return parts;
}

/** Normalize raw tool result to AI SDK ToolResultPart output shape (LanguageModelV2ToolResultOutput). */
function toToolResultOutput(
  raw: unknown,
):
  | { type: "text"; value: string }
  | { type: "json"; value: unknown }
  | { type: "error-text"; value: string } {
  if (raw === undefined || raw === null) {
    return { type: "text", value: "" };
  }

  if (typeof raw === "string") {
    return { type: "text", value: raw };
  }

  const obj = raw as Record<string, unknown>;
  if (typeof obj.type === "string" && typeof obj.value !== "undefined") {
    return obj as
      | { type: "text"; value: string }
      | { type: "json"; value: unknown }
      | { type: "error-text"; value: string };
  }

  if (Array.isArray(obj.content) && typeof obj.isError === "boolean") {
    const text = (obj.content as Array<{ type?: string; text?: string }>)
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
    return obj.isError
      ? { type: "error-text", value: text || JSON.stringify(obj) }
      : { type: "text", value: text || JSON.stringify(obj) };
  }

  return { type: "json", value: raw };
}

/**
 * Build AI SDK messages for this turn (user message + assistant tool/text from result) for storage in recollect.
 * Uses ToolResultPart shape: toolCallId, toolName, output (not result) so stored messages validate on read.
 */
export function buildTurnMessagesFromResult(
  newUserMessage: ModelMessage,
  result: { steps?: unknown[]; text?: string },
): ModelMessage[] {
  const out: ModelMessage[] = [newUserMessage];
  const steps = result.steps ?? [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as { toolCalls?: unknown[]; toolResults?: unknown[] };
    const calls = step.toolCalls ?? [];
    const results = step.toolResults ?? [];
    if (calls.length > 0) {
      const toolCalls = calls.map((c, j) => {
        const x = c as Record<string, unknown>;
        return {
          toolCallId: (x.toolCallId as string) ?? `call_${i}_${j}`,
          toolName: (x.toolName as string) ?? (x.name as string) ?? "unknown",
          args: (x.args ?? x.input ?? {}) as Record<string, unknown>,
        };
      });
      out.push({ role: "assistant", content: [], toolCalls } as ModelMessage);
      // Store exactly one tool-result per tool-call, in order (toolCallId/toolName from call).
      // So stored format matches Bedrock/AI SDK and we never have more results than calls.
      const content = toolCalls.map((call, j) => {
        const r = results[j] as Record<string, unknown> | undefined;
        const raw = r?.result ?? r?.output;
        return {
          type: "tool-result" as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: toToolResultOutput(raw),
        };
      });
      out.push({ role: "tool", content } as unknown as ModelMessage);
    }
  }
  const finalText = (result.text ?? "").trim();
  if (finalText.length > 0) {
    out.push({ role: "assistant", content: finalText });
  }
  return out;
}
