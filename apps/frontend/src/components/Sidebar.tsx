import {
  MessageCircle,
  Radio,
  Clock,
  ClipboardList,
  Shield,
  Plug,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import type { View } from "../types";

interface SidebarProps {
  view: View;
  setView: (v: View) => void;
  open?: boolean;
  onClose?: () => void;
}

const nav: { id: View; label: string; Icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", Icon: MessageCircle },
  { id: "channels", label: "Channels", Icon: Radio },
  { id: "schedule", label: "Schedule", Icon: Clock },
  { id: "audit", label: "Audit log", Icon: ClipboardList },
  { id: "safety", label: "Safety", Icon: Shield },
  { id: "capabilities", label: "Capabilities", Icon: Plug },
  { id: "settings", label: "Settings", Icon: Settings },
];

export function Sidebar({ view, setView, open = true, onClose }: SidebarProps) {
  return (
    <aside
      className={`
        w-56 md:w-56 flex flex-col border-r border-hooman-border bg-hooman-surface
        fixed md:static inset-y-0 left-0 z-40
        transform transition-transform duration-200 ease-out
        ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
    >
      <div className="p-4 border-b border-hooman-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Hooman</h1>
          <p className="text-xs text-hooman-muted mt-0.5">
            Your virtual identity
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="md:hidden p-2 -mr-2 rounded-lg text-zinc-400 hover:bg-hooman-border/50 hover:text-zinc-200"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <nav className="flex-1 p-2 overflow-y-auto">
        {nav.map((item) => {
          const Icon = item.Icon;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                view === item.id
                  ? "bg-hooman-accent/20 text-hooman-accent"
                  : "text-zinc-400 hover:bg-hooman-border/50 hover:text-zinc-200"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
