import type { ButtonHTMLAttributes, ReactNode } from "react";

const base =
  "rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0";

const variants = {
  primary:
    "bg-hooman-accent text-white hover:opacity-90 focus:ring-hooman-accent/50 focus:ring-offset-hooman-bg",
  secondary:
    "border border-hooman-border bg-hooman-surface text-hooman-muted hover:bg-hooman-border/30 focus:ring-hooman-accent/50 focus:ring-offset-hooman-surface",
  success:
    "border border-hooman-border bg-hooman-surface text-green-400 hover:bg-green-500/10 hover:text-green-400 hover:border-green-500/30 focus:ring-green-500/50 focus:ring-offset-hooman-surface",
  danger:
    "border border-hooman-border bg-hooman-surface text-red-400 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 focus:ring-red-500/50 focus:ring-offset-hooman-surface",
  dangerFilled:
    "bg-hooman-red text-white hover:opacity-90 focus:ring-hooman-red/50 focus:ring-offset-hooman-bg",
  ghost:
    "text-hooman-muted hover:text-hooman-accent focus:ring-hooman-accent/50 focus:ring-offset-hooman-bg",
} as const;

const sizes = {
  sm: "px-2.5 md:px-3 py-1.5 md:py-2 text-xs md:text-sm",
  md: "px-4 py-2 text-sm",
  icon: "p-2 inline-flex items-center justify-center",
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
      className={`inline-flex items-center justify-center gap-1.5 ${base} ${variantClass} ${sizeClass} ${className}`.trim()}
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
