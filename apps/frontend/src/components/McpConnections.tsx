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
  getOAuthCallbackUrl,
  startMCPOAuth,
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

export function McpConnections() {
  const dialog = useDialog();
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<MCPConnection>>({});
  const [argsRaw, setArgsRaw] = useState("");
  const [envEntries, setEnvEntries] = useState<
    { key: string; value: string }[]
  >([]);
  const [bearerToken, setBearerToken] = useState("");
  const [headerEntries, setHeaderEntries] = useState<
    { key: string; value: string }[]
  >([]);
  const [oauthCallbackUrl, setOAuthCallbackUrl] = useState("");
  const [oauthEnabled, setOAuthEnabled] = useState(false);
  const [oauthRedirectUri, setOAuthRedirectUri] = useState("");
  const [oauthClientId, setOAuthClientId] = useState("");
  const [oauthClientSecret, setOAuthClientSecret] = useState("");
  const [oauthScope, setOAuthScope] = useState("");
  const [oauthAuthServerUrl, setOAuthAuthServerUrl] = useState("");
  const [oauthStartingId, setOAuthStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildHeaders(): Record<string, string> | undefined {
    const custom = headerEntries
      .filter((e) => e.key.trim() !== "")
      .reduce(
        (acc, e) => ({ ...acc, [e.key.trim()]: e.value }),
        {} as Record<string, string>,
      );
    const withAuth =
      bearerToken && bearerToken !== "***"
        ? { ...custom, Authorization: `Bearer ${bearerToken}` }
        : custom;
    if (Object.keys(withAuth).length === 0) return undefined;
    return withAuth;
  }

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

  useEffect(() => {
    if (
      editing !== null &&
      (form.type === "hosted" || form.type === "streamable_http") &&
      !oauthCallbackUrl
    ) {
      getOAuthCallbackUrl()
        .then((r) => setOAuthCallbackUrl(r.callbackUrl))
        .catch(() => {});
    }
  }, [editing, form.type, oauthCallbackUrl]);

  function startAdd() {
    setEditing("new");
    setArgsRaw("");
    setEnvEntries([]);
    setBearerToken("");
    setHeaderEntries([]);
    setOAuthEnabled(false);
    setOAuthRedirectUri("");
    setOAuthClientId("");
    setOAuthClientSecret("");
    setOAuthScope("");
    setOAuthAuthServerUrl("");
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
      setBearerToken("");
      setHeaderEntries([]);
    } else if (c.type === "streamable_http" || c.type === "hosted") {
      const headers = c.headers ?? {};
      const auth = headers.Authorization ?? "";
      setBearerToken(auth.replace(/^Bearer\s+/i, "") || "");
      const rest = Object.entries(headers)
        .filter(([k]) => k !== "Authorization")
        .map(([key, value]) => ({ key, value }));
      setHeaderEntries(rest);
      const o = (c as MCPConnectionHosted | MCPConnectionStreamableHttp).oauth;
      setOAuthEnabled(!!o);
      setOAuthRedirectUri(o?.redirect_uri ?? "");
      setOAuthClientId(o?.client_id ?? "");
      setOAuthClientSecret(
        o?.client_secret === "***" ? "***" : (o?.client_secret ?? ""),
      );
      setOAuthScope(o?.scope ?? "");
      setOAuthAuthServerUrl(o?.authorization_server_url ?? "");
    } else {
      setEnvEntries([]);
      setBearerToken("");
      setHeaderEntries([]);
      setOAuthEnabled(false);
      setOAuthRedirectUri("");
      setOAuthClientId("");
      setOAuthClientSecret("");
      setOAuthScope("");
      setOAuthAuthServerUrl("");
    }
  }

  async function save() {
    if (!form.type) {
      setError("Select a connection type.");
      return;
    }
    setError(null);
    try {
      const base = { id: form.id || crypto.randomUUID(), type: form.type };
      if (
        (form.type === "hosted" || form.type === "streamable_http") &&
        oauthEnabled &&
        !oauthRedirectUri.trim() &&
        !oauthCallbackUrl
      ) {
        setError("Redirect URI is required for OAuth. Loading callback URL…");
        return;
      }
      if (form.type === "hosted") {
        if (!form.server_url?.trim()) {
          setError("Server URL is required for hosted MCP.");
          return;
        }
        let headers = buildHeaders();
        if (
          editing !== "new" &&
          bearerToken === "***" &&
          (form.headers?.Authorization ?? "").startsWith("Bearer ")
        ) {
          headers = { ...headers, Authorization: "Bearer ***" };
        }
        const conn: MCPConnectionHosted = {
          ...base,
          type: "hosted",
          server_label: form.server_label ?? "",
          server_url: form.server_url.trim(),
          require_approval: form.require_approval ?? "never",
          streaming: form.streaming ?? false,
          headers,
          ...(oauthEnabled && {
            oauth: {
              redirect_uri: oauthRedirectUri.trim() || oauthCallbackUrl,
              ...(oauthClientId.trim() && { client_id: oauthClientId.trim() }),
              ...(oauthClientSecret &&
                oauthClientSecret !== "***" && {
                  client_secret: oauthClientSecret,
                }),
              ...(editing !== "new" &&
                oauthClientSecret === "***" && { client_secret: "***" }),
              ...(oauthScope.trim() && { scope: oauthScope.trim() }),
              ...(oauthAuthServerUrl.trim() && {
                authorization_server_url: oauthAuthServerUrl.trim(),
              }),
            },
          }),
        };
        if (editing === "new") await createMCPConnection(conn);
        else await updateMCPConnection(conn.id, conn);
      } else if (form.type === "streamable_http") {
        let headers = buildHeaders();
        if (
          editing !== "new" &&
          bearerToken === "***" &&
          (form.headers?.Authorization ?? "").startsWith("Bearer ")
        ) {
          headers = { ...headers, Authorization: "Bearer ***" };
        }
        const conn: MCPConnectionStreamableHttp = {
          ...base,
          type: "streamable_http",
          name: form.name ?? "",
          url: form.url ?? "",
          headers,
          timeout_seconds: form.timeout_seconds,
          cache_tools_list: form.cache_tools_list ?? true,
          max_retry_attempts: form.max_retry_attempts,
          ...(oauthEnabled && {
            oauth: {
              redirect_uri: oauthRedirectUri.trim() || oauthCallbackUrl,
              ...(oauthClientId.trim() && { client_id: oauthClientId.trim() }),
              ...(oauthClientSecret &&
                oauthClientSecret !== "***" && {
                  client_secret: oauthClientSecret,
                }),
              ...(editing !== "new" &&
                oauthClientSecret === "***" && { client_secret: "***" }),
              ...(oauthScope.trim() && { scope: oauthScope.trim() }),
              ...(oauthAuthServerUrl.trim() && {
                authorization_server_url: oauthAuthServerUrl.trim(),
              }),
            },
          }),
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
    return <div className="text-hooman-muted">Loading MCP connections…</div>;
  }

  return (
    <>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New connection" : "Edit connection"}
        maxWidth="2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
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
        }
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
                setOAuthEnabled(false);
                setOAuthRedirectUri("");
                setOAuthClientId("");
                setOAuthClientSecret("");
                setOAuthScope("");
                setOAuthAuthServerUrl("");
              }
              setBearerToken("");
              setHeaderEntries([]);
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
              <Input
                label="Bearer token (optional)"
                placeholder="OAuth or API token for servers that require auth"
                type="password"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                autoComplete="off"
              />
              <div>
                <div className="block text-xs text-hooman-muted uppercase tracking-wide mb-1">
                  Custom headers (optional)
                </div>
                <div className="space-y-2">
                  {headerEntries.map((entry, i) => (
                    <div key={i} className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Key"
                        value={entry.key}
                        onChange={(e) =>
                          setHeaderEntries((prev) =>
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
                          setHeaderEntries((prev) =>
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
                        aria-label="Remove header"
                        onClick={() =>
                          setHeaderEntries((prev) =>
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
                      setHeaderEntries((prev) => [
                        ...prev,
                        { key: "", value: "" },
                      ])
                    }
                  >
                    Add header
                  </Button>
                </div>
              </div>
              <Checkbox
                id="hosted-oauth"
                label="Use OAuth (PKCE, optional DCR)"
                checked={oauthEnabled}
                onChange={(checked) => setOAuthEnabled(checked)}
              />
              {oauthEnabled && (
                <div className="space-y-2 rounded-lg border border-hooman-border p-3 bg-hooman-bg/50">
                  <Input
                    label="Authorization server URL (optional)"
                    placeholder="Override when discovery from MCP URL is not used"
                    value={oauthAuthServerUrl}
                    onChange={(e) => setOAuthAuthServerUrl(e.target.value)}
                  />
                  <Input
                    label="Client ID (optional; leave empty for DCR)"
                    placeholder="Pre-registered client or leave empty for dynamic registration"
                    value={oauthClientId}
                    onChange={(e) => setOAuthClientId(e.target.value)}
                  />
                  <Input
                    label="Client secret (optional)"
                    placeholder="For confidential clients"
                    type="password"
                    value={oauthClientSecret}
                    onChange={(e) => setOAuthClientSecret(e.target.value)}
                    autoComplete="off"
                  />
                  <Input
                    label="Redirect URI"
                    placeholder="Callback URL"
                    value={oauthRedirectUri || oauthCallbackUrl}
                    onChange={(e) => setOAuthRedirectUri(e.target.value)}
                  />
                  <Input
                    label="Scope (optional)"
                    placeholder="e.g. openid"
                    value={oauthScope}
                    onChange={(e) => setOAuthScope(e.target.value)}
                  />
                </div>
              )}
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
                label="Bearer token (optional)"
                placeholder="OAuth or API token for servers that require auth"
                type="password"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                autoComplete="off"
              />
              <div>
                <div className="block text-xs text-hooman-muted uppercase tracking-wide mb-1">
                  Custom headers (optional)
                </div>
                <div className="space-y-2">
                  {headerEntries.map((entry, i) => (
                    <div key={i} className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Key"
                        value={entry.key}
                        onChange={(e) =>
                          setHeaderEntries((prev) =>
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
                          setHeaderEntries((prev) =>
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
                        aria-label="Remove header"
                        onClick={() =>
                          setHeaderEntries((prev) =>
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
                      setHeaderEntries((prev) => [
                        ...prev,
                        { key: "", value: "" },
                      ])
                    }
                  >
                    Add header
                  </Button>
                </div>
              </div>
              <Checkbox
                id="http-oauth"
                label="Use OAuth (PKCE, optional DCR)"
                checked={oauthEnabled}
                onChange={(checked) => setOAuthEnabled(checked)}
              />
              {oauthEnabled && (
                <div className="space-y-2 rounded-lg border border-hooman-border p-3 bg-hooman-bg/50">
                  <Input
                    label="Authorization server URL (optional)"
                    placeholder="Override when discovery from MCP URL is not used"
                    value={oauthAuthServerUrl}
                    onChange={(e) => setOAuthAuthServerUrl(e.target.value)}
                  />
                  <Input
                    label="Client ID (optional; leave empty for DCR)"
                    placeholder="Pre-registered client or leave empty for dynamic registration"
                    value={oauthClientId}
                    onChange={(e) => setOAuthClientId(e.target.value)}
                  />
                  <Input
                    label="Client secret (optional)"
                    placeholder="For confidential clients"
                    type="password"
                    value={oauthClientSecret}
                    onChange={(e) => setOAuthClientSecret(e.target.value)}
                    autoComplete="off"
                  />
                  <Input
                    label="Redirect URI"
                    placeholder="Callback URL"
                    value={oauthRedirectUri || oauthCallbackUrl}
                    onChange={(e) => setOAuthRedirectUri(e.target.value)}
                  />
                  <Input
                    label="Scope (optional)"
                    placeholder="e.g. openid"
                    value={oauthScope}
                    onChange={(e) => setOAuthScope(e.target.value)}
                  />
                </div>
              )}
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
        </div>
      </Modal>
      <div className="flex justify-end mb-4">
        <Button onClick={startAdd} icon={<Plus className="w-4 h-4" />}>
          Add connection
        </Button>
      </div>
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
              {(c.type === "hosted" || c.type === "streamable_http") &&
                (c as MCPConnectionHosted | MCPConnectionStreamableHttp)
                  .oauth && (
                  <p className="text-xs mt-0.5">
                    <span
                      className={
                        (c as MCPConnectionHosted | MCPConnectionStreamableHttp)
                          .oauth_has_tokens
                          ? "text-green-400"
                          : "text-amber-400"
                      }
                    >
                      OAuth:{" "}
                      {(c as MCPConnectionHosted | MCPConnectionStreamableHttp)
                        .oauth_has_tokens
                        ? "connected"
                        : "needs authorization"}
                    </span>
                  </p>
                )}
            </div>
            <div className="flex gap-2 shrink-0 items-center">
              {(c.type === "hosted" || c.type === "streamable_http") &&
                (c as MCPConnectionHosted | MCPConnectionStreamableHttp)
                  .oauth && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      setOAuthStartingId(c.id);
                      try {
                        const result = await startMCPOAuth(c.id);
                        if ("authorizationUrl" in result) {
                          window.open(result.authorizationUrl, "_blank");
                          setTimeout(() => load(), 3000);
                        } else {
                          load();
                        }
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setOAuthStartingId(null);
                      }
                    }}
                    disabled={oauthStartingId !== null}
                  >
                    {oauthStartingId === c.id ? "Opening…" : "Connect"}
                  </Button>
                )}
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
    </>
  );
}
