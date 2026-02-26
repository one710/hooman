import { forwardRef } from "react";

const inputBase =
  "w-full rounded-xl bg-hooman-surface border border-hooman-border px-3.5 py-2.5 text-sm text-zinc-200 placeholder:text-hooman-muted focus:outline-none focus:ring-2 focus:ring-hooman-accent/50 focus:ring-offset-2 focus:ring-offset-hooman-bg focus:border-hooman-accent/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "className"
> {
  label?: string;
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, className = "", id, ...rest },
  ref,
) {
  return (
    <div className={label ? "space-y-1.5" : ""}>
      {label != null && (
        <label
          htmlFor={id}
          className="block text-xs font-medium text-hooman-muted uppercase tracking-wider"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={`${inputBase} ${className}`.trim()}
        {...rest}
      />
    </div>
  );
});
