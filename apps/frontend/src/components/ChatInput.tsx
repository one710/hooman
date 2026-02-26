import { useState, useRef, useCallback, useEffect } from "react";
import {
  X,
  Loader2,
  Paperclip,
  FileText,
  Plus,
  ListOrdered,
  Send,
} from "lucide-react";
import {
  uploadAttachments,
  getAttachmentUrl,
  type ChatAttachmentMeta,
} from "../api";
import { Button } from "./Button";
import { VoiceBar, VoiceButton, useVoice } from "./ChatVoice";

const CHAT_DRAFT_KEY = "hooman:chat-draft";

function getChatDraft(): string {
  try {
    return localStorage.getItem(CHAT_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function setChatDraft(value: string): void {
  try {
    if (value) localStorage.setItem(CHAT_DRAFT_KEY, value);
    else localStorage.removeItem(CHAT_DRAFT_KEY);
  } catch {
    // ignore quota / private mode
  }
}

function clearChatDraft(): void {
  try {
    localStorage.removeItem(CHAT_DRAFT_KEY);
  } catch {
    // ignore
  }
}

const MAX_ATTACHMENTS = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(
    type.toLowerCase().split(";")[0].trim(),
  );
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

export interface QueuedMessage {
  text: string;
  attachments?: string[];
  attachment_metas?: ChatAttachmentMeta[];
}

export function ChatInput({
  onSend,
  queue,
  onRemoveFromQueue,
}: {
  loading?: boolean;
  onSend: (
    text: string,
    attachmentIds?: string[],
    attachmentMetas?: ChatAttachmentMeta[],
  ) => void;
  queue: QueuedMessage[];
  onRemoveFromQueue: (index: number) => void;
}) {
  const [input, setInput] = useState(getChatDraft);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    textInputRef.current?.focus();
  }, []);

  useEffect(() => {
    setChatDraft(input);
  }, [input]);
  const pendingVoiceRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const voice = useVoice((text) => {
    setInput(text);
    pendingVoiceRef.current = text;
    formRef.current?.requestSubmit();
  });

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.size <= MAX_FILE_SIZE && isAllowedMime(f.type),
    );
    if (list.length === 0) return;
    setAttachments((prev) => {
      const space = MAX_ATTACHMENTS - prev.length;
      const toAdd = list.slice(0, space).map((file) => {
        const mimeType = file.type || "application/octet-stream";
        return {
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          originalName: file.name,
          mimeType,
          uploading: true as const,
          preview: isImageMime(mimeType)
            ? URL.createObjectURL(file)
            : undefined,
        };
      });
      return [...prev, ...toAdd];
    });
    (async () => {
      try {
        const { attachments: serverAttachments } =
          await uploadAttachments(list);
        setAttachments((prev) => {
          const withoutUploading = prev.filter((a) => !a.uploading);
          const uploadingPrev = prev.filter((a) => a.uploading);
          const uploaded = serverAttachments.map(
            (a: ChatAttachmentMeta, i: number) =>
              ({
                id: a.id,
                originalName: a.originalName,
                mimeType: a.mimeType,
                preview: isImageMime(a.mimeType)
                  ? (uploadingPrev[i]?.preview ?? getAttachmentUrl(a.id))
                  : undefined,
              }) as PendingAttachment,
          );
          return [...withoutUploading, ...uploaded];
        });
      } catch {
        setAttachments((prev) => {
          prev
            .filter((a) => a.uploading)
            .forEach((a) => {
              if (a.preview?.startsWith("blob:"))
                URL.revokeObjectURL(a.preview);
            });
          return prev.filter((a) => !a.uploading);
        });
      }
    })();
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item?.preview?.startsWith("blob:")) URL.revokeObjectURL(item.preview);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = pendingVoiceRef.current ?? input.trim();
    if (pendingVoiceRef.current) pendingVoiceRef.current = null;
    const ready = attachments.filter((a) => !a.uploading);
    if (!text && ready.length === 0) return;
    if (attachments.some((a) => a.uploading)) return;
    const messageText = text || "(attachments)";
    setInput("");
    clearChatDraft();
    attachments.forEach((a) => {
      if (a.preview?.startsWith("blob:")) URL.revokeObjectURL(a.preview);
    });
    const attachmentIds = ready.length ? ready.map((a) => a.id) : undefined;
    const attachmentMetas = ready.length
      ? ready.map((a) => ({
          id: a.id,
          originalName: a.originalName,
          mimeType: a.mimeType,
        }))
      : undefined;
    setAttachments([]);
    onSend(messageText, attachmentIds, attachmentMetas);
  }

  return (
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
      className="p-3 md:p-4 border-t border-hooman-border/80 shrink-0 bg-hooman-bg-elevated/50 backdrop-blur-sm transition-shadow"
    >
      {voice.error && (
        <div className="mb-3 rounded-xl bg-hooman-red/10 border border-hooman-red/30 px-3 py-2 text-sm text-hooman-red">
          {voice.error}
        </div>
      )}
      {voice.active && (
        <VoiceBar
          transcript={voice.transcript}
          segment={voice.segment}
          onCancel={voice.cancel}
          onConfirm={voice.confirm}
        />
      )}
      {attachments.length > 0 && (
        <div className="mb-3 pb-3 border-b border-hooman-border/50">
          <p className="flex items-center gap-2 text-xs text-hooman-muted mb-2">
            <Paperclip className="w-3.5 h-3.5 text-hooman-accent" />
            {attachments.length} attached
            {attachments.some((a) => a.uploading) && (
              <span className="flex items-center gap-1.5 text-hooman-cyan">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                Uploading…
              </span>
            )}
          </p>
          <ul className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-xl bg-hooman-surface border border-hooman-border overflow-hidden group"
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
                  className="shrink-0 p-1 mr-2 opacity-70 hover:opacity-100"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {queue.length > 0 && (
        <div className="mb-3 pb-3 border-b border-hooman-border/50">
          <p className="flex items-center gap-2 text-xs text-hooman-muted mb-2">
            <ListOrdered className="w-3.5 h-3.5 text-hooman-amber" />
            {queue.length} queued
          </p>
          <ul className="space-y-1.5">
            {queue.map((item, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-xl bg-hooman-surface/80 border border-hooman-border px-3 py-2 text-sm text-zinc-300"
              >
                <span className="flex-1 truncate">
                  {item.text}
                  {item.attachments?.length
                    ? ` (+${item.attachments.length} attachment${item.attachments.length === 1 ? "" : "s"})`
                    : ""}
                </span>
                <Button
                  variant="danger"
                  iconOnly
                  size="icon"
                  icon={<X className="w-4 h-4" />}
                  onClick={() => onRemoveFromQueue(i)}
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
            ref={textInputRef}
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
            className="w-full rounded-xl bg-hooman-surface border border-hooman-border pl-11 pr-11 md:pl-12 md:pr-12 py-2.5 md:py-3 text-sm md:text-base text-zinc-200 placeholder:text-hooman-muted focus:outline-none focus:ring-2 focus:ring-hooman-accent/50 focus:border-hooman-accent/40 transition-all"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            aria-label="Attach files"
            disabled={attachments.length >= MAX_ATTACHMENTS}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center bg-hooman-surface border border-transparent text-hooman-muted hover:text-hooman-accent hover:bg-hooman-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4 md:w-5 md:h-5 shrink-0" />
          </button>
          <VoiceButton
            connecting={voice.connecting}
            active={voice.active}
            onStart={voice.start}
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() && attachments.length === 0}
          className="rounded-xl bg-gradient-accent px-4 md:px-5 py-2.5 md:py-3 text-sm md:text-base text-white font-medium shadow-glow-accent hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 inline-flex items-center gap-2 transition-all active:scale-[0.98]"
        >
          <Send className="w-4 h-4 md:w-5 md:h-5 shrink-0" aria-hidden />
          Send
        </button>
      </div>
    </form>
  );
}
