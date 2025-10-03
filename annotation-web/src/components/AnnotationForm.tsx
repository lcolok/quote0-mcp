import { useState } from 'react';
import type { QualityAnnotation } from '../types';
import { X } from 'lucide-react';

interface AnnotationFormProps {
  onSubmit: (annotation: Omit<QualityAnnotation, 'id' | 'news_id'>) => void;
  isSubmitting: boolean;
  initialData?: Partial<QualityAnnotation>;
}

function AnnotationForm({ onSubmit, isSubmitting, initialData }: AnnotationFormProps) {
  const [overallScore, setOverallScore] = useState(initialData?.overall_score || 50);
  const [newsValue, setNewsValue] = useState(initialData?.news_value || 50);
  const [practicality, setPracticality] = useState(initialData?.practicality || 50);
  const [density, setDensity] = useState(initialData?.density || 50);
  const [timeliness, setTimeliness] = useState(initialData?.timeliness || 50);
  const [universality, setUniversality] = useState(initialData?.universality || 50);
  const [reason, setReason] = useState(initialData?.reason || '');
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [newTag, setNewTag] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | undefined>(
    initialData?.difficulty
  );
  const [confidence, setConfidence] = useState(initialData?.confidence || 80);

  // 优化内容字段
  const [optimizedTitle, setOptimizedTitle] = useState(initialData?.optimized_title || '');
  const [optimizedSummary, setOptimizedSummary] = useState(initialData?.optimized_summary || '');
  const [optimizedContent, setOptimizedContent] = useState(initialData?.optimized_content || '');

  // 计算分类
  const getCategory = (score: number): 'high' | 'medium' | 'low' => {
    if (score >= 75) return 'high';
    if (score >= 55) return 'medium';
    return 'low';
  };

  // 添加标签
  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
  };

  // 删除标签
  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  // 提交表单
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const annotation: Omit<QualityAnnotation, 'id' | 'news_id'> = {
      overall_score: overallScore,
      category: getCategory(overallScore),
      should_filter: overallScore < 55,
      news_value: newsValue,
      practicality,
      density,
      timeliness,
      universality,
      reason: reason.trim(),
      tags,
      difficulty,
      confidence,
      annotator: 'human',

      // 优化内容（可选）
      optimized_title: optimizedTitle.trim() || undefined,
      optimized_summary: optimizedSummary.trim() || undefined,
      optimized_content: optimizedContent.trim() || undefined,
    };

    onSubmit(annotation);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 综合评分 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          综合评分: <span className="text-2xl font-bold text-primary-600">{overallScore}</span>
          <span className="ml-2 text-xs text-gray-500">
            ({getCategory(overallScore) === 'high' && '高质量'}
            {getCategory(overallScore) === 'medium' && '中等质量'}
            {getCategory(overallScore) === 'low' && '低质量'})
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={overallScore}
          onChange={(e) => setOverallScore(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>

      {/* 五维度评分 */}
      <div className="border-t border-gray-200 pt-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">详细维度评分</h4>
        <div className="space-y-4">
          <DimensionSlider
            label="新闻性"
            value={newsValue}
            onChange={setNewsValue}
            description="是否为真正的新闻事件"
          />
          <DimensionSlider
            label="实用性"
            value={practicality}
            onChange={setPracticality}
            description="对读者的参考价值"
          />
          <DimensionSlider
            label="信息密度"
            value={density}
            onChange={setDensity}
            description="信息量和深度"
          />
          <DimensionSlider
            label="时效性"
            value={timeliness}
            onChange={setTimeliness}
            description="新闻的时效价值"
          />
          <DimensionSlider
            label="普适性"
            value={universality}
            onChange={setUniversality}
            description="受众广度"
          />
        </div>
      </div>

      {/* 标注理由 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          标注理由 <span className="text-red-500">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={3}
          maxLength={200}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          placeholder="请简要说明评分理由（建议50字以内）"
        />
        <p className="text-xs text-gray-500 mt-1">{reason.length}/200 字符</p>
      </div>

      {/* 标签 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">标签</label>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag();
              }
            }}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
            placeholder="输入标签，按回车添加"
          />
          <button
            type="button"
            onClick={handleAddTag}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
          >
            添加
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-primary-100 text-primary-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="ml-2 text-primary-600 hover:text-primary-800"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* 优化内容 - 用于AX训练 */}
      <div className="border-t border-gray-200 pt-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">
            ✨ 内容优化（可选 - 用于AX训练）
          </h3>
          <p className="text-xs text-gray-600">
            填写优化后的标题和摘要，用于训练AX模型学习如何改进内容
          </p>
        </div>

        <div className="space-y-4">
          {/* 优化标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              优化后的标题
            </label>
            <input
              type="text"
              value={optimizedTitle}
              onChange={(e) => setOptimizedTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
              placeholder="如何改进标题？更吸引人、更准确、更简洁..."
            />
          </div>

          {/* 优化摘要 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              优化后的摘要
            </label>
            <textarea
              value={optimizedSummary}
              onChange={(e) => setOptimizedSummary(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
              placeholder="改进后的摘要：提取关键信息、优化表达、控制长度..."
            />
          </div>

          {/* 优化正文（可选） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              优化后的正文（可选）
            </label>
            <textarea
              value={optimizedContent}
              onChange={(e) => setOptimizedContent(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
              placeholder="完整优化后的正文内容（可选填）"
            />
          </div>
        </div>
      </div>

      {/* 难度和信心度 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">标注难度</label>
          <select
            value={difficulty || ''}
            onChange={(e) =>
              setDifficulty((e.target.value as 'easy' | 'medium' | 'hard') || undefined)
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">未选择</option>
            <option value="easy">简单</option>
            <option value="medium">中等</option>
            <option value="hard">困难</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            信心度: {confidence}%
          </label>
          <input
            type="range"
            min="0"
            max="100"
            step="10"
            value={confidence}
            onChange={(e) => setConfidence(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
          />
        </div>
      </div>

      {/* 提交按钮 */}
      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={isSubmitting || !reason.trim()}
          className="flex-1 px-6 py-3 bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? '提交中...' : '提交标注'}
        </button>
      </div>
    </form>
  );
}

interface DimensionSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  description: string;
}

function DimensionSlider({ label, value, onChange, description }: DimensionSliderProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-600">{label}</label>
        <span className="text-xs font-bold text-gray-900">{value}</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
      />
      <p className="text-xs text-gray-500 mt-0.5">{description}</p>
    </div>
  );
}

export default AnnotationForm;
