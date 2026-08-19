import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import Layout from './components/Layout';

const Dashboard = lazy(() => import('./components/Dashboard'));
const AnnotationPage = lazy(() => import('./components/AnnotationPage'));
const ExportPage = lazy(() => import('./components/ExportPage'));
const EvaluationPage = lazy(() => import('./components/EvaluationPage'));
const SchedulerPage = lazy(() => import('./components/SchedulerPage'));
const SourcesPage = lazy(() => import('./components/SourcesPage'));
const LLMProvidersPage = lazy(() => import('./components/LLMProvidersPage'));
const DeviceManagementPage = lazy(() => import('./components/DeviceManagementPage'));
const InventoryPage = lazy(() => import('./components/InventoryPage'));
const JobsManagementPage = lazy(() => import('./components/JobsManagementPage'));

function App() {
  return (
    <>
      <Toaster position="top-right" richColors />
      <Suspense fallback={(
        <div className="min-h-screen flex items-center justify-center text-gray-500">
          正在加载工作台…
        </div>
      )}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="annotate" element={<AnnotationPage />} />
            <Route path="export" element={<ExportPage />} />
            <Route path="evaluation" element={<EvaluationPage />} />
            <Route path="training" element={<Navigate to="/evaluation" replace />} />
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
