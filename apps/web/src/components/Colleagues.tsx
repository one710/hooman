import { useState, useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import { useDialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Select } from "./Select";
import { MultiSelect } from "./MultiSelect";
import { Modal } from "./Modal";
import type { ColleagueConfig } from "../types";
import {
  getColleagues,
  getCapabilitiesAvailable,
  createColleague,
  updateColleague,
  deleteColleague,
} from "../api";

export function Colleagues() {
  const dialog = useDialog();
  const [colleagues, setColleagues] = useState<ColleagueConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ColleagueConfig>>({});
  const [error, setError] = useState<string | null>(null);
  const [capabilitiesList, setCapabilitiesList] = useState<
    { integrationId: string; capability: string }[]
  >([]);

  const capabilityOptions = useMemo(
    () =>
      capabilitiesList.map((c) => ({
        value: `${c.integrationId}:${c.capability}`,
        label: c.capability,
      })),
    [capabilitiesList],
  );

  function load() {
    setLoading(true);
    getColleagues()
      .then((r) => setColleagues(r.colleagues))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function loadCapabilities() {
    getCapabilitiesAvailable().then((r) =>
      setCapabilitiesList(r.capabilities ?? []),
    );
  }

  function startAdd() {
    loadCapabilities();
    setEditing("new");
    setForm({
      id: "",
      description: "",
      responsibilities: "",
      allowed_capabilities: [],
      autonomy: { default: "ask_first" },
      memory: { scope: "role" },
      reporting: { on: ["task_complete", "uncertainty"] },
    });
  }

  function startEdit(p: ColleagueConfig) {
    loadCapabilities();
    setEditing(p.id);
    setForm({ ...p });
  }

  async function save() {
    if (!form.id?.trim()) {
      setError("ID is required");
      return;
    }
    setError(null);
    try {
      if (editing === "new") {
        await createColleague(form as ColleagueConfig);
      } else if (editing) {
        await updateColleague(editing, form);
      }
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    const ok = await dialog.confirm({
      title: "Remove colleague",
      message: "Remove this colleague?",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteColleague(id);
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading && colleagues.length === 0) {
    return (
      <div className="p-4 md:p-6 text-hooman-muted">Loading colleagues…</div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white">
            Colleagues
          </h2>
          <p className="text-xs md:text-sm text-hooman-muted truncate">
            Specialized roles that handle different kinds of tasks for you.
          </p>
        </div>
        <Button
          onClick={startAdd}
          className="self-start sm:self-auto"
          icon={<Plus className="w-4 h-4" />}
        >
          Add colleague
        </Button>
      </header>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New colleague" : "Edit colleague"}
      >
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <Input
            placeholder="ID (e.g. communication_colleague)"
            value={form.id ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            disabled={editing !== "new"}
          />
          <Input
            placeholder="Description"
            value={form.description ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
          <Textarea
            placeholder="Responsibilities (e.g. draft messages, reply to emails)"
            value={
              typeof form.responsibilities === "string"
                ? form.responsibilities
                : Array.isArray(form.responsibilities)
                  ? form.responsibilities.join("\n")
                  : ""
            }
            onChange={(e) =>
              setForm((f) => ({ ...f, responsibilities: e.target.value }))
            }
            rows={3}
          />
          <MultiSelect
            label="Allowed capabilities"
            value={
              Array.isArray(form.allowed_capabilities)
                ? form.allowed_capabilities
                : []
            }
            options={capabilityOptions}
            onChange={(selected) =>
              setForm((f) => ({ ...f, allowed_capabilities: selected }))
            }
            placeholder="Pick capabilities for this colleague"
          />
          <Select<"ask_first" | "autonomous" | "report_only">
            label="Autonomy"
            value={form.autonomy?.default ?? "ask_first"}
            options={[
              {
                value: "ask_first",
                label: "Ask first — require approval before acting",
              },
              {
                value: "autonomous",
                label: "Autonomous — act without asking",
              },
              {
                value: "report_only",
                label: "Report only — observe and report, no actions",
              },
            ]}
            onChange={(defaultValue) =>
              setForm((f) => ({ ...f, autonomy: { default: defaultValue } }))
            }
          />
          <div className="flex gap-2 pt-2">
            <Button variant="success" onClick={save}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        {error && !editing && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        <ul className="space-y-3">
          {colleagues.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-hooman-border bg-hooman-surface p-4 flex items-start justify-between"
            >
              <div>
                <p className="font-medium text-white">{p.id}</p>
                <p className="text-sm text-hooman-muted mt-0.5">
                  {p.description || "—"}
                </p>
                <p className="text-xs text-zinc-500 mt-2">
                  Autonomy: {p.autonomy?.default ?? "ask_first"} · Memory:{" "}
                  {p.memory?.scope ?? "role"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(p)}
                  className="text-hooman-accent hover:text-hooman-accent"
                >
                  Edit
                </Button>
                <Button variant="danger" size="sm" onClick={() => remove(p.id)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {colleagues.length === 0 && !editing && (
          <p className="text-hooman-muted text-sm">
            No colleagues yet. Add one to delegate specific tasks.
          </p>
        )}
      </div>
    </div>
  );
}
