import { NavLink, useNavigate } from "react-router-dom";
import {
  MessageCircle,
  Radio,
  Clock,
  ClipboardList,
  Shield,
  Plug,
  Settings,
  LogOut,
  X,
  type LucideIcon,
} from "lucide-react";
import { clearToken } from "../auth";
import { resetSocket } from "../socket";
import type { View } from "../types";

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

const nav: { id: View; label: string; path: string; Icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", path: "/", Icon: MessageCircle },
  { id: "channels", label: "Channels", path: "/channels", Icon: Radio },
  { id: "schedule", label: "Schedule", path: "/schedule", Icon: Clock },
  { id: "audit", label: "Audit log", path: "/audit", Icon: ClipboardList },
  { id: "safety", label: "Safety", path: "/safety", Icon: Shield },
  {
    id: "capabilities",
    label: "Capabilities",
    path: "/capabilities",
    Icon: Plug,
  },
  { id: "settings", label: "Settings", path: "/settings", Icon: Settings },
];

export function Sidebar({ open = true, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const handleLogout = () => {
    clearToken();
    resetSocket();
    navigate("/login", { replace: true });
  };
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
            <NavLink
              key={item.id}
              to={item.path}
              end={item.path === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                  isActive
                    ? "bg-hooman-accent/20 text-hooman-accent"
                    : "text-zinc-400 hover:bg-hooman-border/50 hover:text-zinc-200"
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden />
              {item.label}
            </NavLink>
          );
        })}
        <div className="mt-2 pt-2 border-t border-hooman-border">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-zinc-400 hover:bg-hooman-border/50 hover:text-zinc-200 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden />
            Log out
          </button>
        </div>
      </nav>
    </aside>
  );
}
