import React from 'react';
import { motion } from 'framer-motion';
import { Bot, Clock, Hash } from 'lucide-react';
import Card from './Card';
import { AIOutput, NewsInput } from '../types/feedback';

interface AIOutputDisplayProps {
  newsInput: NewsInput;
  aiOutput: AIOutput;
}

const AIOutputDisplay: React.FC<AIOutputDisplayProps> = ({ newsInput, aiOutput }) => {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card title="原始新闻内容" icon={Hash} delay={0}>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-100">
          <p className="text-gray-700 leading-relaxed text-sm">
            {newsInput.originalNews}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
              {newsInput.category === 'technology' ? '科技' : newsInput.category}
            </span>
          </div>
        </div>
      </Card>

      <Card title="AI生成结果" icon={Bot} delay={0.1}>
        <div className="space-y-4">
          <motion.div 
            className="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-lg border border-green-100"
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-600">AI生成标题</span>
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                {aiOutput.title.length}字符
              </span>
            </div>
            <p className="font-medium text-gray-800">{aiOutput.title}</p>
          </motion.div>

          <motion.div 
            className="bg-gradient-to-br from-purple-50 to-violet-50 p-4 rounded-lg border border-purple-100"
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-600">AI生成摘要</span>
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                {aiOutput.summary.length}字符
              </span>
            </div>
            <p className="text-gray-700 text-sm leading-relaxed">{aiOutput.summary}</p>
          </motion.div>

          {aiOutput.processingTime && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock className="w-3 h-3" />
              <span>处理时间: {aiOutput.processingTime}ms</span>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default AIOutputDisplay;