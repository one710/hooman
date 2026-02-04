import { forwardRef } from "react";

const textareaBase =
  "w-full rounded-lg bg-hooman-bg border border-hooman-border px-3 py-2 text-sm text-zinc-200 placeholder:text-hooman-muted focus:outline-none focus:ring-2 focus:ring-hooman-accent/50 focus:ring-offset-2 focus:ring-offset-hooman-bg disabled:opacity-50 disabled:cursor-not-allowed resize-y min-h-[4rem]";

export interface TextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className"
> {
  label?: string;
  className?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, className = "", id, ...rest }, ref) {
    return (
      <div className={label ? "space-y-1" : ""}>
        {label != null && (
          <label
            htmlFor={id}
            className="block text-xs text-hooman-muted uppercase tracking-wide"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={`${textareaBase} ${className}`.trim()}
          {...rest}
        />
      </div>
    );
  },
);
