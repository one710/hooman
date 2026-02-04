import { useState, useEffect } from "react";
import { getKillSwitch, setKillSwitch, getHealth } from "../api";

async function getCapabilities(): Promise<
  { integrationId: string; capability: string }[]
> {
  const res = await fetch("/api/capabilities");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.capabilities ?? []).filter(
    (c: { granted?: boolean }) => c.granted !== false,
  );
}

export function Safety() {
  const [killSwitch, setKillSwitchState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<{
    status: string;
    killSwitch?: boolean;
  } | null>(null);
  const [capabilities, setCapabilities] = useState<
    { integrationId: string; capability: string }[]
  >([]);

  useEffect(() => {
    getKillSwitch().then((r) => {
      setKillSwitchState(r.enabled);
      setLoading(false);
    });
    getHealth().then(setHealth);
    getCapabilities().then(setCapabilities);
  }, []);

  async function toggleKillSwitch() {
    const next = !killSwitch;
    try {
      await setKillSwitch(next);
      setKillSwitchState(next);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 shrink-0">
        <h2 className="text-base md:text-lg font-semibold text-white">
          Safety & control
        </h2>
        <p className="text-xs md:text-sm text-hooman-muted">
          Global kill switch, capability permissions, audit.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 min-h-0">
        {health && (
          <div className="rounded-xl border border-hooman-border bg-hooman-surface p-4">
            <p className="text-sm text-hooman-muted">API status</p>
            <p className="text-white font-medium">
              {health.status === "ok" ? "Running" : health.status}
            </p>
          </div>
        )}
        <div className="rounded-xl border border-hooman-border bg-hooman-surface p-4">
          <h3 className="font-medium text-white mb-2">Global kill switch</h3>
          <p className="text-sm text-hooman-muted mb-4">
            When the kill switch is on, Hooman is paused and no events are
            processed. Turn it off to resume.
          </p>
          {loading ? (
            <p className="text-hooman-muted text-sm">Loading…</p>
          ) : (
            <button
              onClick={toggleKillSwitch}
              className={`rounded-lg px-4 py-2 font-medium text-sm ${
                killSwitch
                  ? "bg-hooman-green/20 text-hooman-green"
                  : "bg-hooman-red/20 text-hooman-red"
              }`}
            >
              {killSwitch
                ? "Hooman paused — click to resume"
                : "Hooman active — click to pause"}
            </button>
          )}
        </div>
        <div className="rounded-xl border border-hooman-border bg-hooman-surface p-4">
          <h3 className="font-medium text-white mb-2">Capability approvals</h3>
          <p className="text-sm text-hooman-muted mb-3">
            When Hooman requests access (e.g. send email, Slack), you approve in
            Chat or here.
          </p>
          {capabilities.length > 0 ? (
            <ul className="text-sm text-zinc-300 space-y-1">
              {capabilities.map((c, i) => (
                <li key={i}>
                  {c.integrationId} → {c.capability}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-hooman-muted">
              No capabilities approved yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
