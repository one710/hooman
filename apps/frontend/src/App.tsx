import { useState } from "react";
import { Menu } from "lucide-react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { Chat } from "./components/Chat";
import { Channels } from "./components/Channels";
import { Sidebar } from "./components/Sidebar";
import { Schedule } from "./components/Schedule";
import { Audit } from "./components/Audit";
import { Safety } from "./components/Safety";
import { Capabilities } from "./components/Capabilities";
import { Settings } from "./components/Settings";
import { Login } from "./components/Login";
import type { View } from "./types";

const VIEW_LABELS: Record<View, string> = {
  chat: "Chat",
  channels: "Channels",
  schedule: "Schedule",
  audit: "Audit log",
  safety: "Safety",
  capabilities: "Capabilities",
  settings: "Settings",
};

const PATH_TO_VIEW: Record<string, View> = {
  "/": "chat",
  "/chat": "chat",
  "/channels": "channels",
  "/schedule": "schedule",
  "/audit": "audit",
  "/safety": "safety",
  "/capabilities": "capabilities",
  "/settings": "settings",
};

function pathnameToView(pathname: string): View {
  return PATH_TO_VIEW[pathname] ?? "chat";
}

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const view = pathnameToView(location.pathname);

  return (
    <div className="flex h-screen bg-hooman-bg text-zinc-200 overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="md:hidden shrink-0 flex items-center gap-3 px-4 py-3 border-b border-hooman-border bg-hooman-surface">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-lg text-zinc-400 hover:bg-hooman-border/50 hover:text-zinc-200"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-medium text-white">{VIEW_LABELS[view]}</span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Chat />} />
        <Route path="chat" element={<Navigate to="/" replace />} />
        <Route path="channels" element={<Channels />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="audit" element={<Audit />} />
        <Route path="safety" element={<Safety />} />
        <Route path="capabilities" element={<Capabilities />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
