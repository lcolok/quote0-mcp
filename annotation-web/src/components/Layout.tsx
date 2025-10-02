import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileEdit,
  BarChart3,
  Download,
} from 'lucide-react';

function Layout() {
  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: '仪表板' },
    { to: '/annotate', icon: FileEdit, label: '开始标注' },
    { to: '/statistics', icon: BarChart3, label: '统计分析' },
    { to: '/export', icon: Download, label: '导出样本' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                新闻质量标注系统
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                AX Framework - 构建高质量训练样本集
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center px-3 py-4 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`
                }
              >
                <item.icon className="w-5 h-5 mr-2" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-gray-500">
            © 2025 Quote0 MCP - AX Quality Annotation System
          </p>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
