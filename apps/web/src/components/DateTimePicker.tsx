import { useRef, useEffect, useState } from "react";
import { Calendar, Check, X } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";

export interface DateTimePickerProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatDisplay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const h = d.getHours();
  const m = d.getMinutes();
  return `${day.toString().padStart(2, "0")}-${month.toString().padStart(2, "0")}-${year} ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function getDaysInMonth(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Date[] = [];
  const start = first.getDay();
  for (let i = 0; i < start; i++) {
    days.push(new Date(0));
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  return days;
}

export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  disabled = false,
  placeholder = "dd-mm-yyyy --:--",
  "aria-label": ariaLabel,
}: DateTimePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const initial = value ? new Date(value) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(
    value ? new Date(value) : null,
  );
  const [hour, setHour] = useState(value ? new Date(value).getHours() : 12);
  const [minute, setMinute] = useState(
    value ? new Date(value).getMinutes() : 0,
  );

  const display = value ? formatDisplay(value) : placeholder;

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

  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setSelectedDate(d);
      setHour(d.getHours());
      setMinute(d.getMinutes());
    }
  }, [value, open]);

  function commit(date: Date | null, h: number, m: number) {
    if (!date) return;
    const d = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      h,
      m,
      0,
      0,
    );
    onChange(d.toISOString());
  }

  function handleDayClick(d: Date) {
    if (d.getTime() === 0) return;
    setSelectedDate(d);
    const combined = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      hour,
      minute,
      0,
      0,
    );
    onChange(combined.toISOString());
  }

  function handleTimeChange(h: number, m: number) {
    const clampedH = Math.max(0, Math.min(23, h));
    const clampedM = Math.max(0, Math.min(59, m));
    setHour(clampedH);
    setMinute(clampedM);
    if (selectedDate) {
      const combined = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        clampedH,
        clampedM,
        0,
        0,
      );
      onChange(combined.toISOString());
    }
  }

  const days = getDaysInMonth(viewYear, viewMonth);

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
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="w-full rounded-lg bg-hooman-bg border border-hooman-border px-3 py-2 text-sm text-left flex items-center justify-between gap-2 text-zinc-200 hover:border-hooman-muted/50 focus:outline-none focus:ring-2 focus:ring-hooman-accent/50 focus:ring-offset-2 focus:ring-offset-hooman-bg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={value ? "" : "text-hooman-muted"}>{display}</span>
        <Calendar className="w-4 h-4 shrink-0 text-hooman-muted" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="absolute z-10 mt-1 left-0 w-72 rounded-lg border border-hooman-border bg-hooman-surface shadow-lg p-3"
        >
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => {
                if (viewMonth === 0) {
                  setViewMonth(11);
                  setViewYear((y) => y - 1);
                } else setViewMonth((m) => m - 1);
              }}
              className="p-1.5 rounded text-hooman-muted hover:bg-hooman-border/50 hover:text-zinc-200"
              aria-label="Previous month"
            >
              ←
            </button>
            <span className="text-sm font-medium text-white">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => {
                if (viewMonth === 11) {
                  setViewMonth(0);
                  setViewYear((y) => y + 1);
                } else setViewMonth((m) => m + 1);
              }}
              className="p-1.5 rounded text-hooman-muted hover:bg-hooman-border/50 hover:text-zinc-200"
              aria-label="Next month"
            >
              →
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-hooman-muted mb-2">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-3">
            {days.map((d, i) => {
              const isEmpty = d.getTime() === 0;
              const isCurrent =
                !isEmpty &&
                selectedDate &&
                d.getDate() === selectedDate.getDate() &&
                d.getMonth() === selectedDate.getMonth() &&
                d.getFullYear() === selectedDate.getFullYear();
              const isToday =
                !isEmpty &&
                d.getDate() === new Date().getDate() &&
                d.getMonth() === new Date().getMonth() &&
                d.getFullYear() === new Date().getFullYear();
              return (
                <button
                  key={i}
                  type="button"
                  disabled={isEmpty}
                  onClick={() => handleDayClick(d)}
                  className={`
                    py-1.5 rounded text-sm
                    ${isEmpty ? "invisible" : "hover:bg-hooman-border/50 text-zinc-200"}
                    ${isCurrent ? "bg-hooman-accent/30 text-hooman-accent font-medium" : ""}
                    ${!isEmpty && !isCurrent && isToday ? "ring-1 ring-hooman-accent/50" : ""}
                  `}
                >
                  {isEmpty ? "" : d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-hooman-border">
            <span className="text-xs text-hooman-muted">Time</span>
            <Input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) =>
                handleTimeChange(parseInt(e.target.value, 10) || 0, minute)
              }
              className="w-14 min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-hooman-muted">:</span>
            <Input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(e) =>
                handleTimeChange(hour, parseInt(e.target.value, 10) || 0)
              }
              className="w-14 min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="danger"
                iconOnly
                icon={<X className="w-4 h-4" aria-hidden />}
                onClick={() => setOpen(false)}
                aria-label="Cancel"
              />
              {selectedDate && (
                <Button
                  variant="success"
                  iconOnly
                  icon={<Check className="w-4 h-4" aria-hidden />}
                  onClick={() => {
                    commit(selectedDate, hour, minute);
                    setOpen(false);
                  }}
                  aria-label="Apply"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
