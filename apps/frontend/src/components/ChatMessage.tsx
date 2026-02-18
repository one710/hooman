import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../types";
import { getAttachmentUrl } from "../api";

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function ChatMessage({ message: m }: { message: ChatMessageType }) {
  return (
    <div
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
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
      </div>
    </div>
  );
}
