import { useState, useEffect } from "react";
import createDebug from "debug";
import { getKillSwitch, setKillSwitch } from "../api";
import { PageHeader } from "./PageHeader";

const debug = createDebug("hooman:Safety");

export function Safety() {
  const [killSwitch, setKillSwitchState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getKillSwitch().then((r) => {
      setKillSwitchState(r.enabled);
      setLoading(false);
    });
  }, []);

  async function toggleKillSwitch() {
    const next = !killSwitch;
    try {
      await setKillSwitch(next);
      setKillSwitchState(next);
    } catch (e) {
      debug("%o", e);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Safety & control"
        subtitle="Pause Hooman or control what it’s allowed to do."
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 min-h-0">
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
      </div>
    </div>
  );
}
