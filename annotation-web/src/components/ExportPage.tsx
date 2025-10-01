import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { Download, CheckCircle } from 'lucide-react';

function ExportPage() {
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(100);
  const [limit, setLimit] = useState<number | undefined>(undefined);

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

        {/* 导出按钮 */}
        <button
          onClick={handleExport}
          disabled={exportMutation.isPending}
          className="w-full flex items-center justify-center px-6 py-3 bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* 说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">导出格式说明</h3>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>导出的JSON文件符合AX框架训练样本格式</li>
          <li>包含input（标题、来源、摘要）和output（评分、维度、标签）</li>
          <li>可直接用于ax-quality-evaluator.ts训练</li>
          <li>建议定期备份导出的样本集</li>
        </ul>
      </div>
    </div>
  );
}

export default ExportPage;
