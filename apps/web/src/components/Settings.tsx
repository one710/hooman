import { useState, useEffect } from "react";
import { Checkbox } from "./Checkbox";
import { Button } from "./Button";
import { Input } from "./Input";

export interface AppConfig {
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_EMBEDDING_MODEL: string;
  OPENAI_WEB_SEARCH: boolean;
  MCP_USE_SERVER_MANAGER: boolean;
}

async function getConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const res = await fetch("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function Settings() {
  const [form, setForm] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => setForm({ ...c }))
      .catch((e) => setMessage({ type: "err", text: (e as Error).message }))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await saveConfig({
        OPENAI_API_KEY: form.OPENAI_API_KEY,
        OPENAI_MODEL: form.OPENAI_MODEL,
        OPENAI_EMBEDDING_MODEL: form.OPENAI_EMBEDDING_MODEL,
        OPENAI_WEB_SEARCH: form.OPENAI_WEB_SEARCH,
        MCP_USE_SERVER_MANAGER: form.MCP_USE_SERVER_MANAGER,
      });
      setForm({ ...updated });
      setMessage({
        type: "ok",
        text: "Settings saved. LLM, memory, and MCP use these values for new requests.",
      });
    } catch (e) {
      setMessage({ type: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form) {
    return (
      <div className="p-4 md:p-6 text-hooman-muted">Loading settings…</div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 shrink-0">
        <h2 className="text-base md:text-lg font-semibold text-white">
          Settings
        </h2>
        <p className="text-xs md:text-sm text-hooman-muted">
          Your API keys and how Hooman thinks and remembers.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
          {message && (
            <div
              className={`rounded-lg px-4 py-2 text-sm ${
                message.type === "ok"
                  ? "bg-hooman-green/20 text-hooman-green border border-hooman-green/30"
                  : "bg-red-500/10 text-red-400 border border-red-500/30"
              }`}
            >
              {message.text}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              OPENAI_API_KEY
            </label>
            <Input
              type="password"
              value={form.OPENAI_API_KEY}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, OPENAI_API_KEY: e.target.value } : f,
                )
              }
              placeholder="sk-..."
              className="bg-hooman-surface focus:ring-offset-hooman-surface"
              autoComplete="off"
            />
            <p className="text-xs text-hooman-muted mt-1">
              Leave empty for no LLM; Hooman will still chat with a fallback.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              OPENAI_MODEL (chat &amp; memory LLM)
            </label>
            <Input
              type="text"
              value={form.OPENAI_MODEL}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, OPENAI_MODEL: e.target.value } : f))
              }
              placeholder="gpt-5.2"
              className="bg-hooman-surface focus:ring-offset-hooman-surface"
            />
            <p className="text-xs text-hooman-muted mt-1">
              Used for general chat and for Mem0 memory.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              OPENAI_EMBEDDING_MODEL
            </label>
            <Input
              type="text"
              value={form.OPENAI_EMBEDDING_MODEL}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, OPENAI_EMBEDDING_MODEL: e.target.value } : f,
                )
              }
              placeholder="text-embedding-3-small"
              className="bg-hooman-surface focus:ring-offset-hooman-surface"
            />
            <p className="text-xs text-hooman-muted mt-1">
              Used for Mem0 embeddings only (e.g. text-embedding-3-small,
              text-embedding-3-large).
            </p>
          </div>
          <Checkbox
            id="web-search"
            checked={form.OPENAI_WEB_SEARCH ?? false}
            onChange={(checked) =>
              setForm((f) => (f ? { ...f, OPENAI_WEB_SEARCH: checked } : f))
            }
            label="Enable web search"
          />
          <p className="text-xs text-hooman-muted -mt-2">
            When enabled, chat uses the Responses API with web search so the
            model can look up current information.
          </p>
          <div className="pt-4 border-t border-hooman-border">
            <h3 className="text-sm font-medium text-zinc-300 mb-2">
              MCP server manager
            </h3>
            <Checkbox
              id="use-mcp-server-manager"
              label="Use MCP server manager"
              checked={form.MCP_USE_SERVER_MANAGER ?? false}
              onChange={(checked) =>
                setForm((f) =>
                  f ? { ...f, MCP_USE_SERVER_MANAGER: checked } : f,
                )
              }
            />
            <p className="text-xs text-hooman-muted mt-1">
              When enabled, multiple MCP servers are connected via a manager
              (active_servers, drop_failed_servers, reconnect). When disabled,
              servers are connected individually.
            </p>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </div>
    </div>
  );
}
