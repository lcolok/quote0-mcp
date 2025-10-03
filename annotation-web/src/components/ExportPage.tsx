import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { Download, CheckCircle, Eye, EyeOff } from 'lucide-react';

function ExportPage() {
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(100);
  const [limit, setLimit] = useState<number | undefined>(undefined);
  const [showPreview, setShowPreview] = useState(false);

  // 预览查询
  const previewQuery = useQuery({
    queryKey: ['export-preview', minScore, maxScore, limit],
    queryFn: () =>
      apiClient.exportSamples({
        minScore,
        maxScore,
        limit: limit || 10, // 预览时最多显示10条
      }),
    enabled: showPreview,
    staleTime: 30000, // 30秒内不重新获取
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      apiClient.exportSamples({
        minScore,
        maxScore,
        limit,
      }),
    onSuccess: (data) => {
      // 下载JSON文件
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training-samples-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });

  const handleExport = () => {
    exportMutation.mutate();
  };

  const togglePreview = () => {
    setShowPreview(!showPreview);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">导出训练样本</h2>
        <p className="text-gray-600 mt-1">
          导出标注数据为AX框架训练样本格式
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        {/* 评分范围 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            评分范围
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">最低分</label>
              <input
                type="number"
                min="0"
                max="100"
                value={minScore}
                onChange={(e) => setMinScore(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">最高分</label>
              <input
                type="number"
                min="0"
                max="100"
                value={maxScore}
                onChange={(e) => setMaxScore(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>
        </div>

        {/* 数量限制 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            数量限制（可选）
          </label>
          <input
            type="number"
            min="1"
            value={limit || ''}
            onChange={(e) =>
              setLimit(e.target.value ? parseInt(e.target.value) : undefined)
            }
            placeholder="留空表示导出所有符合条件的样本"
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        {/* 按钮组 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 预览按钮 */}
          <button
            onClick={togglePreview}
            className="flex items-center justify-center px-6 py-3 bg-gray-100 text-gray-700 font-medium rounded-md hover:bg-gray-200"
          >
            {showPreview ? (
              <>
                <EyeOff className="w-5 h-5 mr-2" />
                隐藏预览
              </>
            ) : (
              <>
                <Eye className="w-5 h-5 mr-2" />
                预览JSON
              </>
            )}
          </button>

          {/* 导出按钮 */}
          <button
            onClick={handleExport}
            disabled={exportMutation.isPending}
            className="flex items-center justify-center px-6 py-3 bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportMutation.isPending ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                导出中...
              </>
            ) : (
              <>
                <Download className="w-5 h-5 mr-2" />
                导出为JSON
              </>
            )}
          </button>
        </div>

        {/* 成功提示 */}
        {exportMutation.isSuccess && (
          <div className="flex items-center justify-center text-green-600 text-sm">
            <CheckCircle className="w-5 h-5 mr-2" />
            导出成功！文件已自动下载
          </div>
        )}

        {/* 错误提示 */}
        {exportMutation.isError && (
          <div className="text-red-600 text-sm text-center">
            导出失败: {(exportMutation.error as Error).message}
          </div>
        )}
      </div>

      {/* JSON预览区域 */}
      {showPreview && (
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="text-lg font-semibold text-gray-900">JSON预览</h3>
            <p className="text-sm text-gray-600 mt-1">
              {previewQuery.isLoading && '正在加载...'}
              {previewQuery.data && `显示前 ${Math.min(previewQuery.data.length, 10)} 条样本`}
            </p>
          </div>

          <div className="p-6">
            {previewQuery.isLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              </div>
            )}

            {previewQuery.isError && (
              <div className="text-red-600 text-sm text-center py-12">
                预览失败: {(previewQuery.error as Error).message}
              </div>
            )}

            {previewQuery.data && (
              <div className="space-y-4">
                {/* 数据统计 */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">总样本数:</span>
                      <span className="ml-2 font-semibold text-gray-900">
                        {previewQuery.data.length}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">含人工优化:</span>
                      <span className="ml-2 font-semibold text-green-600">
                        {previewQuery.data.filter((s: any) => s.optimized_title || s.optimized_summary).length}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">含LLM处理:</span>
                      <span className="ml-2 font-semibold text-blue-600">
                        {previewQuery.data.filter((s: any) => s.processed_title || s.processed_summary).length}
                      </span>
                    </div>
                  </div>
                </div>

                {/* JSON代码 */}
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-xs max-h-[600px] overflow-y-auto">
                  {JSON.stringify(previewQuery.data, null, 2)}
                </pre>

                {/* 复制按钮 */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(previewQuery.data, null, 2));
                  }}
                  className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
                >
                  复制到剪贴板
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">导出格式说明</h3>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>✨ <strong>三层数据结构</strong>: original (原始) → processed (LLM) → optimized (人工)</li>
          <li>📊 <strong>训练优先级</strong>: 人工优化 &gt; LLM处理 &gt; 原始内容</li>
          <li>🎯 <strong>输入输出分离</strong>: 输入使用original，输出优先使用optimized</li>
          <li>💾 建议定期备份导出的样本集</li>
        </ul>
      </div>
    </div>
  );
}

export default ExportPage;
