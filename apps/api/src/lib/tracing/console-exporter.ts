import createDebug from "debug";
import type { TracingExporter } from "@openai/agents";

const debug = createDebug("hooman:tracing");

type TraceLike = {
  type: "trace";
  traceId: string;
  name: string;
  groupId?: string | null;
};
type SpanLike = {
  type: "trace.span";
  spanData?: {
    type: string;
    name?: string;
    from_agent?: string;
    to_agent?: string;
    handoffs?: string[];
    response_id?: string;
  };
};
type ExportItem = TraceLike | SpanLike;

function isTrace(item: ExportItem): item is TraceLike {
  return (item as TraceLike).type === "trace";
}

function isSpan(item: ExportItem): item is SpanLike {
  return (item as SpanLike).type === "trace.span";
}

/**
 * Human-friendly console exporter for traces and spans.
 * Logs readable lines instead of raw JSON.
 */
export class HumanFriendlyConsoleExporter implements TracingExporter {
  async export(
    items: (TraceLike | SpanLike)[],
    _signal?: AbortSignal,
  ): Promise<void> {
    for (const item of items) {
      if (isTrace(item)) {
        const group = item.groupId ? ` [${item.groupId}]` : "";
        console.log(`[Trace] ${item.name} (${item.traceId})${group}`);
        continue;
      }
      if (isSpan(item)) {
        const d = item.spanData;
        if (!d) continue;
        switch (d.type) {
          case "agent":
            const handoffs = (d.handoffs ?? []).length
              ? ` → handoffs: ${(d.handoffs ?? []).join(", ")}`
              : "";
            debug("  Agent: %s%s", d.name ?? "?", handoffs);
            break;
          case "handoff":
            debug("  Handoff: %s → %s", d.from_agent ?? "?", d.to_agent ?? "?");
            break;
          case "response":
            debug("  Response: %s", d.response_id ?? "—");
            break;
          default:
            debug("  Span: %s %s", d.type, d.name ?? "");
        }
      }
    }
  }
}
