import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AnnotationPage from './components/AnnotationPage';
import StatisticsPage from './components/StatisticsPage';
import ExportPage from './components/ExportPage';
import ImportPage from './components/ImportPage';
import ImportHistoryPage from './components/ImportHistoryPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="annotate" element={<AnnotationPage />} />
        <Route path="statistics" element={<StatisticsPage />} />
        <Route path="export" element={<ExportPage />} />
        <Route path="import" element={<ImportHistoryPage />} />
        <Route path="import/rss" element={<ImportPage />} />
      </Route>
    </Routes>
  );
}

export default App;
