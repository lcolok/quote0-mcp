import React from 'react';
import { motion } from 'framer-motion';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  Clock,
  Star,
  CheckCircle2
} from 'lucide-react';
import Card from './Card';
import StarRating from './StarRating';
import { useFeedbackStore } from '../store/feedbackStore';

const Dashboard: React.FC = () => {
  const { stats, feedbacks } = useFeedbackStore();

  const recentFeedbacks = feedbacks.slice(-3);

  return (
    <div className="space-y-6">
      <Card title="评估统计" icon={BarChart3} delay={0.8}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">总评估次数</span>
            <span className="text-2xl font-bold text-blue-600">
              {stats.totalFeedbacks}
            </span>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">整体质量</span>
              <StarRating 
                value={Math.round(stats.averageScores.overall)} 
                onChange={() => {}} 
                readonly 
                size="sm"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">标题质量</span>
              <StarRating 
                value={Math.round(stats.averageScores.title)} 
                onChange={() => {}} 
                readonly 
                size="sm"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">摘要质量</span>
              <StarRating 
                value={Math.round(stats.averageScores.summary)} 
                onChange={() => {}} 
                readonly 
                size="sm"
              />
            </div>
          </div>

          {stats.recentImprovement !== 0 && (
            <div className={`flex items-center gap-2 p-3 rounded-lg ${
              stats.recentImprovement > 0 
                ? 'bg-green-50 text-green-700' 
                : 'bg-orange-50 text-orange-700'
            }`}>
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">
                {stats.recentImprovement > 0 ? '质量提升' : '需要优化'} 
                {Math.abs(stats.recentImprovement).toFixed(1)} 分
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card title="质量趋势" icon={TrendingUp} delay={0.9}>
        <div className="space-y-3">
          {stats.qualityTrend.length > 0 ? (
            <div className="flex items-end gap-1 h-20">
              {stats.qualityTrend.slice(-10).map((score, index) => (
                <motion.div
                  key={index}
                  initial={{ height: 0 }}
                  animate={{ height: `${(score / 5) * 100}%` }}
                  transition={{ delay: index * 0.1, duration: 0.5 }}
                  className={`flex-1 rounded-t-sm ${
                    score >= 4 ? 'bg-green-400' :
                    score >= 3 ? 'bg-yellow-400' :
                    'bg-red-400'
                  }`}
                  title={`评分: ${score}/5`}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-gray-500 text-sm">
              暂无趋势数据
            </div>
          )}
          <div className="text-xs text-gray-500 text-center">
            最近{Math.min(stats.qualityTrend.length, 10)}次评估
          </div>
        </div>
      </Card>

      {recentFeedbacks.length > 0 && (
        <Card title="最近评估" icon={Clock} delay={1.0}>
          <div className="space-y-3">
            {recentFeedbacks.map((feedback, index) => (
              <motion.div
                key={feedback.taskId}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
              >
                <div className={`p-2 rounded-full ${
                  feedback.overallScore >= 4 ? 'bg-green-100 text-green-600' :
                  feedback.overallScore >= 3 ? 'bg-yellow-100 text-yellow-600' :
                  'bg-red-100 text-red-600'
                }`}>
                  {feedback.overallScore >= 4 ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Star className="w-4 h-4" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">
                    {feedback.reviewer.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(feedback.timestamp).toLocaleDateString('zh-CN')}
                  </div>
                </div>
                <div className="text-sm font-bold text-blue-600">
                  {feedback.overallScore}/5
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      )}

      <Card title="系统状态" icon={Users} delay={1.1}>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-sm text-gray-600">AI模型运行正常</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse"></div>
            <span className="text-sm text-gray-600">数据收集活跃</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-purple-400 rounded-full animate-pulse"></div>
            <span className="text-sm text-gray-600">持续学习优化中</span>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Dashboard;