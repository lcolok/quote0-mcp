import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';

function ImportPage() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('technology');
  const [rssSource, setRssSource] = useState('solidot');
  const [count, setCount] = useState(10);
  const [startIndex, setStartIndex] = useState(0);

  const importMutation = useMutation({
    mutationFn: () =>
      apiClient.importFromRSS({
        category,
        rssSource,
        count,
        startIndex,
      }),
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
        <h2 className="text-2xl font-bold text-gray-900">导入新闻数据</h2>
        <p className="text-gray-600 mt-1">
          从RSS订阅源导入新闻数据用于标注
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        {/* 分类选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            新闻分类
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="technology">科技</option>
            <option value="business">商业</option>
            <option value="design">设计</option>
            <option value="programming">编程</option>
          </select>
        </div>

        {/* RSS源选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            RSS订阅源
          </label>
          <select
            value={rssSource}
            onChange={(e) => setRssSource(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="solidot">Solidot</option>
            <option value="sspai">少数派</option>
            <option value="cnbeta">cnBeta</option>
            <option value="techcrunch">TechCrunch</option>
            <option value="arstechnica">Ars Technica</option>
            <option value="36kr">36氪</option>
            <option value="hackernews">Hacker News</option>
          </select>
        </div>

        {/* 导入配置 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              导入数量
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              起始索引
            </label>
            <input
              type="number"
              min="0"
              value={startIndex}
              onChange={(e) => setStartIndex(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
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
              <CheckCircle className="w-5 h-5 mr-2" />
              <div>
                <p className="font-semibold">导入成功！</p>
                <p className="text-sm mt-1">
                  成功导入 {importMutation.data.data?.importedCount} 条新闻
                  {importMutation.data.data?.errors && (
                    <span className="text-yellow-600">
                      （{importMutation.data.data.errors.length} 条出错）
                    </span>
                  )}
                </p>
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

      {/* 使用提示 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">使用提示</h3>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>建议每次导入10-20条新闻进行标注</li>
          <li>重复的新闻会自动跳过，不会重复导入</li>
          <li>导入后可在"开始标注"页面进行标注</li>
          <li>可以从不同RSS源导入以获得多样化样本</li>
        </ul>
      </div>
    </div>
  );
}

export default ImportPage;
