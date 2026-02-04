import { useState, useEffect, useCallback } from "react";
import { Menu } from "lucide-react";
import { Chat } from "./components/Chat";
import { Sidebar } from "./components/Sidebar";
import { Colleagues } from "./components/Colleagues";
import { Schedule } from "./components/Schedule";
import { Audit } from "./components/Audit";
import { Safety } from "./components/Safety";
import { Settings } from "./components/Settings";
import { getChatHistory, clearChatHistory } from "./api";
import type { View } from "./types";
import type { ChatMessage } from "./types";

const CHAT_PAGE_SIZE = 50;

const VIEW_LABELS: Record<View, string> = {
  chat: "Chat",
  colleagues: "Colleagues",
  schedule: "Schedule",
  audit: "Audit log",
  safety: "Safety",
  settings: "Settings",
};

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatTotal, setChatTotal] = useState(0);
  const [chatPage, setChatPage] = useState(1);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    getChatHistory({ page: 1, pageSize: CHAT_PAGE_SIZE }).then((r) => {
      setChatMessages(r.messages ?? []);
      setChatTotal(r.total ?? 0);
      setChatPage(1);
    });
  }, []);

  const loadOlderChat = useCallback(() => {
    if (loadingOlder || chatTotal <= chatMessages.length) return;
    setLoadingOlder(true);
    getChatHistory({ page: chatPage + 1, pageSize: CHAT_PAGE_SIZE })
      .then((r) => {
        setChatMessages((prev) => [...(r.messages ?? []), ...prev]);
        setChatTotal(r.total ?? 0);
        setChatPage((p) => p + 1);
      })
      .finally(() => setLoadingOlder(false));
  }, [chatPage, chatTotal, chatMessages.length, loadingOlder]);

  const handleClearChat = useCallback(async () => {
    const { cleared } = await clearChatHistory();
    if (cleared) {
      setChatMessages([]);
      setChatTotal(0);
      setChatPage(1);
    }
  }, []);

  const setViewAndCloseSidebar = useCallback((v: View) => {
    setView(v);
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex h-screen bg-hooman-bg text-zinc-200 overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      <Sidebar
        view={view}
        setView={setViewAndCloseSidebar}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Mobile top bar: menu + view title */}
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
        {view === "chat" && (
          <Chat
            messages={chatMessages}
            setMessages={setChatMessages}
            hasMoreOlder={chatTotal > chatMessages.length}
            onLoadOlder={loadOlderChat}
            loadingOlder={loadingOlder}
            onClearChat={handleClearChat}
          />
        )}
        {view === "colleagues" && <Colleagues />}
        {view === "schedule" && <Schedule />}
        {view === "audit" && <Audit />}
        {view === "safety" && <Safety />}
        {view === "settings" && <Settings />}
      </main>
    </div>
  );
}
