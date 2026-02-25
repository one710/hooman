import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import type { AuditEntry } from "../types";
import { getAudit } from "../api";
import { getSocket } from "../socket";
import { Button } from "./Button";

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getAudit()
      .then((r) => setEntries(r.entries))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    socket.on("connect", load);
    return () => {
      socket.off("connect", load);
    };
  }, [load]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white">
            Audit log
          </h2>
          <p className="text-xs md:text-sm text-hooman-muted">
            See what Hooman did and why.
          </p>
        </div>
        <Button
          onClick={load}
          variant="secondary"
          className="self-start sm:self-auto"
          icon={
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          }
        >
          Refresh
        </Button>
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
            {entries.map((e) => (
              <li
                key={e.id}
                className="rounded-lg border border-hooman-border bg-hooman-surface px-4 py-3 text-sm"
              >
                <div className="text-xs text-hooman-muted mb-2">
                  {new Date(e.timestamp).toISOString()}
                </div>
                <pre className="text-xs text-zinc-400 overflow-x-auto whitespace-pre-wrap font-mono">
                  {JSON.stringify(
                    {
                      id: e.id,
                      timestamp: e.timestamp,
                      type: e.type,
                      payload: e.payload,
                    },
                    null,
                    2,
                  )}
                </pre>
              </li>
            ))}
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
