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

/**
 * Build AI SDK messages for this turn (user message + assistant tool/text from result) for storage in recollect.
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
    }
    if (results.length > 0) {
      const content = results.map((r, j) => {
        const x = r as Record<string, unknown>;
        return {
          type: "tool-result" as const,
          toolCallId: (x.toolCallId as string) ?? `call_${i}_${j}`,
          result: x.result ?? x.output,
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
