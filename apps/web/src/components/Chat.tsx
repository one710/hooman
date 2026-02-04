import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Trash2, ListOrdered, X } from "lucide-react";
import type { ChatMessage } from "../types";
import { sendMessage } from "../api";
import { useDialog } from "./Dialog";
import { Button } from "./Button";

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  hasMoreOlder?: boolean;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  onClearChat?: () => Promise<void>;
}

export function Chat({
  messages,
  setMessages,
  hasMoreOlder,
  onLoadOlder,
  loadingOlder,
  onClearChat,
}: ChatProps) {
  const dialog = useDialog();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendOne = useCallback(
    async (text: string) => {
      setLoading(true);
      try {
        const { message } = await sendMessage(text);
        setMessages((prev) => [...prev, message]);
      } catch (err) {
        const msg = (err as Error).message;
        const hint =
          !msg ||
          msg === "Failed to fetch" ||
          msg.startsWith("500") ||
          msg.startsWith("502") ||
          msg.startsWith("503")
            ? " Start the API with: npm run dev"
            : "";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Error: ${msg || "Could not reach the API."}${hint}`,
          },
        ]);
      } finally {
        setLoading(false);
        if (queueRef.current.length > 0) {
          const next = queueRef.current.shift()!;
          setQueue((q) => q.slice(1));
          setMessages((prev) => [...prev, { role: "user", text: next }]);
          sendOne(next);
        }
      }
    },
    [setMessages],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (loading) {
      setQueue((prev) => [...prev, text]);
      queueRef.current = [...queueRef.current, text];
      return;
    }
    setMessages((prev) => [...prev, { role: "user", text }]);
    sendOne(text);
  }

  function removeFromQueue(index: number) {
    setQueue((prev) => {
      const next = prev.filter((_, i) => i !== index);
      queueRef.current = next;
      return next;
    });
  }

  async function handleClearChat() {
    if (!onClearChat || clearing) return;
    const ok = await dialog.confirm({
      title: "Clear chat history",
      message: "Clear all chat history? This cannot be undone.",
      confirmLabel: "Clear",
      variant: "danger",
    });
    if (!ok) return;
    setClearing(true);
    try {
      await onClearChat();
    } catch (e) {
      console.error(e);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 flex justify-between items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white truncate">
            Chat with Hooman
          </h2>
          <p className="text-xs md:text-sm text-hooman-muted truncate">
            Talk to your autonomous digital self.
          </p>
        </div>
        {onClearChat && (
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 className="w-4 h-4" />}
            onClick={handleClearChat}
            disabled={clearing || messages.length === 0}
            className="shrink-0"
          >
            <span className="hidden sm:inline">
              {clearing ? "Clearing…" : "Clear chat"}
            </span>
          </Button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 min-h-0">
        {hasMoreOlder && onLoadOlder && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onLoadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? "Loading…" : "Load older messages"}
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="text-center text-hooman-muted py-12">
            <p className="text-lg">
              Say hello. Ask what I can do, or tell me what to remember.
            </p>
            <p className="text-sm mt-2">
              I can converse, store memory, and draft content—no setup needed.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-3 md:px-4 py-2 md:py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-hooman-accent/30 text-white"
                  : "bg-hooman-surface border border-hooman-border text-zinc-200"
              }`}
            >
              <div className="chat-markdown prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-a:text-hooman-accent prose-a:no-underline hover:prose-a:underline prose-strong:text-inherit prose-code:bg-hooman-border/50 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.text}
                </ReactMarkdown>
              </div>
              {m.role === "assistant" &&
                m.lastAgentName &&
                m.lastAgentName !== "Hooman" && (
                  <p className="mt-1.5 text-xs text-hooman-muted border-t border-hooman-border/50 pt-1.5">
                    Responded by: {m.lastAgentName}
                  </p>
                )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-hooman-surface border border-hooman-border rounded-2xl px-4 py-2.5 text-hooman-muted text-sm">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={handleSubmit}
        className="p-3 md:p-4 border-t border-hooman-border shrink-0"
      >
        {queue.length > 0 && (
          <div className="mb-3 pb-3 border-b border-hooman-border/50">
            <p className="flex items-center gap-2 text-xs text-hooman-muted mb-2">
              <ListOrdered className="w-3.5 h-3.5" />
              {queue.length} queued
            </p>
            <ul className="space-y-1.5">
              {queue.map((text, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg bg-hooman-surface/80 border border-hooman-border px-3 py-2 text-sm text-zinc-300"
                >
                  <span className="flex-1 truncate">{text}</span>
                  <Button
                    variant="danger"
                    iconOnly
                    size="icon"
                    icon={<X className="w-4 h-4" />}
                    onClick={() => removeFromQueue(i)}
                    title="Remove from queue"
                    aria-label="Remove from queue"
                    className="shrink-0 p-1"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2 min-w-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 min-w-0 rounded-xl bg-hooman-surface border border-hooman-border px-3 md:px-4 py-2.5 md:py-3 text-sm md:text-base text-zinc-200 placeholder:text-hooman-muted focus:outline-none focus:ring-2 focus:ring-hooman-accent/50"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-xl bg-hooman-accent px-4 md:px-5 py-2.5 md:py-3 text-sm md:text-base text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
