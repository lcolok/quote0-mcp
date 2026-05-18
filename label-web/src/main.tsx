// 防 FOUC：在 React 渲染前同步给 <html> 加正确的 light/dark class
(() => {
  try {
    const stored = localStorage.getItem('quote0-theme');
    const isSystem = !stored || stored === 'system';
    const isDark = isSystem
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : stored === 'dark';
    document.documentElement.classList.add(isDark ? 'dark' : 'light');
  } catch {
    /* localStorage 不可用时降级到 light */
    document.documentElement.classList.add('light');
  }
})();

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from '@/components/theme-provider';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="quote0-theme">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
