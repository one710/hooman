import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useDialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { Checkbox } from "./Checkbox";
import { Select } from "./Select";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types";
import {
  getMCPConnections,
  createMCPConnection,
  updateMCPConnection,
  deleteMCPConnection,
} from "../api";

const CONNECTION_TYPE_OPTIONS: {
  value: MCPConnection["type"];
  label: string;
}[] = [
  { value: "hosted", label: "Hosted MCP (basic or streaming)" },
  { value: "streamable_http", label: "Streamable HTTP" },
  { value: "stdio", label: "Stdio (local process)" },
];

function connectionLabel(c: MCPConnection): string {
  if (c.type === "hosted") return c.server_label || c.id;
  if (c.type === "streamable_http") return c.name || c.id;
  return c.name || c.id;
}

function connectionTypeBadge(c: MCPConnection): string {
  if (c.type === "hosted") return "Hosted";
  if (c.type === "streamable_http") return "HTTP";
  return "Stdio";
}

export function Capabilities() {
  const dialog = useDialog();
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<MCPConnection>>({});
  const [argsRaw, setArgsRaw] = useState("");
  const [envEntries, setEnvEntries] = useState<
    { key: string; value: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getMCPConnections()
      .then((r) => setConnections(r.connections ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function startAdd() {
    setEditing("new");
    setArgsRaw("");
    setEnvEntries([]);
    setForm({
      type: "hosted",
      server_label: "",
      require_approval: "never",
      streaming: false,
    });
  }

  function startEdit(c: MCPConnection) {
    setEditing(c.id);
    setForm({ ...c });
    if (c.type === "stdio") {
      setArgsRaw(Array.isArray(c.args) ? c.args.join(", ") : "");
      setEnvEntries(
        c.env && typeof c.env === "object"
          ? Object.entries(c.env).map(([key, value]) => ({ key, value }))
          : [],
      );
    } else {
      setEnvEntries([]);
    }
  }

  async function save() {
    if (!form.type) {
      setError("Select a connection type.");
      return;
    }
    setError(null);
    try {
      const base = {
        id: form.id || crypto.randomUUID(),
        type: form.type,
      };
      if (form.type === "hosted") {
        if (!form.server_url?.trim()) {
          setError("Server URL is required for hosted MCP.");
          return;
        }
        const conn: MCPConnectionHosted = {
          ...base,
          type: "hosted",
          server_label: form.server_label ?? "",
          server_url: form.server_url.trim(),
          require_approval: form.require_approval ?? "never",
          streaming: form.streaming ?? false,
        };
        if (editing === "new") await createMCPConnection(conn);
        else await updateMCPConnection(conn.id, conn);
      } else if (form.type === "streamable_http") {
        const conn: MCPConnectionStreamableHttp = {
          ...base,
          type: "streamable_http",
          name: form.name ?? "",
          url: form.url ?? "",
          headers: form.headers,
          timeout_seconds: form.timeout_seconds,
          cache_tools_list: form.cache_tools_list ?? true,
          max_retry_attempts: form.max_retry_attempts,
        };
        if (editing === "new") await createMCPConnection(conn);
        else await updateMCPConnection(conn.id, conn);
      } else if (form.type === "stdio") {
        const env =
          envEntries.length > 0
            ? envEntries
                .filter((e) => e.key.trim() !== "")
                .reduce(
                  (acc, e) => ({ ...acc, [e.key.trim()]: e.value }),
                  {} as Record<string, string>,
                )
            : undefined;
        const conn: MCPConnectionStdio = {
          ...base,
          type: "stdio",
          name: form.name ?? "",
          command: form.command ?? "",
          args: argsRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(Object.keys(env ?? {}).length > 0 ? { env } : {}),
          ...(form.cwd?.trim() ? { cwd: form.cwd.trim() } : {}),
        };
        if (editing === "new") await createMCPConnection(conn);
        else await updateMCPConnection(conn.id, conn);
      }
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    const ok = await dialog.confirm({
      title: "Remove MCP connection",
      message: "Remove this MCP connection?",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteMCPConnection(id);
      setEditing(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading && connections.length === 0) {
    return (
      <div className="p-4 md:p-6 text-hooman-muted">Loading capabilities…</div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white">
            Capabilities
          </h2>
          <p className="text-xs md:text-sm text-hooman-muted truncate">
            Connect tools and services so Hooman can act on your behalf.
          </p>
        </div>
        <Button
          onClick={startAdd}
          className="self-start sm:self-auto"
          icon={<Plus className="w-4 h-4" />}
        >
          Add connection
        </Button>
      </header>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New connection" : "Edit connection"}
        maxWidth="2xl"
      >
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <Select<MCPConnection["type"]>
            label="Type"
            value={form.type ?? "hosted"}
            options={CONNECTION_TYPE_OPTIONS}
            onChange={(type) => {
              if (type === "stdio") {
                setArgsRaw("");
                setEnvEntries([]);
              }
              setForm((f) => ({
                ...f,
                type,
                ...(type === "hosted"
                  ? {
                      server_label: "",
                      require_approval: "never" as const,
                      streaming: false,
                    }
                  : type === "streamable_http"
                    ? { name: "", url: "", cache_tools_list: true }
                    : {
                        name: "",
                        command: "",
                        args: [],
                        env: undefined,
                        cwd: undefined,
                      }),
              }));
            }}
          />

          {form.type === "hosted" && (
            <>
              <Input
                label="Server label"
                placeholder="e.g. gitmcp"
                value={form.server_label ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, server_label: e.target.value }))
                }
              />
              <Input
                label="Server URL"
                placeholder="https://gitmcp.io/openai/codex"
                value={form.server_url ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, server_url: e.target.value }))
                }
              />
              <Select<"always" | "never">
                label="Require approval"
                value={
                  typeof form.require_approval === "string"
                    ? form.require_approval
                    : "never"
                }
                options={[
                  { value: "never", label: "Never" },
                  { value: "always", label: "Always" },
                ]}
                onChange={(require_approval) =>
                  setForm((f) => ({ ...f, require_approval }))
                }
              />
              <Checkbox
                id="hosted-streaming"
                label="Streaming (stream hosted MCP results)"
                checked={form.streaming ?? false}
                onChange={(checked) =>
                  setForm((f) => ({ ...f, streaming: checked }))
                }
              />
            </>
          )}

          {form.type === "streamable_http" && (
            <>
              <Input
                label="Name"
                placeholder="e.g. Streamable HTTP Server"
                value={form.name ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
              <Input
                label="URL"
                placeholder="http://localhost:8000/mcp"
                value={form.url ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, url: e.target.value }))
                }
              />
              <Input
                label="Timeout (seconds)"
                placeholder="10"
                type="number"
                value={form.timeout_seconds ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    timeout_seconds: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  }))
                }
              />
              <Checkbox
                id="http-cache-tools"
                label="Cache tools list"
                checked={form.cache_tools_list ?? true}
                onChange={(checked) =>
                  setForm((f) => ({ ...f, cache_tools_list: checked }))
                }
              />
              <Input
                label="Max retry attempts"
                placeholder="3"
                type="number"
                value={form.max_retry_attempts ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    max_retry_attempts: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  }))
                }
              />
            </>
          )}

          {form.type === "stdio" && (
            <>
              <Input
                label="Name"
                placeholder="e.g. Filesystem Server"
                value={form.name ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
              <Input
                label="Command"
                placeholder="yarn"
                value={form.command ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, command: e.target.value }))
                }
              />
              <Input
                label="Args (comma-separated)"
                placeholder="-y, @modelcontextprotocol/server-filesystem, /path"
                value={argsRaw}
                onChange={(e) => setArgsRaw(e.target.value)}
              />
              <Input
                label="Working directory (optional)"
                placeholder="/path/to/cwd"
                value={form.cwd ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cwd: e.target.value }))
                }
              />
              <div>
                <div className="block text-xs text-hooman-muted uppercase tracking-wide mb-1">
                  Environment variables (optional)
                </div>
                <div className="space-y-2">
                  {envEntries.map((entry, i) => (
                    <div key={i} className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Key"
                        value={entry.key}
                        onChange={(e) =>
                          setEnvEntries((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, key: e.target.value } : p,
                            ),
                          )
                        }
                        className="flex-1 min-w-[100px]"
                      />
                      <Input
                        placeholder="Value"
                        value={entry.value}
                        onChange={(e) =>
                          setEnvEntries((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, value: e.target.value } : p,
                            ),
                          )
                        }
                        className="flex-1 min-w-[100px]"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon={<Trash2 />}
                        aria-label="Remove variable"
                        onClick={() =>
                          setEnvEntries((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        className="text-red-400 hover:text-red-300"
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Plus />}
                    onClick={() =>
                      setEnvEntries((prev) => [...prev, { key: "", value: "" }])
                    }
                  >
                    Add variable
                  </Button>
                </div>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex gap-2">
              <Button variant="success" onClick={save}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
            <a
              href="https://smithery.ai/servers"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-hooman-border bg-hooman-surface px-3 py-2 text-sm text-[#FF5601] hover:bg-[#FF5601]/10 hover:text-[#FF5601] focus:outline-none focus:ring-2 focus:ring-[#FF5601]/50 focus:ring-offset-2 focus:ring-offset-hooman-bg"
            >
              <img
                src="/smithery-logo.svg"
                alt=""
                className="h-4 w-auto"
                width={34}
                height={40}
              />
              Find on Smithery
            </a>
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
          {connections.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-hooman-border bg-hooman-surface p-4 flex items-start justify-between"
            >
              <div className="min-w-0">
                <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-hooman-accent/20 text-hooman-accent mr-2">
                  {connectionTypeBadge(c)}
                </span>
                <span className="font-medium text-white">
                  {connectionLabel(c)}
                </span>
                {c.type === "hosted" && c.server_url && (
                  <p className="text-xs text-hooman-muted truncate mt-0.5">
                    {c.server_url}
                  </p>
                )}
                {c.type === "streamable_http" && c.url && (
                  <p className="text-xs text-hooman-muted truncate mt-0.5">
                    {c.url}
                  </p>
                )}
                {c.type === "stdio" && (
                  <p className="text-xs text-hooman-muted truncate mt-0.5">
                    {c.command} {c.args?.join(" ")}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(c)}
                  className="text-hooman-accent"
                >
                  Edit
                </Button>
                <Button variant="danger" size="sm" onClick={() => remove(c.id)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {connections.length === 0 && !editing && (
          <p className="text-hooman-muted text-sm">
            No MCP connections yet. Add one to delegate tools.
          </p>
        )}
      </div>
    </div>
  );
}
