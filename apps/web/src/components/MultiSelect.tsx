import { useRef, useEffect, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  id?: string;
  label?: string;
  value: string[];
  options: MultiSelectOption[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}

export function MultiSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select…",
  "aria-label": ariaLabel,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSet = new Set(value);
  const display =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : `${value.length} selected`;

  function toggle(optValue: string) {
    if (selectedSet.has(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  }

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label
          htmlFor={id}
          className="block text-xs text-hooman-muted uppercase tracking-wide mb-1"
        >
          {label}
        </label>
      )}
      <button
        type="button"
        id={id}
        aria-label={ariaLabel ?? label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="w-full rounded-lg bg-hooman-bg border border-hooman-border px-3 py-2 text-sm text-zinc-200 text-left flex items-center justify-between gap-2 hover:border-hooman-muted/50 focus:outline-none focus:ring-2 focus:ring-hooman-accent/50 focus:ring-offset-2 focus:ring-offset-hooman-bg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate">{display}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-hooman-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-10 mt-1 w-full rounded-lg border border-hooman-border bg-hooman-surface py-1 shadow-lg max-h-60 overflow-auto"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-hooman-muted">
              No capabilities available. Approve some from Capabilities first.
            </li>
          ) : (
            options.map((opt) => {
              const checked = selectedSet.has(opt.value);
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={checked}
                  onClick={() => !disabled && toggle(opt.value)}
                  className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 hover:bg-hooman-border/50 ${
                    checked
                      ? "bg-hooman-accent/20 text-hooman-accent"
                      : "text-zinc-200"
                  } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded border shrink-0 ${
                      checked
                        ? "bg-hooman-accent border-hooman-accent text-white"
                        : "bg-hooman-surface border-hooman-border"
                    }`}
                    aria-hidden
                  >
                    {checked ? (
                      <Check className="w-3 h-3 shrink-0 stroke-[2.5]" />
                    ) : null}
                  </span>
                  <span className="flex-1 truncate">{opt.label}</span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
