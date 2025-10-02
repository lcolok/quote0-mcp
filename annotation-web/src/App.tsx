import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AnnotationPage from './components/AnnotationPage';
import StatisticsPage from './components/StatisticsPage';
import ExportPage from './components/ExportPage';

function App() {
  return (
    <>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="annotate" element={<AnnotationPage />} />
          <Route path="statistics" element={<StatisticsPage />} />
          <Route path="export" element={<ExportPage />} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
