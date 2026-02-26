import type { ButtonHTMLAttributes, ReactNode } from "react";

const base =
  "rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-hooman-bg disabled:opacity-50 disabled:cursor-not-allowed shrink-0 transition-all duration-200 active:scale-[0.98]";

const variants = {
  primary:
    "bg-gradient-accent text-white shadow-glow-accent hover:opacity-95 hover:shadow-glow-lg hover:shadow-hooman-accent-glow focus:ring-hooman-accent/50",
  secondary:
    "border border-hooman-border bg-hooman-surface text-hooman-muted hover:bg-hooman-surface-hover hover:text-zinc-200 hover:border-hooman-border-focus focus:ring-hooman-accent/50",
  success:
    "border border-hooman-green/40 bg-hooman-surface text-hooman-green hover:bg-hooman-green/10 hover:shadow-glow-green focus:ring-hooman-green/50",
  danger:
    "border border-hooman-red/40 bg-hooman-surface text-hooman-red hover:bg-hooman-red/10 hover:shadow-glow-red focus:ring-hooman-red/50",
  dangerFilled:
    "bg-hooman-red text-white shadow-glow-red hover:opacity-95 focus:ring-hooman-red/50",
  ghost:
    "text-hooman-muted hover:text-hooman-accent hover:bg-hooman-surface-hover focus:ring-hooman-accent/50",
} as const;

const sizes = {
  sm: "px-3 md:px-3.5 py-1.5 md:py-2 text-xs md:text-sm",
  md: "px-4 py-2.5 text-sm",
  icon: "p-2.5 inline-flex items-center justify-center",
} as const;

export type ButtonVariant = keyof typeof variants;

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "icon";
  /** Icon element (e.g. <Check className="w-4 h-4" />). When iconOnly, this is the only visible content. */
  icon?: ReactNode;
  /** Icon-only button; use with icon prop and aria-label for accessibility. */
  iconOnly?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconOnly = false,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const sizeClass = size === "icon" || iconOnly ? sizes.icon : sizes[size];
  const variantClass = variants[variant];
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 ${base} ${variantClass} ${sizeClass} ${className}`.trim()}
      {...rest}
    >
      {icon != null && (
        <span
          className={
            iconOnly
              ? "inline-flex items-center justify-center w-4 h-4 shrink-0 [&>svg]:size-4 [&>svg]:shrink-0"
              : "shrink-0 inline-flex items-center justify-center [&>svg]:size-4 [&>svg]:shrink-0"
          }
          aria-hidden={iconOnly}
        >
          {icon}
        </span>
      )}
      {children != null && iconOnly ? (
        <span className="sr-only">{children}</span>
      ) : (
        children
      )}
    </button>
  );
}
