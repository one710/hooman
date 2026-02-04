import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useDialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { DateTimePicker } from "./DateTimePicker";

interface Task {
  id: string;
  execute_at: string;
  intent: string;
  context: Record<string, unknown>;
}

async function getSchedule(): Promise<Task[]> {
  const res = await fetch("/api/schedule");
  if (!res.ok) return [];
  const data = await res.json();
  return data.tasks ?? [];
}

async function createTask(
  execute_at: string,
  intent: string,
  context: Record<string, unknown>,
): Promise<Task> {
  const res = await fetch("/api/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ execute_at, intent, context }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function cancelTask(id: string): Promise<void> {
  const res = await fetch(`/api/schedule/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export function Schedule() {
  const dialog = useDialog();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [executeAt, setExecuteAt] = useState("");
  const [intent, setIntent] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getSchedule()
      .then(setTasks)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!executeAt || !intent) {
      setError("Set execute time and intent.");
      return;
    }
    setError(null);
    try {
      await createTask(executeAt, intent, {});
      setExecuteAt("");
      setIntent("");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function cancel(task: Task) {
    const ok = await dialog.confirm({
      title: "Cancel scheduled task",
      message: `Remove "${task.intent}"? This task will not run.`,
      confirmLabel: "Cancel task",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await cancelTask(task.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 shrink-0">
        <h2 className="text-base md:text-lg font-semibold text-white">
          Schedule
        </h2>
        <p className="text-xs md:text-sm text-hooman-muted">
          Future tasks. At execution time Hooman decides and Colleagues execute.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 min-h-0">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-hooman-border bg-hooman-surface p-4 space-y-3"
        >
          <h3 className="font-medium text-white">Add scheduled task</h3>
          <DateTimePicker
            label="Date and time"
            value={executeAt}
            onChange={setExecuteAt}
            placeholder="dd-mm-yyyy --:--"
          />
          <Input
            type="text"
            placeholder="Intent (e.g. call, remind)"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
          />
          <Button type="submit">Schedule</Button>
        </form>
        <div>
          <h3 className="font-medium text-white mb-2">Upcoming</h3>
          {loading && tasks.length === 0 ? (
            <p className="text-hooman-muted text-sm">Loading…</p>
          ) : (
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg border border-hooman-border bg-hooman-surface px-4 py-3 flex justify-between items-center"
                >
                  <div>
                    <p className="text-sm text-white">{t.intent}</p>
                    <p className="text-xs text-hooman-muted">
                      {new Date(t.execute_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    iconOnly
                    icon={<X className="w-4 h-4" aria-hidden />}
                    onClick={() => cancel(t)}
                    aria-label="Cancel scheduled task"
                  />
                </li>
              ))}
              {tasks.length === 0 && (
                <p className="text-hooman-muted text-sm">No scheduled tasks.</p>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
