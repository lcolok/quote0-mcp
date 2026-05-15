import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AnnotationPage from './components/AnnotationPage';
import ExportPage from './components/ExportPage';
import TrainingPage from './components/TrainingPage';
import SchedulerPage from './components/SchedulerPage';
import SourcesPage from './components/SourcesPage';
import LLMProvidersPage from './components/LLMProvidersPage';

function App() {
  return (
    <>
      <Toaster position="top-right" richColors />
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
        </Route>
      </Routes>
    </>
  );
}

export default App;
