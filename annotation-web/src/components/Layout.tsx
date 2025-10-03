import { useState, useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileEdit,
  BarChart3,
  Download,
  Pin,
  PinOff,
  Zap,
} from 'lucide-react';

function Layout() {
  // 从localStorage读取初始状态
  const [isExpanded, setIsExpanded] = useState(() => {
    const saved = localStorage.getItem('sidebar-expanded');
    return saved !== null ? saved === 'true' : true;
  });

  const [isPinned, setIsPinned] = useState(() => {
    const saved = localStorage.getItem('sidebar-pinned');
    return saved !== null ? saved === 'true' : false;
  });

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: '仪表板' },
    { to: '/annotate', icon: FileEdit, label: '开始标注' },
    { to: '/statistics', icon: BarChart3, label: '统计分析' },
    { to: '/export', icon: Download, label: '导出样本' },
    { to: '/training', icon: Zap, label: 'AX训练' },
  ];

  // 保存状态到localStorage
  useEffect(() => {
    localStorage.setItem('sidebar-expanded', String(isExpanded));
  }, [isExpanded]);

  useEffect(() => {
    localStorage.setItem('sidebar-pinned', String(isPinned));
  }, [isPinned]);

  const togglePin = () => {
    setIsPinned(!isPinned);
    if (!isPinned) {
      setIsExpanded(true); // 固定时自动展开
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside
        className="fixed left-0 top-0 h-full bg-white border-r border-gray-200 transition-transform duration-300 ease-in-out z-40 overflow-hidden shadow-lg"
        style={{
          width: '256px',
          transform: isExpanded ? 'translateX(0)' : 'translateX(-248px)',
        }}
        onMouseEnter={() => !isPinned && setIsExpanded(true)}
        onMouseLeave={() => !isPinned && setIsExpanded(false)}
      >
        <div className="h-full flex flex-col w-64 relative">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-gray-900 truncate">
                  新闻质量标注
                </h2>
                <p className="text-xs text-gray-500 truncate">
                  AX Framework
                </p>
              </div>
              <button
                onClick={togglePin}
                className="ml-2 p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors flex-shrink-0"
                title={isPinned ? '取消固定' : '固定侧边栏'}
              >
                {isPinned ? (
                  <PinOff className="w-4 h-4" />
                ) : (
                  <Pin className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 py-4">
            <div className="space-y-1 px-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center px-3 py-3 rounded-lg transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`
                  }
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span className="ml-3 text-sm font-medium">
                    {item.label}
                  </span>
                </NavLink>
              ))}
            </div>
          </nav>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center whitespace-nowrap">
              © 2025 Quote0 MCP
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  新闻质量标注系统
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                  构建高质量训练样本集
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-8 overflow-auto">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 mt-auto">
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <p className="text-center text-sm text-gray-500">
              AX Quality Annotation System - v1.0
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default Layout;
