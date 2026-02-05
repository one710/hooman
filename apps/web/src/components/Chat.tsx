import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Trash2,
  ListOrdered,
  X,
  Loader2,
  Paperclip,
  FileText,
  Plus,
  Mic,
  Check,
} from "lucide-react";
import type { ChatMessage } from "../types";
import {
  sendMessage,
  uploadAttachments,
  getAttachmentUrl,
  getRealtimeClientSecret,
  type ChatAttachmentMeta,
} from "../api";
import { useDialog } from "./Dialog";
import { Button } from "./Button";

const MAX_ATTACHMENTS = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/** Allowed attachment MIME types (OpenAI supported files + 4 image types + SVG). Text/* must be utf-8, utf-16, or ascii. */
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "text/x-c",
  "text/x-c++",
  "text/x-csharp",
  "text/css",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/x-golang",
  "text/html",
  "text/x-java",
  "text/javascript",
  "application/json",
  "text/markdown",
  "application/pdf",
  "text/x-php",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/x-python",
  "text/x-script.python",
  "text/x-ruby",
  "application/x-sh",
  "text/x-tex",
  "application/typescript",
  "text/plain",
]);

const ACCEPT_ATTRIBUTE = [...ALLOWED_ATTACHMENT_MIME_TYPES].sort().join(",");

