import { Check } from "lucide-react";

export interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}

export function Checkbox({
  id,
  checked,
  onChange,
  label,
  disabled,
}: CheckboxProps) {
  const handleLabelClick = (e: React.MouseEvent<HTMLLabelElement>) => {
    if (disabled) return;
    if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") {
      return;
    }
    e.preventDefault();
    onChange(!checked);
  };

  return (
    <label
      htmlFor={id}
      onClick={handleLabelClick}
      className={`flex items-center gap-2 cursor-pointer select-none w-fit ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <span
        className={`flex items-center justify-center w-5 h-5 rounded border shrink-0 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-hooman-accent/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-hooman-bg [&>svg]:block ${
          checked
            ? "bg-hooman-accent border-hooman-accent text-white"
            : "bg-hooman-surface border-hooman-border"
        }`}
        aria-hidden
      >
        {checked ? <Check className="w-3 h-3 shrink-0 stroke-[2.5]" /> : null}
      </span>
      {label != null && (
        <span className="text-sm font-medium text-zinc-300">{label}</span>
      )}
    </label>
  );
}
