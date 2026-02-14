import { useState, useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import { useDialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { MultiSelect } from "./MultiSelect";
import { Modal } from "./Modal";
import type { PersonaConfig } from "../types";
import {
  getPersonas,
  getCapabilitiesAvailable,
  getSkillsList,
  createPersona,
  updatePersona,
  deletePersona,
} from "../api";
import type { SkillEntry } from "../api";

export function Personas() {
  const dialog = useDialog();
  const [personas, setPersonas] = useState<PersonaConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<PersonaConfig>>({});
  const [error, setError] = useState<string | null>(null);
  const [capabilitiesList, setCapabilitiesList] = useState<
    { integrationId: string; capability: string }[]
  >([]);
  const [skillsList, setSkillsList] = useState<SkillEntry[]>([]);

  const capabilityOptions = useMemo(
    () =>
      capabilitiesList.map((c) => ({
        value: c.integrationId,
        label: c.capability,
      })),
    [capabilitiesList],
  );

  const skillOptions = useMemo(
    () =>
      skillsList.map((s) => ({
        value: s.id,
        label: s.name,
      })),
    [skillsList],
  );

  function load() {
    setLoading(true);
    getPersonas()
      .then((r) => setPersonas(r.personas))
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

  function loadSkills() {
    getSkillsList().then((r) => setSkillsList(r.skills ?? []));
  }

  function startAdd() {
    loadCapabilities();
    loadSkills();
    setEditing("new");
    setForm({
      id: "",
      description: "",
      responsibilities: "",
      allowed_connections: [],
      allowed_skills: [],
      memory: { scope: "role" },
      reporting: { on: ["task_complete", "uncertainty"] },
    });
  }

  function startEdit(p: PersonaConfig) {
    loadCapabilities();
    loadSkills();
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
        await createPersona(form as PersonaConfig);
      } else if (editing) {
        await updatePersona(editing, form);
      }
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    const ok = await dialog.confirm({
      title: "Remove persona",
      message: "Remove this persona?",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deletePersona(id);
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading && personas.length === 0) {
    return (
      <div className="p-4 md:p-6 text-hooman-muted">Loading personas…</div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white">
            Personas
          </h2>
          <p className="text-xs md:text-sm text-hooman-muted truncate">
            Organize MCP connections and skills; Hooman hands off to a persona
            when a task fits.
          </p>
        </div>
        <Button
          onClick={startAdd}
          className="self-start sm:self-auto"
          icon={<Plus className="w-4 h-4" />}
        >
          Add persona
        </Button>
      </header>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New persona" : "Edit persona"}
        footer={
          <div className="flex gap-2">
            <Button variant="success" onClick={save}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
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
        <div className="space-y-3">
          <Input
            placeholder="ID (e.g. Engineer)"
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
                  ? (form.responsibilities as string[]).join("\n")
                  : ""
            }
            onChange={(e) =>
              setForm((f) => ({ ...f, responsibilities: e.target.value }))
            }
            rows={3}
          />
          <MultiSelect
            label="Connections (MCP)"
            value={
              Array.isArray(form.allowed_connections)
                ? form.allowed_connections
                : []
            }
            options={capabilityOptions}
            onChange={(selected) =>
              setForm((f) => ({ ...f, allowed_connections: selected }))
            }
            placeholder="Pick MCP connections for this persona"
          />
          <MultiSelect
            label="Skills"
            value={
              Array.isArray(form.allowed_skills) ? form.allowed_skills : []
            }
            options={skillOptions}
            onChange={(selected) =>
              setForm((f) => ({ ...f, allowed_skills: selected }))
            }
            placeholder="Pick installed skills for this persona"
          />
        </div>
      </Modal>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        {error && !editing && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        <ul className="space-y-3">
          {personas.map((p) => (
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
                  Memory: {p.memory?.scope ?? "role"}
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
        {personas.length === 0 && !editing && (
          <p className="text-hooman-muted text-sm">
            No personas yet. Add one to organize capabilities and hand off
            tasks.
          </p>
        )}
      </div>
    </div>
  );
}
