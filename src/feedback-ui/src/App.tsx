import React, { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { motion } from 'framer-motion';
import { Brain, Database, TrendingUp } from 'lucide-react';
import FeedbackForm from './components/FeedbackForm';
import AIOutputDisplay from './components/AIOutputDisplay';
import Dashboard from './components/Dashboard';
import { useFeedbackStore } from './store/feedbackStore';
import './App.css';

function App() {
  const { currentNews, currentAIOutput, loadMockData } = useFeedbackStore();

  useEffect(() => {
    loadMockData();
  }, [loadMockData]);

  return (
    <div className="min-h-screen animated-bg">
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
        }}
      />
      
      <div className="container mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-12"
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl">
              <Brain className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold gradient-text">
              AX Framework 新闻AI评估系统
            </h1>
          </div>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            为AI生成的新闻标题和摘要提供专业评估，帮助持续优化模型质量
          </p>
        </motion.div>

        {currentNews && currentAIOutput ? (
          <div className="space-y-8">
            <AIOutputDisplay 
              newsInput={currentNews} 
              aiOutput={currentAIOutput} 
            />
            
            <div className="grid gap-8 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <FeedbackForm />
              </div>
              <div className="lg:col-span-1">
                <Dashboard />
              </div>
            </div>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">正在加载评估数据...</p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default App;