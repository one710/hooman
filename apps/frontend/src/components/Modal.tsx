import { useEffect, useRef } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Optional footer (e.g. button bar) that stays fixed; only body scrolls. */
  footer?: React.ReactNode;
  /** Max width class, e.g. "max-w-md" or "max-w-2xl". Default max-w-md. */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl";
}

const maxWidthClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = "md",
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        ref={contentRef}
        className={`flex max-h-[90vh] flex-col rounded-2xl border border-hooman-border/80 bg-hooman-surface/95 backdrop-blur-xl shadow-card w-full overflow-hidden animate-fade-in-up ${maxWidthClasses[maxWidth]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5 pb-2 border-b border-hooman-border/80">
          <h2
            id="modal-title"
            className="text-lg font-semibold text-white font-display"
          >
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer != null && (
          <div className="shrink-0 border-t border-hooman-border/80 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
