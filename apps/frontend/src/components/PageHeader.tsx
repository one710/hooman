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
    <header className="border-b border-hooman-border/80 px-4 md:px-6 py-3 md:py-4 flex justify-between items-center gap-3 shrink-0 bg-hooman-bg-elevated/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="md:hidden p-2.5 -ml-2 rounded-xl text-hooman-muted hover:bg-hooman-surface-hover hover:text-hooman-accent transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white truncate font-display">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs md:text-sm text-hooman-muted truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children}
    </header>
  );
}
