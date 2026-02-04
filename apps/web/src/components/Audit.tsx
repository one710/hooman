import { useState, useEffect } from "react";
import type { AuditEntry } from "../types";
import { getAudit } from "../api";

function formatPayload(entry: AuditEntry): {
  label: string;
  content: React.ReactNode;
} {
  const payload = entry.payload;
  const t = (payload.type as string | undefined) ?? entry.type;

  // ——— Response (plain assistant reply) ———
  if (t === "response") {
    const text = (payload.text as string) ?? "";
    const userInput = (payload.userInput as string) ?? "";
    return {
      label: "Response",
      content: (
        <div className="space-y-2 text-zinc-300">
          {userInput ? (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Input
              </span>
              <p className="mt-0.5 text-white whitespace-pre-wrap">
                {userInput}
              </p>
            </div>
          ) : null}
          <div>
            {userInput ? (
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Response
              </span>
            ) : null}
            <p
              className={
                userInput ? "mt-0.5 whitespace-pre-wrap" : "whitespace-pre-wrap"
              }
            >
              {text}
            </p>
          </div>
        </div>
      ),
    };
  }

  // ——— Capability requested (ask_user with integration/capability) ———
  if (t === "capability_request") {
    const userInput = (payload.userInput as string) ?? "";
    const integration = (payload.integration as string) ?? "—";
    const capability = (payload.capability as string) ?? "—";
    const reason = (payload.reason as string) ?? "—";
    return {
      label: "Capability requested",
      content: (
        <div className="space-y-2 text-zinc-300">
          {userInput ? (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Triggered by
              </span>
              <p className="mt-0.5 text-white whitespace-pre-wrap">
                {userInput}
              </p>
            </div>
          ) : null}
          <dl className="grid gap-1.5">
            <div>
              <dt className="text-hooman-muted text-xs uppercase tracking-wide">
                Integration
              </dt>
              <dd className="font-medium text-white">{integration}</dd>
            </div>
            <div>
              <dt className="text-hooman-muted text-xs uppercase tracking-wide">
                Capability
              </dt>
              <dd>{capability}</dd>
            </div>
            <div>
              <dt className="text-hooman-muted text-xs uppercase tracking-wide">
                Reason
              </dt>
              <dd>{reason}</dd>
            </div>
          </dl>
        </div>
      ),
    };
  }

  // ——— Scheduled task (fired by scheduler: time, intent, context) ———
  if (t === "scheduled_task" || entry.type === "scheduled_task") {
    const executeAt = (payload.execute_at as string) ?? "";
    const intent = (payload.intent as string) ?? "—";
    const context = payload.context as Record<string, unknown> | undefined;
    const contextEntries =
      context && typeof context === "object" && Object.keys(context).length > 0
        ? Object.entries(context)
        : [];
    const scheduledTime = executeAt
      ? new Date(executeAt).toLocaleString(undefined, {
          dateStyle: "short",
          timeStyle: "short",
        })
      : "—";
    return {
      label: "Scheduled task",
      content: (
        <div className="space-y-2 text-zinc-300">
          <dl className="grid gap-1.5">
            <div>
              <dt className="text-hooman-muted text-xs uppercase tracking-wide">
                Scheduled time
              </dt>
              <dd className="font-medium text-white">{scheduledTime}</dd>
            </div>
            <div>
              <dt className="text-hooman-muted text-xs uppercase tracking-wide">
                Intent
              </dt>
              <dd>
                <span className="text-hooman-accent">{intent}</span>
              </dd>
            </div>
          </dl>
          {contextEntries.length > 0 && (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Context
              </span>
              <ul className="text-sm mt-0.5 space-y-0.5 list-disc list-inside">
                {contextEntries.map(([k, v]) => (
                  <li key={k}>
                    <span className="text-hooman-muted">{k}:</span>{" "}
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ),
    };
  }

  // ——— Decision (LLM or scheduler decision: delegate, scheduled task, etc.) ———
  if (t === "decision") {
    const userInput = (payload.userInput as string) ?? "";
    const decision = payload.decision as Record<string, unknown> | undefined;
    const decisionType = (decision?.type as string) ?? "—";
    const reasoning = (decision?.reasoning as string) ?? "";
    const innerPayload = decision?.payload as
      | Record<string, unknown>
      | undefined;
    const colleagueIds = innerPayload?.colleagueIds as string[] | undefined;
    const intent = innerPayload?.intent as string | undefined;
    const isScheduledTask =
      reasoning?.toLowerCase().includes("scheduled task") ||
      (innerPayload != null && "intent" in innerPayload);

    const triggerBlock = userInput ? (
      <div>
        <span className="text-hooman-muted text-xs uppercase tracking-wide">
          Triggered by
        </span>
        <p className="mt-0.5 text-white whitespace-pre-wrap">{userInput}</p>
      </div>
    ) : null;

    if (isScheduledTask && intent !== undefined) {
      const context = innerPayload?.context as
        | Record<string, unknown>
        | undefined;
      const contextEntries =
        context &&
        typeof context === "object" &&
        Object.keys(context).length > 0
          ? Object.entries(context)
          : [];
      return {
        label: "Scheduled task",
        content: (
          <div className="space-y-2 text-zinc-300">
            {triggerBlock}
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Task ran
              </span>
              <p className="mt-0.5 font-medium text-white">
                <span className="text-hooman-accent">{intent || "—"}</span>
              </p>
            </div>
            {contextEntries.length > 0 && (
              <div>
                <span className="text-hooman-muted text-xs uppercase tracking-wide">
                  Context
                </span>
                <ul className="text-sm mt-0.5 space-y-0.5 list-disc list-inside">
                  {contextEntries.map(([k, v]) => (
                    <li key={k}>
                      <span className="text-hooman-muted">{k}:</span>{" "}
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ),
      };
    }

    // Delegation: highlight colleague
    if (decisionType === "delegate_single" && colleagueIds?.length) {
      return {
        label: "Delegation",
        content: (
          <div className="space-y-2 text-zinc-300">
            {triggerBlock}
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Delegated to
              </span>
              <p className="mt-0.5 font-medium text-white">
                <span className="text-hooman-accent">
                  {colleagueIds.join(", ")}
                </span>
              </p>
            </div>
            {reasoning && (
              <div>
                <span className="text-hooman-muted text-xs uppercase tracking-wide">
                  Reasoning
                </span>
                <p className="mt-0.5 text-sm whitespace-pre-wrap">
                  {reasoning}
                </p>
              </div>
            )}
          </div>
        ),
      };
    }

    // Ignored
    if (decisionType === "ignore") {
      return {
        label: "Ignored",
        content: (
          <div className="space-y-2 text-zinc-300">
            {triggerBlock}
            {reasoning ? (
              <div>
                <span className="text-hooman-muted text-xs uppercase tracking-wide">
                  Reasoning
                </span>
                <p className="mt-0.5 whitespace-pre-wrap">{reasoning}</p>
              </div>
            ) : (
              <p className="text-hooman-muted text-sm">No action taken.</p>
            )}
          </div>
        ),
      };
    }

    // Other decision types (respond_directly, delegate_multiple, schedule_future, ask_user, escalate_risk)
    const typeLabels: Record<string, string> = {
      respond_directly: "Respond directly",
      delegate_multiple: "Delegate (multiple)",
      schedule_future: "Schedule for later",
      ask_user: "Ask user",
      escalate_risk: "Escalate",
    };
    const typeLabel = typeLabels[decisionType] ?? decisionType;
    return {
      label: typeLabel,
      content: (
        <div className="space-y-2 text-zinc-300">
          {triggerBlock}
          {reasoning && (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Reasoning
              </span>
              <p className="mt-0.5 whitespace-pre-wrap">{reasoning}</p>
            </div>
          )}
          {colleagueIds?.length ? (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Delegated to
              </span>
              <p className="mt-0.5">{colleagueIds.join(", ")}</p>
            </div>
          ) : null}
          {innerPayload &&
          Object.keys(innerPayload).length > 0 &&
          !colleagueIds?.length ? (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Details
              </span>
              <pre className="text-xs mt-0.5 overflow-x-auto">
                {JSON.stringify(innerPayload, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ),
    };
  }

  // ——— Agent run (chat turn with optional handoffs) ———
  if (t === "agent_run") {
    const userInput = (payload.userInput as string) ?? "";
    const response = (payload.response as string) ?? "";
    const lastAgentName = (payload.lastAgentName as string) ?? "—";
    const handoffs =
      (payload.handoffs as Array<{
        type: string;
        from?: string;
        to?: string;
      }>) ?? [];
    const handoffLines = handoffs
      .filter((h) => h.from || h.to)
      .map((h) =>
        h.to ? `${h.from ?? "?"} → ${h.to}` : `${h.from ?? "?"} (handoff)`,
      );
    return {
      label: "Agent run",
      content: (
        <div className="space-y-2 text-zinc-300">
          {userInput ? (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Input prompt
              </span>
              <p className="mt-0.5 text-white whitespace-pre-wrap">
                {userInput}
              </p>
            </div>
          ) : null}
          {response ? (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Response
              </span>
              <p className="mt-0.5 whitespace-pre-wrap">{response}</p>
            </div>
          ) : null}
          <div>
            <span className="text-hooman-muted text-xs uppercase tracking-wide">
              Responded by
            </span>
            <p className="mt-0.5 font-medium text-white">
              <span className="text-hooman-accent">{lastAgentName}</span>
            </p>
          </div>
          {handoffLines.length > 0 && (
            <div>
              <span className="text-hooman-muted text-xs uppercase tracking-wide">
                Handoffs
              </span>
              <ul className="mt-0.5 space-y-0.5 text-sm list-disc list-inside">
                {handoffLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ),
    };
  }

  // ——— Other API-defined types (future use) ———
  if (entry.type === "action" || t === "action") {
    const action =
      (payload.action as string) ?? (payload.name as string) ?? "—";
    const details = payload.details as Record<string, unknown> | undefined;
    return {
      label: "Action",
      content: (
        <div className="space-y-1.5 text-zinc-300">
          <p className="font-medium text-white">{action}</p>
          {details && Object.keys(details).length > 0 && (
            <pre className="text-xs overflow-x-auto">
              {JSON.stringify(details, null, 2)}
            </pre>
          )}
        </div>
      ),
    };
  }
  if (entry.type === "permission" || t === "permission") {
    const granted = payload.granted as boolean | undefined;
    const capability =
      (payload.capability as string) ?? (payload.integration as string) ?? "—";
    const reason = (payload.reason as string) ?? "";
    return {
      label: granted ? "Permission granted" : "Permission denied",
      content: (
        <div className="space-y-1 text-zinc-300">
          <p className="font-medium text-white">{capability}</p>
          {reason && <p className="text-sm text-hooman-muted">{reason}</p>}
        </div>
      ),
    };
  }
  if (entry.type === "memory_write" || t === "memory_write") {
    const memoryType =
      (payload.memoryType as string) ?? (payload.type as string) ?? "—";
    const summary =
      (payload.content as string) ?? (payload.summary as string) ?? "";
    return {
      label: "Memory written",
      content: (
        <div className="space-y-1 text-zinc-300">
          <span className="text-hooman-muted text-xs uppercase tracking-wide">
            {memoryType}
          </span>
          {summary && <p className="whitespace-pre-wrap text-sm">{summary}</p>}
        </div>
      ),
    };
  }
  if (entry.type === "escalation" || t === "escalation") {
    const level =
      (payload.level as string) ?? (payload.reason as string) ?? "—";
    const reason =
      (payload.reason as string) ?? (payload.details as string) ?? "";
    return {
      label: "Escalation",
      content: (
        <div className="space-y-1 text-zinc-300">
          <p className="font-medium text-white">{level}</p>
          {reason && <p className="text-sm whitespace-pre-wrap">{reason}</p>}
        </div>
      ),
    };
  }

  // ——— Fallback: unknown type ———
  return {
    label: (t as string) || entry.type || "Event",
    content: (
      <pre className="text-xs text-zinc-400 overflow-x-auto">
        {JSON.stringify(payload, null, 2)}
      </pre>
    ),
  };
}

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getAudit()
      .then((r) => setEntries(r.entries))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 shrink-0">
        <h2 className="text-base md:text-lg font-semibold text-white">
          Audit log
        </h2>
        <p className="text-xs md:text-sm text-hooman-muted">
          See what Hooman did and why.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        {loading && entries.length === 0 ? (
          <p className="text-hooman-muted">Loading…</p>
        ) : (
          <ul className="space-y-3">
            {[...entries].reverse().map((e) => {
              const { label, content } = formatPayload(e);
              return (
                <li
                  key={e.id}
                  className="rounded-lg border border-hooman-border bg-hooman-surface px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-2 text-hooman-muted mb-2">
                    <span className="font-medium text-hooman-accent">
                      {label}
                    </span>
                    <span className="text-xs">
                      {new Date(e.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1">{content}</div>
                </li>
              );
            })}
            {entries.length === 0 && (
              <p className="text-hooman-muted text-sm">
                No audit entries yet. Chat to generate activity.
              </p>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
