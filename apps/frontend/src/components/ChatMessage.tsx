import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../types";
import { getAttachmentSignedUrls } from "../api";

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** Renders a non-image attachment link using a signed URL (open in new tab without auth). */
function SignedAttachmentLink({
  id,
  originalName,
}: {
  id: string;
  originalName: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    getAttachmentSignedUrls([id])
      .then((urls) => {
        const u = urls.find((x) => x.id === id);
        if (u?.url) setSignedUrl(u.url);
      })
      .catch(() => {});
  }, [id]);
  if (!signedUrl) {
    return (
      <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-hooman-muted bg-hooman-border/50 rounded-lg">
        <FileText className="w-4 h-4 shrink-0" />
        <span className="truncate">{originalName}</span>
      </span>
    );
  }
  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      download={originalName}
      className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-zinc-300 hover:text-hooman-cyan transition-colors"
    >
      <FileText className="w-4 h-4 shrink-0" />
      <span className="truncate">{originalName}</span>
    </a>
  );
}

/** Renders an image attachment using a signed URL (loads in bubble and opens in new tab without auth). */
function SignedImage({
  id,
  originalName,
  className,
}: {
  id: string;
  originalName: string;
  className?: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    getAttachmentSignedUrls([id])
      .then((urls) => {
        const u = urls.find((x) => x.id === id);
        if (u?.url) setSignedUrl(u.url);
      })
      .catch(() => {});
  }, [id]);
  if (!signedUrl) {
    return (
      <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-hooman-muted bg-hooman-border/50 rounded-lg">
        <FileText className="w-4 h-4 shrink-0" />
        <span className="truncate">{originalName}</span>
      </span>
    );
  }
  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
    >
      <img src={signedUrl} alt={originalName} className={className} />
    </a>
  );
}

function formatMessageTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ChatMessage({ message: m }: { message: ChatMessageType }) {
  const timeStr = formatMessageTime(m.timestamp);
  return (
    <div
      className={`flex flex-col animate-fade-in-up ${m.role === "user" ? "items-end" : "items-start"}`}
    >
      <div
        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} max-w-[85%] sm:max-w-[80%]`}
      >
        <div
          className={`rounded-2xl px-3 md:px-4 py-2.5 md:py-3 text-sm shadow-card ${
            m.role === "user"
              ? "bg-gradient-accent-subtle border border-hooman-accent/25 text-white"
              : "bg-hooman-surface border border-hooman-border/80 text-zinc-200"
          }`}
        >
          <div className="chat-markdown prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-a:text-hooman-accent-bright prose-a:no-underline hover:prose-a:underline prose-strong:text-inherit prose-code:bg-hooman-border/60 prose-code:px-1.5 prose-code:rounded-lg prose-code:before:content-none prose-code:after:content-none prose-code:text-hooman-cyan">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
          </div>
          {(m.attachment_metas?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-2">
              {m.attachment_metas!.map((att) => (
                <div
                  key={att.id}
                  className="rounded-xl overflow-hidden bg-black/20 max-w-[120px] border border-hooman-border/50"
                >
                  {isImageMime(att.mimeType) ? (
                    <SignedImage
                      id={att.id}
                      originalName={att.originalName}
                      className="w-full h-20 object-cover"
                    />
                  ) : (
                    <SignedAttachmentLink
                      id={att.id}
                      originalName={att.originalName}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {timeStr && (
        <span
          className={`mt-1 text-xs text-hooman-muted ${
            m.role === "user" ? "pr-1" : "pl-1"
          }`}
        >
          {timeStr}
        </span>
      )}
    </div>
  );
}
