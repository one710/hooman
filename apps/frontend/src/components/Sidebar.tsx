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
import { HealthBlip } from "./HealthBlip";
import { useDialog } from "./Dialog";
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
  const dialog = useDialog();
  const handleLogout = async () => {
    const ok = await dialog.confirm({
      title: "Log out",
      message: "Are you sure you want to log out?",
      confirmLabel: "Log out",
      variant: "danger",
    });
    if (!ok) return;
    clearToken();
    resetSocket();
    navigate("/login", { replace: true });
  };
  return (
    <aside
      className={`
        w-60 md:w-60 flex flex-col border-r border-hooman-border/80 bg-hooman-surface/80 backdrop-blur-xl
        fixed md:static inset-y-0 left-0 z-40
        transform transition-transform duration-300 ease-out
        shadow-card md:shadow-none
        ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
    >
      <div className="px-4 md:px-5 py-4 border-b border-hooman-border/80 flex items-center justify-between">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.svg"
              alt=""
              className="w-9 h-9 rounded-xl shrink-0 object-contain"
              width={36}
              height={36}
            />
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base md:text-lg font-semibold text-white truncate font-display">
                  Hooman
                </h1>
                <HealthBlip />
              </div>
              <p className="text-xs md:text-sm text-hooman-muted truncate mt-0.5">
                Your virtual identity
              </p>
            </div>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="md:hidden p-2 -mr-2 rounded-xl text-hooman-muted hover:bg-hooman-surface-hover hover:text-zinc-200 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <nav className="flex-1 p-2.5 overflow-y-auto flex flex-col gap-0.5">
        {nav.map((item) => {
          const Icon = item.Icon;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              end={item.path === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-accent-subtle text-hooman-accent-bright shadow-inner border border-hooman-accent/20"
                    : "text-hooman-muted hover:bg-hooman-surface-hover hover:text-zinc-200 border border-transparent"
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden />
              {item.label}
            </NavLink>
          );
        })}
        <div className="mt-[10px] pt-3 border-t border-hooman-border/80 shrink-0">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm text-hooman-muted hover:bg-hooman-surface-hover hover:text-hooman-coral transition-colors duration-200 border border-transparent"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden />
            Log out
          </button>
        </div>
      </nav>
    </aside>
  );
}
