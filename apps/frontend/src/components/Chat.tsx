import { useState, useRef, useEffect, useCallback } from "react";
import createDebug from "debug";
import { Trash2, Loader2, MessageCircle, Zap } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../types";
import {
  sendMessage,
  getChatHistory,
  clearChatHistory,
  type ChatAttachmentMeta,
} from "../api";
import { waitForChatResult, ChatSkippedError } from "../socket";
import { useDialog } from "./Dialog";
import { Button } from "./Button";
import { ChatMessage } from "./ChatMessage";
import { ChatInput, type QueuedMessage } from "./ChatInput";
import { PageHeader } from "./PageHeader";

const debug = createDebug("hooman:Chat");
const CHAT_PAGE_SIZE = 50;

export function Chat() {
  const dialog = useDialog();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [chatTotal, setChatTotal] = useState(0);
  const [chatPage, setChatPage] = useState(1);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getChatHistory({ page: 1, pageSize: CHAT_PAGE_SIZE }).then((r) => {
      setMessages(r.messages ?? []);
      setChatTotal(r.total ?? 0);
      setChatPage(1);
    });
  }, []);

  const loadOlderChat = useCallback(() => {
    if (loadingOlder || chatTotal <= messages.length) return;
    setLoadingOlder(true);
    getChatHistory({ page: chatPage + 1, pageSize: CHAT_PAGE_SIZE })
      .then((r) => {
        setMessages((prev) => [...(r.messages ?? []), ...prev]);
        setChatTotal(r.total ?? 0);
        setChatPage((p) => p + 1);
      })
      .finally(() => setLoadingOlder(false));
  }, [chatPage, chatTotal, messages.length, loadingOlder]);

  const sendOne = useCallback(
    async (text: string, attachmentIds?: string[]) => {
      setLoading(true);
      try {
        const { eventId } = await sendMessage(text, attachmentIds);
        const message = await waitForChatResult(eventId, {
          timeoutMs: 120_000,
        });
        setMessages((prev) => [
          ...prev,
          {
            ...message,
            timestamp: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        if (err instanceof ChatSkippedError) {
          // Agent chose not to respond; stop thinking, do not add a message
          return;
        }
        const msg = (err as Error).message;
        const hint =
          !msg ||
          msg === "Failed to fetch" ||
          msg.startsWith("500") ||
          msg.startsWith("502") ||
          msg.startsWith("503")
            ? " Start the API with: yarn dev"
            : msg.includes("timed out")
              ? " Worker may be busy or down."
              : "";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Error: ${msg || "Could not reach the API."}${hint}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setLoading(false);
        if (queueRef.current.length > 0) {
          const next = queueRef.current.shift()!;
          setQueue((q) => q.slice(1));
          setMessages((prev) => [
            ...prev,
            {
              role: "user",
              text: next.text,
              timestamp: new Date().toISOString(),
              ...(next.attachments?.length
                ? {
                    attachments: next.attachments,
                    attachment_metas: next.attachment_metas,
                  }
                : {}),
            },
          ]);
          sendOne(next.text, next.attachments);
        }
      }
    },
    [setMessages],
  );

  function handleSend(
    text: string,
    attachmentIds?: string[],
    attachmentMetas?: ChatAttachmentMeta[],
  ) {
    if (loading) {
      const queued: QueuedMessage = {
        text,
        attachments: attachmentIds,
        attachment_metas: attachmentMetas,
      };
      setQueue((prev) => [...prev, queued]);
      queueRef.current = [...queueRef.current, queued];
      return;
    }
    const userMessage: ChatMessageType = {
      role: "user",
      text,
      timestamp: new Date().toISOString(),
      ...(attachmentIds?.length
        ? { attachments: attachmentIds, attachment_metas: attachmentMetas }
        : {}),
    };
    setMessages((prev) => [...prev, userMessage]);
    sendOne(text, attachmentIds);
  }

  function removeFromQueue(index: number) {
    setQueue((prev) => {
      const next = prev.filter((_, i) => i !== index);
      queueRef.current = next;
      return next;
    });
  }

  async function handleClearChat() {
    if (clearing) return;
    const ok = await dialog.confirm({
      title: "Clear chat history",
      message: "Clear all chat history? This cannot be undone.",
      confirmLabel: "Clear",
      variant: "danger",
    });
    if (!ok) return;
    setClearing(true);
    try {
      const { cleared } = await clearChatHistory();
      if (cleared) {
        setMessages([]);
        setChatTotal(0);
        setChatPage(1);
      }
    } catch (e) {
      debug("%o", e);
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Chat with Hooman"
        subtitle="Have a conversation with Hooman and get things done."
      >
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
      </PageHeader>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 min-h-0">
        {chatTotal > messages.length && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadOlderChat}
              disabled={loadingOlder}
            >
              {loadingOlder ? "Loading…" : "Load older messages"}
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-16 px-4 animate-fade-in">
            <div className="w-20 h-20 rounded-2xl bg-gradient-accent-subtle border border-hooman-accent/20 flex items-center justify-center mb-6 shadow-card">
              <MessageCircle
                className="w-10 h-10 text-hooman-accent"
                aria-hidden
              />
            </div>
            <p className="text-lg font-medium text-zinc-200 max-w-sm">
              Say hello. Ask what I can do, or tell me what to remember.
            </p>
            <p className="text-sm text-hooman-muted mt-2 flex items-center gap-2">
              <Zap className="w-4 h-4 text-hooman-amber" />I can converse, store
              memory, and draft content—no setup needed.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} message={m} />
        ))}
        {loading && (
          <div className="flex justify-start animate-fade-in">
            <div className="flex items-center gap-2.5 bg-hooman-surface border border-hooman-border rounded-2xl px-4 py-3 text-hooman-muted text-sm shadow-card">
              <Loader2
                className="w-4 h-4 shrink-0 animate-spin text-hooman-accent"
                aria-hidden
              />
              <span>Thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ChatInput
        loading={loading}
        onSend={handleSend}
        queue={queue}
        onRemoveFromQueue={removeFromQueue}
      />
    </div>
  );
}
