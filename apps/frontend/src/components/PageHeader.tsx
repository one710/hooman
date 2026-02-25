import { Menu } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

interface LayoutContext {
  setSidebarOpen: (open: boolean) => void;
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  const { setSidebarOpen } = useOutletContext<LayoutContext>();

  return (
    <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 flex justify-between items-center gap-3 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="md:hidden p-2 -ml-2 rounded-lg text-zinc-400 hover:bg-hooman-border/50 hover:text-zinc-200"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs md:text-sm text-hooman-muted truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children}
    </header>
  );
}
