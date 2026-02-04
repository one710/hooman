import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Button } from "./Button";

export interface AlertOptions {
  title?: string;
  message: string;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
}

interface DialogContextValue {
  alert: (options: AlertOptions) => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}

type DialogState =
  | { type: "alert"; title?: string; message: string; resolve: () => void }
  | {
      type: "confirm";
      title?: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      variant?: "default" | "danger";
      resolve: (value: boolean) => void;
    }
  | null;

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState>(null);

  const alert = useCallback((options: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setDialog({
        type: "alert",
        title: options.title,
        message: options.message,
        resolve: () => {
          setDialog(null);
          resolve();
        },
      });
    });
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        type: "confirm",
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        variant: options.variant ?? "default",
        resolve: (value) => {
          setDialog(null);
          resolve(value);
        },
      });
    });
  }, []);

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      {dialog && (
        <DialogBackdrop
          dialog={dialog}
          onDismiss={() => {
            if (dialog.type === "alert") dialog.resolve();
            else dialog.resolve(false);
          }}
        />
      )}
    </DialogContext.Provider>
  );
}

function DialogBackdrop({
  dialog,
  onDismiss,
}: {
  dialog: NonNullable<DialogState>;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      onClick={onDismiss}
    >
      <div
        className="rounded-xl border border-hooman-border bg-hooman-surface shadow-xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-1">
          <h2 id="dialog-title" className="text-lg font-semibold text-white">
            {dialog.type === "alert"
              ? (dialog.title ?? "Notice")
              : (dialog.title ?? "Confirm")}
          </h2>
        </div>
        <div className="px-5 py-3">
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">
            {dialog.message}
          </p>
        </div>
        <div className="px-5 pb-5 pt-2 flex justify-end gap-2">
          {dialog.type === "alert" ? (
            <Button onClick={() => dialog.resolve()}>OK</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => dialog.resolve(false)}>
                {dialog.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={
                  dialog.variant === "danger" ? "dangerFilled" : "primary"
                }
                onClick={() => dialog.resolve(true)}
              >
                {dialog.confirmLabel ?? "Confirm"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
