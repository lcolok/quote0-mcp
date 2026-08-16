import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Brain,
  Calendar,
  Download,
  FileEdit,
  LayoutDashboard,
  Menu,
  MonitorSmartphone,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Settings2,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { ThemeToggle } from '../theme';

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: '仪表板', hint: '运行总览' },
  { to: '/annotate', icon: FileEdit, label: '开始标注', hint: '内容评审' },
  { to: '/export', icon: Download, label: '导出样本', hint: '反馈样本' },
  { to: '/training', icon: Zap, label: 'AX训练', hint: '历史实验' },
  { to: '/scheduler', icon: Calendar, label: '调度器', hint: '自动任务' },
  { to: '/jobs', icon: Settings2, label: '任务管理', hint: '执行状态' },
  { to: '/sources', icon: Settings, label: 'RSS源管理', hint: '信源治理' },
  { to: '/llm-providers', icon: Brain, label: 'LLM 切换', hint: '模型路由' },
  { to: '/devices', icon: MonitorSmartphone, label: '设备管理', hint: '墨水屏' },
  { to: '/inventory', icon: Package, label: '素材库', hint: '内容库存' },
] as const;

function Layout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    const saved = localStorage.getItem('quote0-sidebar-collapsed');
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('quote0-sidebar-collapsed', String(desktopCollapsed));
  }, [desktopCollapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const currentPage = useMemo(
    () => NAV_ITEMS.find((item) => location.pathname.startsWith(item.to)) ?? NAV_ITEMS[0],
    [location.pathname],
  );

  const sidebarContent = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-20 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 pt-[env(safe-area-inset-top)] lg:pt-0">
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-black tracking-tight text-white shadow-lg shadow-primary-600/20">
          Q0
        </div>
        <div className={`min-w-0 flex-1 transition-opacity duration-200 ${desktopCollapsed ? 'lg:hidden' : ''}`}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-300">
            <Sparkles className="size-3" />
            Review Console
          </div>
          <h2 className="mt-0.5 truncate text-[15px] font-semibold text-[var(--text-primary)]">Quote0 内容工作台</h2>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="grid size-11 shrink-0 place-items-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] lg:hidden"
          aria-label="关闭导航"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={desktopCollapsed ? item.label : undefined}
              className={({ isActive }) => [
                'group flex min-h-12 items-center rounded-xl border px-3 transition-[background-color,border-color,color,transform] duration-200 ease-[var(--ease-snappy)] motion-reduce:transition-none',
                desktopCollapsed ? 'lg:justify-center lg:px-0' : 'gap-3',
                isActive
                  ? 'border-primary-500/15 bg-[var(--brand-soft)] text-primary-700 dark:text-primary-300'
                  : 'border-transparent text-[var(--text-secondary)] hover:translate-x-0.5 hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] motion-reduce:transform-none',
              ].join(' ')}
            >
              <item.icon className="size-5 shrink-0" strokeWidth={1.9} />
              <span className={`min-w-0 flex-1 ${desktopCollapsed ? 'lg:hidden' : ''}`}>
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                <span className="block truncate text-[11px] text-[var(--text-muted)]">{item.hint}</span>
              </span>
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-[var(--border-subtle)] p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:pb-3">
        <div className={`rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-xs text-[var(--text-muted)] ${desktopCollapsed ? 'lg:hidden' : ''}`}>
          <p className="font-medium text-[var(--text-secondary)]">Quote0 MCP</p>
          <p className="mt-0.5">内容评审 · 发布 · 设备治理</p>
        </div>
        <button
          type="button"
          onClick={() => setDesktopCollapsed((value) => !value)}
          className="mt-2 hidden min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] lg:flex"
          aria-label={desktopCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {desktopCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!desktopCollapsed && <span>收起导航</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
      <button
        type="button"
        aria-label="关闭导航遮罩"
        onClick={() => setMobileOpen(false)}
        className={`fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px] transition-opacity duration-300 ease-[var(--ease-fluid)] lg:hidden ${
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[min(86vw,19rem)] border-r border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-float)] backdrop-blur-xl transition-transform duration-300 ease-[var(--ease-fluid)] lg:relative lg:z-20 lg:shrink-0 lg:translate-x-0 lg:shadow-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${desktopCollapsed ? 'lg:w-[5.25rem]' : 'lg:w-72'}`}
      >
        {sidebarContent}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-30 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-glass)] pt-[env(safe-area-inset-top)] backdrop-blur-2xl lg:pt-0">
          <div className="flex min-h-16 items-center gap-3 px-3 sm:px-5 lg:px-7">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)] shadow-[var(--shadow-soft)] transition-[transform,background-color] duration-200 active:scale-95 lg:hidden motion-reduce:transform-none"
              aria-label="打开导航"
              aria-expanded={mobileOpen}
            >
              <Menu className="size-5" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Quote0 · Review</p>
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-base font-semibold sm:text-lg">{currentPage.label}</h1>
                <span className="hidden rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] sm:inline">{currentPage.hint}</span>
              </div>
            </div>

            <ThemeToggle compact={false} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5 sm:py-5 lg:px-7 lg:py-6">
          <div className="surface-enter mx-auto w-full max-w-[1800px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
