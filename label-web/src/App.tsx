import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { PenLine, History, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import DesignPage from '@/pages/DesignPage';
import HistoryPage from '@/pages/HistoryPage';
import DetailPage from '@/pages/DetailPage';
import MemoPage from '@/pages/MemoPage';
import { ThemeToggle } from '@/components/theme-toggle';
import { useTheme } from '@/components/theme-provider';

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

function App() {
  const { resolvedTheme } = useTheme();
  return (
    <>
      <Toaster position="top-right" richColors theme={resolvedTheme} />
      <div className="fixed top-3 right-3 z-50">
        <ThemeToggle />
      </div>
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-4 h-12 flex items-center gap-2">
          <span className="text-sm font-bold text-foreground mr-2">Quote0</span>
          <NavLink to="/" icon={<PenLine className="h-4 w-4" />} label="设计" />
          <NavLink to="/history" icon={<History className="h-4 w-4" />} label="历史" />
          <NavLink to="/memos" icon={<StickyNote className="h-4 w-4" />} label="备忘" />
        </div>
      </header>
      <main className="pt-2">
        <Routes>
          <Route path="/" element={<DesignPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/labels/:id" element={<DetailPage />} />
          <Route path="/memos" element={<MemoPage />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
