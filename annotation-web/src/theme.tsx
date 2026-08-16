import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'quote0-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function subscribeToSystemTheme(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const media = window.matchMedia(MEDIA_QUERY);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function getSystemThemeSnapshot() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

function applyTheme(mode: ThemeMode, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolvedTheme === 'dark');
  root.dataset.theme = mode;
  root.style.colorScheme = resolvedTheme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);
  const systemDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemThemeSnapshot,
    () => false,
  );
  const resolvedTheme: ResolvedTheme = mode === 'system'
    ? (systemDark ? 'dark' : 'light')
    : mode;

  useEffect(() => {
    applyTheme(mode, resolvedTheme);
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode, resolvedTheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    resolvedTheme,
    setMode,
    cycleMode: () => {
      setMode((current) => current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system');
    },
  }), [mode, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}

const THEME_META: Record<ThemeMode, { label: string; icon: typeof Sun }> = {
  system: { label: '跟随系统', icon: Monitor },
  light: { label: '浅色', icon: Sun },
  dark: { label: '深色', icon: Moon },
};

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, cycleMode } = useTheme();
  const meta = THEME_META[mode];
  const Icon = meta.icon;

  return (
    <button
      type="button"
      onClick={cycleMode}
      className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 text-sm font-medium text-[var(--text-secondary)] shadow-[var(--shadow-soft)] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-[var(--ease-snappy)] hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      aria-label={`主题：${meta.label}，点击切换`}
      title={`主题：${meta.label}`}
    >
      <Icon className="size-4 transition-transform duration-300 ease-[var(--ease-fluid)] group-hover:rotate-6 motion-reduce:transform-none" />
      {!compact && <span className="hidden sm:inline">{meta.label}</span>}
    </button>
  );
}
