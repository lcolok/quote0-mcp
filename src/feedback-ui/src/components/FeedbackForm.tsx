import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  User, 
  Star, 
  MessageSquare, 
  Hash, 
  Edit3, 
  CheckCircle2,
  AlertCircle,
  Send
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import Card from './Card';
import StarRating from './StarRating';
import { useFeedbackStore } from '../store/feedbackStore';
import { ReviewerInfo, TitleFeedback, SummaryFeedback, ExpertAnnotations } from '../types/feedback';

const FeedbackForm: React.FC = () => {
  const { 
    currentFeedback, 
    updateCurrentFeedback, 
    submitFeedback, 
    isSubmitting 
  } = useFeedbackStore();

  const [reviewer, setReviewer] = useState<ReviewerInfo>({
    name: '',
    expertise: 'technology',
    experience: 0
  });

  const [overallScore, setOverallScore] = useState<number>(3);
  
  const [titleFeedback, setTitleFeedback] = useState<TitleFeedback>({
    score: 3,
    lengthAppropriate: true,
    informationComplete: true,
    readabilityGood: true,
    accuracyGood: true
  });

  const [summaryFeedback, setSummaryFeedback] = useState<SummaryFeedback>({
    score: 3,
    lengthAppropriate: true,
    accuracyGood: true,
    completenessGood: true,
    clarityGood: true
  });

  const [annotations, setAnnotations] = useState<ExpertAnnotations>({
    keyEntities: [],
    coreEvents: [],
    importance: 'medium',
    difficulty: 'medium'
  });

  const [comments, setComments] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!reviewer.name.trim()) {
      toast.error('请填写您的姓名');
      return;
    }

    // 更新完整的反馈数据
    updateCurrentFeedback({
      reviewer,
      overallScore,
      titleFeedback,
      summaryFeedback,
      expertAnnotations: annotations,
      comments: comments.trim() || undefined
    });

    const success = await submitFeedback();
    
    if (success) {
      toast.success('反馈提交成功！感谢您的宝贵意见 🎉');
      // 重置表单
      setReviewer({ name: '', expertise: 'technology', experience: 0 });
      setOverallScore(3);
      setTitleFeedback({
        score: 3,
        lengthAppropriate: true,
        informationComplete: true,
        readabilityGood: true,
        accuracyGood: true
      });
      setSummaryFeedback({
        score: 3,
        lengthAppropriate: true,
        accuracyGood: true,
        completenessGood: true,
        clarityGood: true
      });
      setComments('');
    } else {
      toast.error('提交失败，请重试');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 评估者信息 */}
      <Card title="评估者信息" icon={User} delay={0.2}>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              姓名 *
            </label>
            <input
              type="text"
              value={reviewer.name}
              onChange={(e) => setReviewer({ ...reviewer, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              placeholder="请输入您的姓名"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              专业领域
            </label>
            <select
              value={reviewer.expertise}
              onChange={(e) => setReviewer({ ...reviewer, expertise: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            >
              <option value="journalism">新闻学</option>
              <option value="ai-ml">人工智能/机器学习</option>
              <option value="technology">科技行业</option>
              <option value="linguistics">语言学</option>
              <option value="other">其他</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              工作经验（年）
            </label>
            <input
              type="number"
              value={reviewer.experience}
              onChange={(e) => setReviewer({ ...reviewer, experience: parseInt(e.target.value) || 0 })}
              min="0"
              max="50"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            />
          </div>
        </div>
      </Card>

      {/* 整体评分 */}
      <Card title="整体质量评分" icon={Star} delay={0.3}>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">请对AI输出的整体质量打分:</span>
          <StarRating 
            value={overallScore} 
            onChange={setOverallScore} 
            size="lg" 
          />
        </div>
      </Card>

      {/* 标题评估 */}
      <Card title="标题质量评估" icon={Hash} delay={0.4}>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">标题质量评分:</span>
            <StarRating 
              value={titleFeedback.score} 
              onChange={(score) => setTitleFeedback({ ...titleFeedback, score })} 
            />
          </div>
          
          <div className="grid gap-3 md:grid-cols-2">
            {[
              { key: 'lengthAppropriate', label: '长度合适' },
              { key: 'informationComplete', label: '信息完整' },
              { key: 'readabilityGood', label: '可读性好' },
              { key: 'accuracyGood', label: '准确性高' }
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={titleFeedback[key as keyof TitleFeedback] as boolean}
                  onChange={(e) => setTitleFeedback({ 
                    ...titleFeedback, 
                    [key]: e.target.checked 
                  })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{label}</span>
                {titleFeedback[key as keyof TitleFeedback] ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                )}
              </label>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                改进建议
              </label>
              <textarea
                value={titleFeedback.suggestions || ''}
                onChange={(e) => setTitleFeedback({ 
                  ...titleFeedback, 
                  suggestions: e.target.value 
                })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                placeholder="请提供具体的改进建议..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                改进版本
              </label>
              <textarea
                value={titleFeedback.improvedVersion || ''}
                onChange={(e) => setTitleFeedback({ 
                  ...titleFeedback, 
                  improvedVersion: e.target.value 
                })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                placeholder="请提供您认为更好的标题..."
              />
            </div>
          </div>
        </div>
      </Card>

      {/* 摘要评估 */}
      <Card title="摘要质量评估" icon={Edit3} delay={0.5}>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">摘要质量评分:</span>
            <StarRating 
              value={summaryFeedback.score} 
              onChange={(score) => setSummaryFeedback({ ...summaryFeedback, score })} 
            />
          </div>
          
          <div className="grid gap-3 md:grid-cols-2">
            {[
              { key: 'lengthAppropriate', label: '长度合适' },
              { key: 'accuracyGood', label: '准确性高' },
              { key: 'completenessGood', label: '完整性好' },
              { key: 'clarityGood', label: '表达清晰' }
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={summaryFeedback[key as keyof SummaryFeedback] as boolean}
                  onChange={(e) => setSummaryFeedback({ 
                    ...summaryFeedback, 
                    [key]: e.target.checked 
                  })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{label}</span>
                {summaryFeedback[key as keyof SummaryFeedback] ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                )}
              </label>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                改进建议
              </label>
              <textarea
                value={summaryFeedback.suggestions || ''}
                onChange={(e) => setSummaryFeedback({ 
                  ...summaryFeedback, 
                  suggestions: e.target.value 
                })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                placeholder="请提供具体的改进建议..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                改进版本
              </label>
              <textarea
                value={summaryFeedback.improvedVersion || ''}
                onChange={(e) => setSummaryFeedback({ 
                  ...summaryFeedback, 
                  improvedVersion: e.target.value 
                })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                placeholder="请提供您认为更好的摘要..."
              />
            </div>
          </div>
        </div>
      </Card>

      {/* 专家标注 */}
      <Card title="专家标注" icon={Hash} delay={0.6}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              关键实体（用逗号分隔）
            </label>
            <input
              type="text"
              value={annotations.keyEntities.join(', ')}
              onChange={(e) => setAnnotations({
                ...annotations,
                keyEntities: e.target.value.split(',').map(s => s.trim()).filter(s => s)
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              placeholder="如: SpaceX, Starlink, 马斯克"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              核心事件（用逗号分隔）
            </label>
            <input
              type="text"
              value={annotations.coreEvents.join(', ')}
              onChange={(e) => setAnnotations({
                ...annotations,
                coreEvents: e.target.value.split(',').map(s => s.trim()).filter(s => s)
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              placeholder="如: 卫星发射, 网络扩展, 用户增长"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              重要程度
            </label>
            <select
              value={annotations.importance}
              onChange={(e) => setAnnotations({
                ...annotations,
                importance: e.target.value as any
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            >
              <option value="high">高</option>
              <option value="medium">中等</option>
              <option value="low">低</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              处理难度
            </label>
            <select
              value={annotations.difficulty}
              onChange={(e) => setAnnotations({
                ...annotations,
                difficulty: e.target.value as any
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            >
              <option value="easy">简单</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
          </div>
        </div>
      </Card>

      {/* 其他反馈 */}
      <Card title="其他反馈" icon={MessageSquare} delay={0.7}>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
          placeholder="请分享您的其他意见、建议或观察..."
        />
      </Card>

      {/* 提交按钮 */}
      <motion.button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 px-6 rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {isSubmitting ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            提交中...
          </>
        ) : (
          <>
            <Send className="w-5 h-5" />
            提交反馈
          </>
        )}
      </motion.button>
    </form>
  );
};

export default FeedbackForm;