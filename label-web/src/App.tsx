import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import DesignPage from '@/pages/DesignPage';
import HistoryPage from '@/pages/HistoryPage';
import DetailPage from '@/pages/DetailPage';

function App() {
  return (
    <>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/" element={<DesignPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/labels/:id" element={<DetailPage />} />
      </Routes>
    </>
  );
}

export default App;