function isAllowedMime(type: string): boolean {
  const normalized = type.toLowerCase().split(";")[0].trim();
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(normalized);
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

interface PendingAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  preview?: string;
  uploading?: boolean;
}

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
  const [queue, setQueue] = useState<
    Array<{
      text: string;
      attachment_ids?: string[];
      attachment_metas?: ChatAttachmentMeta[];
    }>
  >([]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceSegment, setVoiceSegment] = useState(""); // in-progress from deltas; cleared on completed
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const queueRef = useRef<
    Array<{
      text: string;
      attachment_ids?: string[];
      attachment_metas?: ChatAttachmentMeta[];
    }>
  >([]);
  const formRef = useRef<HTMLFormElement>(null);
  const pendingVoiceRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const voicePcRef = useRef<RTCPeerConnection | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.size <= MAX_FILE_SIZE && isAllowedMime(f.type),
    );
    if (list.length === 0) return;
    setAttachments((prev) => {
      const space = MAX_ATTACHMENTS - prev.length;
      const toAdd = list.slice(0, space).map((file) => ({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        uploading: true as const,
      }));
      return [...prev, ...toAdd];
    });
    (async () => {
      try {
        const { attachments: serverAttachments } =
          await uploadAttachments(list);
        setAttachments((prev) => {
          const withoutUploading = prev.filter((a) => !a.uploading);
          const uploaded = serverAttachments.map(
            (a: ChatAttachmentMeta) =>
              ({
                id: a.id,
                originalName: a.originalName,
                mimeType: a.mimeType,
                preview: isImageMime(a.mimeType)
                  ? getAttachmentUrl(a.id)
                  : undefined,
              }) as PendingAttachment,
          );
          return [...withoutUploading, ...uploaded];
        });
      } catch {
        setAttachments((prev) => prev.filter((a) => !a.uploading));
      }
    })();
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const endVoiceSession = useCallback(() => {
    voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
    voiceStreamRef.current = null;
    voicePcRef.current?.close();
    voicePcRef.current = null;
  }, []);

  const cancelVoice = useCallback(() => {
    endVoiceSession();
    setVoiceActive(false);
    setVoiceTranscript("");
    setVoiceSegment("");
    setVoiceError(null);
  }, [endVoiceSession]);

  const sendOne = useCallback(
    async (text: string, attachmentIds?: string[]) => {
      setLoading(true);
      try {
        const { message } = await sendMessage(text, attachmentIds);
        setMessages((prev) => [...prev, message]);
      } catch (err) {
        const msg = (err as Error).message;
        const hint =
          !msg ||
          msg === "Failed to fetch" ||
          msg.startsWith("500") ||
          msg.startsWith("502") ||
          msg.startsWith("503")
            ? " Start the API with: yarn dev"
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
          setMessages((prev) => [
            ...prev,
            {
              role: "user",
              text: next.text,
              ...(next.attachment_ids?.length
                ? {
                    attachment_ids: next.attachment_ids,
                    attachment_metas: next.attachment_metas,
                  }
                : {}),
            },
          ]);
          sendOne(next.text, next.attachment_ids);
        }
      }
    },
    [setMessages],
  );

  const confirmVoice = useCallback(() => {
    const full = [voiceTranscript, voiceSegment]
      .filter(Boolean)
      .join(" ")
      .trim();
    endVoiceSession();
    setVoiceActive(false);
    setVoiceTranscript("");
    setVoiceSegment("");
    setVoiceError(null);
    if (!full) return;
    setInput(full);
    pendingVoiceRef.current = full;
    formRef.current?.requestSubmit();
  }, [voiceTranscript, voiceSegment, endVoiceSession]);

  const startVoiceSession = useCallback(async () => {
    setVoiceError(null);
    setVoiceTranscript("");
    setVoiceConnecting(true);
    try {
      const { value: ephemeralKey } = await getRealtimeClientSecret();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const pc = new RTCPeerConnection();
      voicePcRef.current = pc;
      const dc = pc.createDataChannel("oai-events");
      pc.addTrack(stream.getTracks()[0], stream);
      dc.addEventListener("message", (e) => {
        try {
          const event = JSON.parse(e.data) as {
            type?: string;
            delta?: string;
            transcript?: string;
          };
          // Deltas stream in-progress text; completed is the final for that turn (don't append both to avoid duplication)
          if (
            event.type ===
              "conversation.item.input_audio_transcription.delta" &&
            event.delta
          )
            setVoiceSegment((prev) => prev + event.delta);
          if (
            event.type ===
              "conversation.item.input_audio_transcription.completed" &&
            event.transcript != null
          ) {
            const final = String(event.transcript).trim();
            if (final)
              setVoiceTranscript((prev) => (prev ? `${prev} ${final}` : final));
            setVoiceSegment("");
          }
        } catch {
          // ignore parse errors
        }
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        },
      );
      if (!sdpResponse.ok) {
        const err = await sdpResponse.text();
        throw new Error(err || "Realtime session failed");
      }
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      setVoiceActive(true);
    } catch (err) {
      setVoiceError((err as Error).message || "Could not start voice input");
      endVoiceSession();
    } finally {
      setVoiceConnecting(false);
    }
  }, [endVoiceSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => endVoiceSession();
  }, [endVoiceSession]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = pendingVoiceRef.current ?? input.trim();
    if (pendingVoiceRef.current) pendingVoiceRef.current = null;
    const ready = attachments.filter((a) => !a.uploading);
    if (!text && ready.length === 0) return;
    if (attachments.some((a) => a.uploading)) return;
    const messageText = text || "(attachments)";
    setInput("");
    const attachmentIds = ready.length ? ready.map((a) => a.id) : undefined;
    const attachmentMetas = ready.length
      ? ready.map((a) => ({
          id: a.id,
          originalName: a.originalName,
          mimeType: a.mimeType,
        }))
      : undefined;
    setAttachments([]);
    const userMessage: ChatMessage = {
      role: "user",
      text: messageText,
      ...(attachmentIds?.length
        ? { attachment_ids: attachmentIds, attachment_metas: attachmentMetas }
        : {}),
    };
    setMessages((prev) => [...prev, userMessage]);
    if (loading) {
      const queued = {
        text: messageText,
        attachment_ids: attachmentIds,
        attachment_metas: attachmentMetas,
      };
      setQueue((prev) => [...prev, queued]);
      queueRef.current = [...queueRef.current, queued];
      return;
    }
    sendOne(messageText, attachmentIds);
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
            Have a conversation with Hooman and get things done.
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
              {(m.attachment_metas?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-2">
                  {m.attachment_metas!.map((att) => (
                    <div
                      key={att.id}
                      className="rounded-lg overflow-hidden bg-black/20 max-w-[120px]"
                    >
                      {isImageMime(att.mimeType) ? (
                        <a
                          href={getAttachmentUrl(att.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={getAttachmentUrl(att.id)}
                            alt={att.originalName}
                            className="w-full h-20 object-cover"
                          />
                        </a>
                      ) : (
                        <a
                          href={getAttachmentUrl(att.id)}
                          download={att.originalName}
                          className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-zinc-300 hover:text-white"
                        >
                          <FileText className="w-4 h-4 shrink-0" />
                          <span className="truncate">{att.originalName}</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
            <div className="flex items-center gap-2 bg-hooman-surface border border-hooman-border rounded-2xl px-4 py-2.5 text-hooman-muted text-sm">
              <Loader2 className="w-4 h-4 shrink-0 animate-spin" aria-hidden />
              <span>Thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("ring-2", "ring-hooman-accent/50");
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            e.currentTarget.classList.remove("ring-2", "ring-hooman-accent/50");
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("ring-2", "ring-hooman-accent/50");
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className="p-3 md:p-4 border-t border-hooman-border shrink-0 rounded-lg transition-shadow"
      >
        {voiceError && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
            {voiceError}
          </div>
        )}
        {voiceActive && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-hooman-surface border border-hooman-border px-3 py-2.5">
            <Mic className="w-4 h-4 shrink-0 text-hooman-muted" aria-hidden />
            <span className="flex-1 min-w-0 truncate text-sm text-zinc-200">
              {[voiceTranscript, voiceSegment].filter(Boolean).join(" ") || (
                <span className="text-hooman-muted">Listening…</span>
              )}
            </span>
            <Button
              variant="danger"
              iconOnly
              size="icon"
              icon={<X className="w-4 h-4" />}
              onClick={cancelVoice}
              title="Cancel"
              aria-label="Cancel"
              className="shrink-0"
            />
            <Button
              variant="success"
              iconOnly
              size="icon"
              icon={<Check className="w-4 h-4" />}
              onClick={confirmVoice}
              title="Use as prompt"
              aria-label="Use as prompt"
              className="shrink-0"
            />
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-3 pb-3 border-b border-hooman-border/50">
            <p className="flex items-center gap-2 text-xs text-hooman-muted mb-2">
              <Paperclip className="w-3.5 h-3.5" />
              {attachments.length} attached
              {attachments.some((a) => a.uploading) && (
                <span className="flex items-center gap-1.5 text-hooman-accent">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                  Uploading…
                </span>
              )}
            </p>
            <ul className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg bg-hooman-surface border border-hooman-border overflow-hidden group"
                >
                  {a.uploading ? (
                    <span className="w-12 h-12 flex items-center justify-center shrink-0 bg-hooman-border/50 text-hooman-muted">
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
                    </span>
                  ) : a.preview ? (
                    <img
                      src={a.preview}
                      alt=""
                      className="w-12 h-12 object-cover shrink-0"
                    />
                  ) : (
                    <span className="w-12 h-12 flex items-center justify-center shrink-0 bg-hooman-border/50 text-hooman-muted">
                      <FileText className="w-5 h-5" />
                    </span>
                  )}
                  <span className="max-w-[120px] truncate text-sm text-zinc-300 px-1">
                    {a.originalName}
                  </span>
                  <Button
                    variant="ghost"
                    iconOnly
                    size="icon"
                    icon={<X className="w-4 h-4" />}
                    onClick={() => removeAttachment(a.id)}
                    title="Remove attachment"
                    aria-label="Remove attachment"
                    disabled={a.uploading}
                    className="shrink-0 p-1 opacity-70 hover:opacity-100"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
        {queue.length > 0 && (
          <div className="mb-3 pb-3 border-b border-hooman-border/50">
            <p className="flex items-center gap-2 text-xs text-hooman-muted mb-2">
              <ListOrdered className="w-3.5 h-3.5" />
              {queue.length} queued
            </p>
            <ul className="space-y-1.5">
              {queue.map((item, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg bg-hooman-surface/80 border border-hooman-border px-3 py-2 text-sm text-zinc-300"
                >
                  <span className="flex-1 truncate">
                    {item.text}
                    {item.attachment_ids?.length
                      ? ` (+${item.attachment_ids.length} attachment${item.attachment_ids.length === 1 ? "" : "s"})`
                      : ""}
                  </span>
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
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) addFiles(files);
              e.target.value = "";
            }}
            aria-hidden
          />
          <div className="flex-1 min-w-0 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                const files: File[] = [];
                for (let i = 0; i < items.length; i++) {
                  const file = items[i].getAsFile();
                  if (file) files.push(file);
                }
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              placeholder="Type a message or drag & drop / paste files…"
              className="w-full rounded-xl bg-hooman-surface border border-hooman-border pl-11 pr-11 md:pl-12 md:pr-12 py-2.5 md:py-3 text-sm md:text-base text-zinc-200 placeholder:text-hooman-muted focus:outline-none focus:ring-2 focus:ring-hooman-accent/50"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              aria-label="Attach files"
              disabled={attachments.length >= MAX_ATTACHMENTS}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center bg-hooman-surface text-hooman-muted hover:text-zinc-200 hover:bg-hooman-surface/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4 md:w-5 md:h-5 shrink-0" />
            </button>
            <button
              type="button"
              onClick={startVoiceSession}
              disabled={voiceConnecting || voiceActive}
              title="Speak (voice input)"
              aria-label="Speak"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center bg-hooman-surface text-hooman-muted hover:text-zinc-200 hover:bg-hooman-surface/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {voiceConnecting ? (
                <Loader2
                  className="w-4 h-4 md:w-5 md:h-5 shrink-0 animate-spin"
                  aria-hidden
                />
              ) : (
                <Mic className="w-4 h-4 md:w-5 md:h-5 shrink-0" aria-hidden />
              )}
            </button>
          </div>
          <button
            type="submit"
            disabled={!input.trim() && attachments.length === 0}
            className="rounded-xl bg-hooman-accent px-4 md:px-5 py-2.5 md:py-3 text-sm md:text-base text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
