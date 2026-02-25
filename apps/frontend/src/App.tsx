import { useState } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Chat } from "./components/Chat";
import { Channels } from "./components/Channels";
import { Sidebar } from "./components/Sidebar";
import { Schedule } from "./components/Schedule";
import { Audit } from "./components/Audit";
import { Safety } from "./components/Safety";
import { Capabilities } from "./components/Capabilities";
import { Settings } from "./components/Settings";
import { Login } from "./components/Login";

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        <Outlet context={{ setSidebarOpen }} />
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
