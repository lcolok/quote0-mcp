import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import DesignPage from '@/pages/DesignPage';
import HistoryPage from '@/pages/HistoryPage';
import DetailPage from '@/pages/DetailPage';
import { ThemeToggle } from '@/components/theme-toggle';
import { useTheme } from '@/components/theme-provider';

function App() {
  const { resolvedTheme } = useTheme();
  return (
    <>
      <Toaster
        position="top-right"
        richColors
        theme={resolvedTheme}
      />
      <div className="fixed top-3 right-3 z-50">
        <ThemeToggle />
      </div>
      <Routes>
        <Route path="/" element={<DesignPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/labels/:id" element={<DetailPage />} />
      </Routes>
    </>
  );
}

export default App;
