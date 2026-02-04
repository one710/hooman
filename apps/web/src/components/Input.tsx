import { forwardRef } from "react";

const inputBase =
  "w-full rounded-lg bg-hooman-bg border border-hooman-border px-3 py-2 text-sm text-zinc-200 placeholder:text-hooman-muted focus:outline-none focus:ring-2 focus:ring-hooman-accent/50 focus:ring-offset-2 focus:ring-offset-hooman-bg disabled:opacity-50 disabled:cursor-not-allowed";

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
    <div className={label ? "space-y-1" : ""}>
      {label != null && (
        <label
          htmlFor={id}
          className="block text-xs text-hooman-muted uppercase tracking-wide"
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
