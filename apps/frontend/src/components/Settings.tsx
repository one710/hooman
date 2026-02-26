import { useState, useEffect, useRef } from "react";
import {
  getConfig,
  saveConfig,
  type AppConfig,
  type LLMProviderId,
  type TranscriptionProviderId,
} from "../api";

import { Button } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";
import { PageHeader } from "./PageHeader";

export type { AppConfig };

const LLM_PROVIDER_OPTIONS: { value: LLMProviderId; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "amazon-bedrock", label: "Amazon Bedrock" },
  { value: "google", label: "Google Generative AI" },
  { value: "google-vertex", label: "Google Vertex" },
  { value: "mistral", label: "Mistral" },
  { value: "deepseek", label: "DeepSeek" },
];

const TRANSCRIPTION_PROVIDER_OPTIONS: {
  value: TranscriptionProviderId;
  label: string;
}[] = [
  { value: "openai", label: "OpenAI" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "deepgram", label: "Deepgram" },
];

export function Settings() {
  const [form, setForm] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) =>
        setForm({
          ...c,
        }),
      )
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
        LLM_PROVIDER: form.LLM_PROVIDER ?? "openai",
        TRANSCRIPTION_PROVIDER: form.TRANSCRIPTION_PROVIDER ?? "openai",
        OPENAI_API_KEY: form.OPENAI_API_KEY,
        CHAT_MODEL: form.CHAT_MODEL,

        TRANSCRIPTION_MODEL: form.TRANSCRIPTION_MODEL,
        AGENT_NAME: form.AGENT_NAME,
        AGENT_INSTRUCTIONS: form.AGENT_INSTRUCTIONS,
        AZURE_CHAT_RESOURCE_NAME: form.AZURE_CHAT_RESOURCE_NAME,
        AZURE_TRANSCRIPTION_RESOURCE_NAME:
          form.AZURE_TRANSCRIPTION_RESOURCE_NAME,
        AZURE_API_KEY: form.AZURE_API_KEY,
        AZURE_API_VERSION: form.AZURE_API_VERSION,
        DEEPGRAM_API_KEY: form.DEEPGRAM_API_KEY,
        ANTHROPIC_API_KEY: form.ANTHROPIC_API_KEY,
        AWS_REGION: form.AWS_REGION,
        AWS_ACCESS_KEY_ID: form.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: form.AWS_SECRET_ACCESS_KEY,
        AWS_SESSION_TOKEN: form.AWS_SESSION_TOKEN,
        GOOGLE_GENERATIVE_AI_API_KEY: form.GOOGLE_GENERATIVE_AI_API_KEY,
        GOOGLE_VERTEX_PROJECT: form.GOOGLE_VERTEX_PROJECT,
        GOOGLE_VERTEX_LOCATION: form.GOOGLE_VERTEX_LOCATION,
        GOOGLE_VERTEX_API_KEY: form.GOOGLE_VERTEX_API_KEY,
        MISTRAL_API_KEY: form.MISTRAL_API_KEY,
        DEEPSEEK_API_KEY: form.DEEPSEEK_API_KEY,
        COMPLETIONS_API_KEY: form.COMPLETIONS_API_KEY,
        MAX_INPUT_TOKENS: form.MAX_INPUT_TOKENS,
        CHAT_TIMEOUT_MS: form.CHAT_TIMEOUT_MS,
      });
      setForm({ ...updated });
      setMessage({
        type: "ok",
        text: "Settings saved. LLM, memory, and MCP use these values for new requests.",
      });
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
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
      <PageHeader
        title="Settings"
        subtitle="Your API keys and how Hooman thinks and remembers."
      />
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0"
      >
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
          <div className="pt-0">
            <h3 className="text-sm font-medium text-zinc-300 mb-2">Agent</h3>
            <p className="text-xs text-hooman-muted mb-3">
              Name and system instructions for the main agent.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Agent name
                </label>
                <Input
                  type="text"
                  value={form.AGENT_NAME ?? ""}
                  onChange={(e) =>
                    setForm((f) =>
                      f ? { ...f, AGENT_NAME: e.target.value } : f,
                    )
                  }
                  placeholder="Hooman"
                  className="bg-hooman-surface focus:ring-offset-hooman-surface"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  System instructions
                </label>
                <Textarea
                  value={form.AGENT_INSTRUCTIONS ?? ""}
                  onChange={(e) =>
                    setForm((f) =>
                      f ? { ...f, AGENT_INSTRUCTIONS: e.target.value } : f,
                    )
                  }
                  placeholder="Default agent instructions"
                  rows={14}
                  className="bg-hooman-surface focus:ring-offset-hooman-surface font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Max input tokens (context window)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={form.MAX_INPUT_TOKENS ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            MAX_INPUT_TOKENS:
                              v === ""
                                ? undefined
                                : Math.max(0, Number(v) || 0),
                          }
                        : f,
                    );
                  }}
                  placeholder="e.g. 200000"
                  className="bg-hooman-surface focus:ring-offset-hooman-surface"
                />
                <p className="text-xs text-hooman-muted mt-1">
                  e.g. 200000. 0 or empty = 100000 tokens default. Conversation
                  and memory are trimmed to stay under this.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Chat timeout (minutes)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={
                    form.CHAT_TIMEOUT_MS != null
                      ? String(Math.round(form.CHAT_TIMEOUT_MS / 60_000))
                      : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            CHAT_TIMEOUT_MS:
                              v === ""
                                ? undefined
                                : Math.max(0, Number(v) || 0) * 60_000,
                          }
                        : f,
                    );
                  }}
                  placeholder="e.g. 10 (default 5)"
                  className="bg-hooman-surface focus:ring-offset-hooman-surface"
                />
                <p className="text-xs text-hooman-muted mt-1">
                  Max time to wait for a chat reply before showing a timeout
                  message. 0 or empty = 5 minutes. Increase for long tool runs.
                </p>
              </div>
            </div>
          </div>
          <div className="pt-4 border-t border-hooman-border">
            <h3 className="text-sm font-medium text-zinc-300 mb-2">
              Providers
            </h3>
            <div className="space-y-4">
              <div>
                <Select<LLMProviderId>
                  label="LLM provider (chat, memory)"
                  value={form.LLM_PROVIDER ?? "openai"}
                  options={LLM_PROVIDER_OPTIONS}
                  onChange={(value) =>
                    setForm((f) => (f ? { ...f, LLM_PROVIDER: value } : f))
                  }
                />
                <p className="text-xs text-hooman-muted mt-1">Used for chat.</p>
              </div>
              <div>
                <Select<TranscriptionProviderId>
                  label="Transcription provider (voice / audio messages)"
                  value={form.TRANSCRIPTION_PROVIDER ?? "openai"}
                  options={TRANSCRIPTION_PROVIDER_OPTIONS}
                  onChange={(value) =>
                    setForm((f) =>
                      f ? { ...f, TRANSCRIPTION_PROVIDER: value } : f,
                    )
                  }
                />
                <p className="text-xs text-hooman-muted mt-1">
                  Used for Slack voice clips, WhatsApp voice notes, speak
                  button.
                </p>
              </div>
            </div>
            {((form.LLM_PROVIDER ?? "openai") === "openai" ||
              (form.TRANSCRIPTION_PROVIDER ?? "openai") === "openai") && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    OpenAI – API key
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
                    Used for chat when LLM is OpenAI, embeddings, and
                    transcription when Transcription provider is OpenAI. Leave
                    empty for no LLM; the agent will still chat with a fallback.
                  </p>
                </div>
                {(form.LLM_PROVIDER ?? "openai") === "openai" && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1">
                        OpenAI – Chat model
                      </label>
                      <Input
                        type="text"
                        value={form.CHAT_MODEL}
                        onChange={(e) =>
                          setForm((f) =>
                            f ? { ...f, CHAT_MODEL: e.target.value } : f,
                          )
                        }
                        placeholder="gpt-5.2, gpt-4o, etc."
                        className="bg-hooman-surface focus:ring-offset-hooman-surface"
                      />
                      <p className="text-xs text-hooman-muted mt-1">
                        Model ID for chat.
                      </p>
                    </div>
                  </>
                )}
                {(form.TRANSCRIPTION_PROVIDER ?? "openai") === "openai" && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      OpenAI – Transcription model
                    </label>
                    <Input
                      type="text"
                      value={form.TRANSCRIPTION_MODEL ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f
                            ? {
                                ...f,
                                TRANSCRIPTION_MODEL: e.target.value,
                              }
                            : f,
                        )
                      }
                      placeholder="gpt-4o-transcribe"
                      className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    />
                    <p className="text-xs text-hooman-muted mt-1">
                      e.g. gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1.
                    </p>
                  </div>
                )}
              </div>
            )}
            {((form.LLM_PROVIDER ?? "openai") === "azure" ||
              (form.TRANSCRIPTION_PROVIDER ?? "openai") === "azure") && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-hooman-muted">
                  Used for chat when LLM is Azure; for transcription when
                  Transcription provider is Azure.
                </p>
                {(form.LLM_PROVIDER ?? "openai") === "azure" && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      Azure – Resource name (chat)
                    </label>
                    <Input
                      type="text"
                      value={form.AZURE_CHAT_RESOURCE_NAME ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f
                            ? { ...f, AZURE_CHAT_RESOURCE_NAME: e.target.value }
                            : f,
                        )
                      }
                      placeholder="my-resource"
                      className="bg-hooman-surface focus:ring-offset-hooman-surface"
                      autoComplete="off"
                    />
                  </div>
                )}
                {(form.TRANSCRIPTION_PROVIDER ?? "openai") === "azure" && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      Azure – Resource name (transcription)
                    </label>
                    <Input
                      type="text"
                      value={form.AZURE_TRANSCRIPTION_RESOURCE_NAME ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f
                            ? {
                                ...f,
                                AZURE_TRANSCRIPTION_RESOURCE_NAME:
                                  e.target.value,
                              }
                            : f,
                        )
                      }
                      placeholder="my-resource"
                      className="bg-hooman-surface focus:ring-offset-hooman-surface"
                      autoComplete="off"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Azure – API key
                  </label>
                  <Input
                    type="password"
                    value={form.AZURE_API_KEY ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, AZURE_API_KEY: e.target.value } : f,
                      )
                    }
                    placeholder="..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Azure – API version (optional)
                  </label>
                  <Input
                    type="text"
                    value={form.AZURE_API_VERSION ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, AZURE_API_VERSION: e.target.value } : f,
                      )
                    }
                    placeholder="v1"
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                  />
                </div>
                {(form.LLM_PROVIDER ?? "openai") === "azure" && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      Azure – Chat model (deployment name)
                    </label>
                    <Input
                      type="text"
                      value={form.CHAT_MODEL}
                      onChange={(e) =>
                        setForm((f) =>
                          f ? { ...f, CHAT_MODEL: e.target.value } : f,
                        )
                      }
                      placeholder="Deployment name"
                      className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    />
                    <p className="text-xs text-hooman-muted mt-1">
                      Used for chat.
                    </p>
                  </div>
                )}
                {(form.TRANSCRIPTION_PROVIDER ?? "openai") === "azure" && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      Azure – Deployment name
                    </label>
                    <Input
                      type="text"
                      value={form.TRANSCRIPTION_MODEL ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f
                            ? {
                                ...f,
                                TRANSCRIPTION_MODEL: e.target.value,
                              }
                            : f,
                        )
                      }
                      placeholder="whisper-1"
                      className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    />
                    <p className="text-xs text-hooman-muted mt-1">
                      Deployment name for transcription (e.g. whisper-1,
                      gpt-4o-transcribe).
                    </p>
                  </div>
                )}
              </div>
            )}
            {(form.LLM_PROVIDER ?? "openai") === "anthropic" && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Anthropic – API key
                  </label>
                  <Input
                    type="password"
                    value={form.ANTHROPIC_API_KEY ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, ANTHROPIC_API_KEY: e.target.value } : f,
                      )
                    }
                    placeholder="sk-ant-..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Anthropic – Chat model
                  </label>
                  <Input
                    type="text"
                    value={form.CHAT_MODEL}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, CHAT_MODEL: e.target.value } : f,
                      )
                    }
                    placeholder="claude-3-5-sonnet-20241022, claude-3-opus, etc."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                  />
                  <p className="text-xs text-hooman-muted mt-1">
                    Model ID for chat.
                  </p>
                </div>
              </div>
            )}
            {(form.LLM_PROVIDER ?? "openai") === "amazon-bedrock" && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Amazon Bedrock – Region
                  </label>
                  <Input
                    type="text"
                    value={form.AWS_REGION ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, AWS_REGION: e.target.value } : f,
                      )
                    }
                    placeholder="us-east-1"
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Amazon Bedrock – Access key ID
                  </label>
                  <Input
                    type="text"
                    value={form.AWS_ACCESS_KEY_ID ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, AWS_ACCESS_KEY_ID: e.target.value } : f,
                      )
                    }
                    placeholder="..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Amazon Bedrock – Secret access key
                  </label>
                  <Input
                    type="password"
                    value={form.AWS_SECRET_ACCESS_KEY ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, AWS_SECRET_ACCESS_KEY: e.target.value } : f,
                      )
                    }
                    placeholder="..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Amazon Bedrock – Session token (optional)
                  </label>
                  <Input
                    type="password"
                    value={form.AWS_SESSION_TOKEN ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, AWS_SESSION_TOKEN: e.target.value } : f,
                      )
                    }
                    placeholder="..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Amazon Bedrock – Chat model
                  </label>
                  <Input
                    type="text"
                    value={form.CHAT_MODEL}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, CHAT_MODEL: e.target.value } : f,
                      )
                    }
                    placeholder="anthropic.claude-3-5-sonnet-v2, etc."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                  />
                  <p className="text-xs text-hooman-muted mt-1">
                    Model ID for chat.
                  </p>
                </div>
              </div>
            )}
            {(form.LLM_PROVIDER ?? "openai") === "google" && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Google – API key
                  </label>
                  <Input
                    type="password"
                    value={form.GOOGLE_GENERATIVE_AI_API_KEY ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f
                          ? {
                              ...f,
                              GOOGLE_GENERATIVE_AI_API_KEY: e.target.value,
                            }
                          : f,
                      )
                    }
                    placeholder="..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Google – Chat model
                  </label>
                  <Input
                    type="text"
                    value={form.CHAT_MODEL}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, CHAT_MODEL: e.target.value } : f,
                      )
                    }
                    placeholder="gemini-2.0-flash, gemini-1.5-pro, etc."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                  />
                  <p className="text-xs text-hooman-muted mt-1">
                    Model ID for chat.
                  </p>
                </div>
              </div>
            )}
            {(form.LLM_PROVIDER ?? "openai") === "google-vertex" && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Google Vertex – Project
                  </label>
                  <Input
                    type="text"
                    value={form.GOOGLE_VERTEX_PROJECT ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, GOOGLE_VERTEX_PROJECT: e.target.value } : f,
                      )
                    }
                    placeholder="my-project"
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Google Vertex – Location
                  </label>
                  <Input
                    type="text"
                    value={form.GOOGLE_VERTEX_LOCATION ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f
                          ? { ...f, GOOGLE_VERTEX_LOCATION: e.target.value }
                          : f,
                      )
                    }
                    placeholder="us-central1"
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Google Vertex – API key (optional, for express mode)
                  </label>
                  <Input
                    type="password"
                    value={form.GOOGLE_VERTEX_API_KEY ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, GOOGLE_VERTEX_API_KEY: e.target.value } : f,
                      )
                    }
                    placeholder="..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                  <p className="text-xs text-hooman-muted mt-1">
                    Or set GOOGLE_APPLICATION_CREDENTIALS for service account.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Google Vertex – Chat model
                  </label>
                  <Input
                    type="text"
                    value={form.CHAT_MODEL}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, CHAT_MODEL: e.target.value } : f,
                      )
                    }
                    placeholder="gemini-2.0-flash, gemini-1.5-pro, etc."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                  />
                  <p className="text-xs text-hooman-muted mt-1">
                    Model ID for chat.
                  </p>
                </div>
              </div>
            )}
            {(form.LLM_PROVIDER ?? "openai") === "mistral" && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Mistral – API key
                  </label>
                  <Input
                    type="password"
                    value={form.MISTRAL_API_KEY ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, MISTRAL_API_KEY: e.target.value } : f,
                      )
                    }
                    placeholder="..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Mistral – Chat model
                  </label>
                  <Input
                    type="text"
                    value={form.CHAT_MODEL}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, CHAT_MODEL: e.target.value } : f,
                      )
                    }
                    placeholder="mistral-large-latest, mistral-small, etc."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                  />
                  <p className="text-xs text-hooman-muted mt-1">
                    Model ID for chat.
                  </p>
                </div>
              </div>
            )}
            {(form.LLM_PROVIDER ?? "openai") === "deepseek" && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    DeepSeek – API key
                  </label>
                  <Input
                    type="password"
                    value={form.DEEPSEEK_API_KEY ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, DEEPSEEK_API_KEY: e.target.value } : f,
                      )
                    }
                    placeholder="..."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    DeepSeek – Chat model
                  </label>
                  <Input
                    type="text"
                    value={form.CHAT_MODEL}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, CHAT_MODEL: e.target.value } : f,
                      )
                    }
                    placeholder="deepseek-chat, deepseek-reasoner, etc."
                    className="bg-hooman-surface focus:ring-offset-hooman-surface"
                  />
                  <p className="text-xs text-hooman-muted mt-1">
                    Model ID for chat.
                  </p>
                </div>
              </div>
            )}
            {(form.TRANSCRIPTION_PROVIDER ?? "openai") === "deepgram" && (
              <div className="mt-3 pt-4 border-t border-hooman-border">
                <h3 className="text-sm font-medium text-zinc-300 mb-2">
                  Deepgram
                </h3>
                <p className="text-xs text-hooman-muted mb-3">
                  Used for transcription when Transcription provider is
                  Deepgram.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      Deepgram – API key
                    </label>
                    <Input
                      type="password"
                      value={form.DEEPGRAM_API_KEY ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f ? { ...f, DEEPGRAM_API_KEY: e.target.value } : f,
                        )
                      }
                      placeholder="Your Deepgram API key"
                      className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      Deepgram – Model
                    </label>
                    <Input
                      type="text"
                      value={form.TRANSCRIPTION_MODEL ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f
                            ? {
                                ...f,
                                TRANSCRIPTION_MODEL: e.target.value,
                              }
                            : f,
                        )
                      }
                      placeholder="nova-2"
                      className="bg-hooman-surface focus:ring-offset-hooman-surface"
                    />
                    <p className="text-xs text-hooman-muted mt-1">
                      e.g. nova-3, nova-2, nova, enhanced, base.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-hooman-border">
            <h3 className="text-sm font-medium text-zinc-300 mb-2">
              Completions API
            </h3>
            <p className="text-xs text-hooman-muted mb-3">
              Bearer token for the OpenAI-compatible /v1/chat/completions
              endpoint. External platforms (e.g. ElevenLabs) use this to access
              Hooman&apos;s agent capabilities.
            </p>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Completions API key
              </label>
              <Input
                type="password"
                value={form.COMPLETIONS_API_KEY ?? ""}
                onChange={(e) =>
                  setForm((f) =>
                    f ? { ...f, COMPLETIONS_API_KEY: e.target.value } : f,
                  )
                }
                placeholder="..."
                className="bg-hooman-surface focus:ring-offset-hooman-surface"
                autoComplete="off"
              />
            </div>
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </div>
    </div>
  );
}
