import { forwardRef } from "react";

const textareaBase =
  "w-full rounded-xl bg-hooman-surface border border-hooman-border px-3.5 py-2.5 text-sm text-zinc-200 placeholder:text-hooman-muted focus:outline-none focus:ring-2 focus:ring-hooman-accent/50 focus:ring-offset-2 focus:ring-offset-hooman-bg focus:border-hooman-accent/50 disabled:opacity-50 disabled:cursor-not-allowed resize-y min-h-[4rem] transition-all duration-200";

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
            className="block text-xs font-medium text-hooman-muted uppercase tracking-wider"
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
