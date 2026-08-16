import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import Layout from './components/Layout';
import { useTheme } from './theme';

const Dashboard = lazy(() => import('./components/Dashboard'));
const AnnotationPage = lazy(() => import('./components/AnnotationPage'));
const ExportPage = lazy(() => import('./components/ExportPage'));
const TrainingPage = lazy(() => import('./components/TrainingPage'));
const SchedulerPage = lazy(() => import('./components/SchedulerPage'));
const SourcesPage = lazy(() => import('./components/SourcesPage'));
const LLMProvidersPage = lazy(() => import('./components/LLMProvidersPage'));
const DeviceManagementPage = lazy(() => import('./components/DeviceManagementPage'));
const InventoryPage = lazy(() => import('./components/InventoryPage'));
const JobsManagementPage = lazy(() => import('./components/JobsManagementPage'));

function AppFallback() {
  return (
    <div className="flex min-h-64 items-center justify-center text-sm text-[var(--text-muted)]">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-5 py-3 shadow-[var(--shadow-soft)]">
        <span className="size-4 animate-spin rounded-full border-2 border-primary-500/30 border-t-primary-500" />
        正在加载工作台…
      </div>
    </div>
  );
}

function App() {
  const { resolvedTheme } = useTheme();

  return (
    <>
      <Toaster
        position="top-right"
        richColors
        theme={resolvedTheme}
        toastOptions={{
          className: 'border border-[var(--border-subtle)] shadow-[var(--shadow-float)]',
        }}
      />
      <Suspense fallback={<AppFallback />}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="annotate" element={<AnnotationPage />} />
            <Route path="export" element={<ExportPage />} />
            <Route path="training" element={<TrainingPage />} />
            <Route path="scheduler" element={<SchedulerPage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="llm-providers" element={<LLMProvidersPage />} />
            <Route path="devices" element={<DeviceManagementPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="jobs" element={<JobsManagementPage />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}

export default App;
