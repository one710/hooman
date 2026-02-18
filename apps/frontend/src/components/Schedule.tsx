import { useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { getSchedule, createScheduledTask, cancelScheduledTask } from "../api";
import { useDialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { DateTimePicker } from "./DateTimePicker";
import { Modal } from "./Modal";

interface Task {
  id: string;
  execute_at?: string;
  cron?: string;
  intent: string;
  context: Record<string, unknown>;
}

export function Schedule() {
  const dialog = useDialog();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [executeAt, setExecuteAt] = useState("");
  const [intent, setIntent] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getSchedule()
      .then((data) => setTasks(data.tasks ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  function openAdd() {
    setError(null);
    setExecuteAt("");
    setIntent("");
    setAddOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!intent) {
      setError("Intent is required.");
      return;
    }
    if (!executeAt) {
      setError("Set date and time (one-shot task).");
      return;
    }
    setError(null);
    try {
      await createScheduledTask(intent, {}, { execute_at: executeAt });
      setExecuteAt("");
      setIntent("");
      setAddOpen(false);
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
      await cancelScheduledTask(task.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white">
            Schedule
          </h2>
          <p className="text-xs md:text-sm text-hooman-muted truncate">
            Set tasks for later—Hooman will run them when the time comes.
          </p>
        </div>
        <Button
          onClick={openAdd}
          className="self-start sm:self-auto"
          icon={<Plus className="w-4 h-4" />}
        >
          Add task
        </Button>
      </header>
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add scheduled task"
        footer={
          <div className="flex gap-2">
            <Button type="submit" form="schedule-task-form">
              Schedule
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
          </div>
        }
      >
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        <form
          id="schedule-task-form"
          onSubmit={handleSubmit}
          className="space-y-3"
        >
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
        </form>
      </Modal>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        {error && !addOpen && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        <div>
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
                      {t.cron
                        ? `Recurring: ${t.cron}`
                        : t.execute_at
                          ? new Date(t.execute_at).toLocaleString()
                          : "—"}
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
