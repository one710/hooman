import { useEffect, useRef } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        ref={contentRef}
        className={`rounded-xl border border-hooman-border bg-hooman-surface shadow-xl w-full overflow-hidden ${maxWidthClasses[maxWidth]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2 border-b border-hooman-border">
          <h2 id="modal-title" className="text-lg font-semibold text-white">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
