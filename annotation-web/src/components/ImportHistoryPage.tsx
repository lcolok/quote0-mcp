import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { Upload, CheckCircle, AlertCircle, Database, Clock } from 'lucide-react';

function ImportHistoryPage() {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<'cache' | 'push_log'>('cache');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState(50);
  const [minDate, setMinDate] = useState('');

  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.client.post('/api/annotation/news/import/history', {
        source,
        category: category || undefined,
        limit,
        minDate: minDate || undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-news'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
    },
  });

  const handleImport = () => {
    importMutation.mutate();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">从历史记录导入</h2>
        <p className="text-gray-600 mt-1">
          从已有的新闻缓存或推送历史中导入数据，自动去重
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        {/* 数据源选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            数据来源
          </label>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setSource('cache')}
              className={`p-4 border-2 rounded-lg transition-all ${
                source === 'cache'
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Database className="w-6 h-6 mx-auto mb-2 text-primary-600" />
              <div className="font-medium">新闻缓存</div>
              <div className="text-xs text-gray-500 mt-1">
                已处理的新闻数据
              </div>
            </button>
            <button
              onClick={() => setSource('push_log')}
              className={`p-4 border-2 rounded-lg transition-all ${
                source === 'push_log'
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Clock className="w-6 h-6 mx-auto mb-2 text-primary-600" />
              <div className="font-medium">推送历史</div>
              <div className="text-xs text-gray-500 mt-1">
                历史推送记录
              </div>
            </button>
          </div>
        </div>

        {/* 分类过滤 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            新闻分类（可选）
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">全部分类</option>
            <option value="technology">科技</option>
            <option value="business">商业</option>
            <option value="design">设计</option>
            <option value="programming">编程</option>
          </select>
        </div>

        {/* 日期过滤 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            最早日期（可选）
          </label>
          <input
            type="date"
            value={minDate}
            onChange={(e) => setMinDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <p className="text-xs text-gray-500 mt-1">
            只导入此日期之后的新闻
          </p>
        </div>

        {/* 数量限制 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            导入数量
          </label>
          <input
            type="number"
            min="1"
            max="500"
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <p className="text-xs text-gray-500 mt-1">
            建议: 首次导入50-100条，避免过多数据
          </p>
        </div>

        {/* 导入按钮 */}
        <button
          onClick={handleImport}
          disabled={importMutation.isPending}
          className="w-full flex items-center justify-center px-6 py-3 bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importMutation.isPending ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
              导入中...
            </>
          ) : (
            <>
              <Upload className="w-5 h-5 mr-2" />
              开始导入
            </>
          )}
        </button>

        {/* 成功提示 */}
        {importMutation.isSuccess && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center text-green-800">
              <CheckCircle className="w-5 h-5 mr-2 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">导入成功！</p>
                <div className="text-sm mt-1">
                  <p>✅ 成功导入: {importMutation.data?.data?.importedCount} 条</p>
                  <p>⏭️  已跳过（重复）: {importMutation.data?.data?.skippedCount} 条</p>
                  <p>📊 处理总数: {importMutation.data?.data?.totalProcessed} 条</p>
                  {importMutation.data?.data?.errors && (
                    <p className="text-red-600 mt-2">
                      ⚠️ {importMutation.data.data.errors.length} 条出错
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {importMutation.isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center text-red-800">
              <AlertCircle className="w-5 h-5 mr-2" />
              <div>
                <p className="font-semibold">导入失败</p>
                <p className="text-sm mt-1">
                  {(importMutation.error as Error).message}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 使用说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">💡 功能说明</h3>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li><strong>新闻缓存</strong>: 从已处理的新闻中导入，质量较高</li>
          <li><strong>推送历史</strong>: 从历史推送记录导入，数量更多</li>
          <li><strong>自动去重</strong>: 相同标题+来源+时间的新闻会自动跳过</li>
          <li><strong>推荐流程</strong>: 先从缓存导入50条 → 标注 → 再导入更多</li>
          <li>导入后可在"开始标注"页面进行标注</li>
        </ul>
      </div>

      {/* 快速统计 */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">📈 可用数据统计</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-gray-600">新闻缓存</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">~53</div>
            <div className="text-xs text-gray-500">条已处理新闻</div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-gray-600">推送历史</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">~1155</div>
            <div className="text-xs text-gray-500">条推送记录</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImportHistoryPage;
