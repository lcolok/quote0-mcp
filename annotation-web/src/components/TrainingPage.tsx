import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check,
  GitBranch,
  Database,
  TrendingUp,
  Clock,
  Package,
  RefreshCw,
  Zap,
  BarChart3,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface TrainingVersion {
  version: string;
  path: string;
  createdAt: string;
  sampleCount: number;
  avgScore: number;
  isCurrent: boolean;
}

interface VersionDetails {
  metadata: {
    version: string;
    createdAt: string;
    createdBy: string;
    description: string;
    aiSummary?: string; // AI自动生成的总结
    stats: {
      totalSamples: number;
      highQuality: number;
      mediumQuality: number;
      lowQuality: number;
      avgScore: number;
    };
    sourceBreakdown: Record<string, number>;
    previousVersion: string | null;
    tags: string[];
  };
  samples: any[];
  sourceMapping: any[];
}

interface TestHistoryItem {
  id: string;
  timestamp: string;
  newsTitle: string;
  newsSource: string;
  result: any;
  version: string;
}

interface NewsItem {
  title: string;
  description: string;
  link: string;
  source: string;
  category: string;
  publishTime: string;
}

function TrainingPage() {
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testHistory, setTestHistory] = useState<TestHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const queryClient = useQueryClient();

  // 创建版本表单状态（移除version字段，description变为可选）
  const [createForm, setCreateForm] = useState({
    description: '',
    minScore: 70,
    maxScore: 100,
    tags: ''
  });

  // 从localStorage加载测试历史
  useEffect(() => {
    const saved = localStorage.getItem('ax-test-history');
    if (saved) {
      try {
        setTestHistory(JSON.parse(saved));
      } catch (error) {
        console.error('加载测试历史失败:', error);
      }
    }
  }, []);

  // 保存测试历史到localStorage
  useEffect(() => {
    if (testHistory.length > 0) {
      localStorage.setItem('ax-test-history', JSON.stringify(testHistory));
    }
  }, [testHistory]);

  // 获取版本列表
  const { data: versionsData, isLoading: versionsLoading } = useQuery({
    queryKey: ['ax-versions'],
    queryFn: async () => {
      const response = await fetch('http://localhost:3001/api/ax-training/versions');
      if (!response.ok) throw new Error('获取版本列表失败');
      const result = await response.json();
      return result.data;
    },
    refetchInterval: 10000 // 每10秒刷新
  });

  // 获取版本详情
  const { data: versionDetails } = useQuery({
    queryKey: ['ax-version-details', selectedVersion],
    queryFn: async () => {
      if (!selectedVersion) return null;
      const response = await fetch(`http://localhost:3001/api/ax-training/versions/${selectedVersion}`);
      if (!response.ok) throw new Error('获取版本详情失败');
      const result = await response.json();
      return result.data as VersionDetails;
    },
    enabled: !!selectedVersion
  });

  // 获取统计信息
  const { data: statistics } = useQuery({
    queryKey: ['ax-statistics'],
    queryFn: async () => {
      const response = await fetch('http://localhost:3001/api/ax-training/statistics');
      if (!response.ok) throw new Error('获取统计信息失败');
      const result = await response.json();
      return result.data;
    }
  });

  // 全量RSS源配置
  const allRssSources = [
    { category: 'technology', id: 'solidot', name: 'Solidot' },
    { category: 'technology', id: 'arstechnica', name: 'Ars Technica' },
    { category: 'technology', id: 'dev-to', name: 'Dev.to' },
    { category: 'technology', id: 'hackernews', name: 'Hacker News' },
    { category: 'finance', id: 'wallstreetcn', name: '华尔街见闻' },
    { category: 'finance', id: '36kr', name: '36氪' }
  ];

  // 获取所有RSS新闻（全量加载）
  const { data: allNewsList, isLoading: newsLoading } = useQuery({
    queryKey: ['all-rss-news'],
    queryFn: async () => {
      const allNews: NewsItem[] = [];

      // 并发获取所有RSS源的新闻
      const promises = allRssSources.map(async (source) => {
        try {
          const response = await fetch(
            `http://localhost:3001/api/rss/list?category=${source.category}&rssSource=${source.id}&count=20&startIndex=0`
          );

          if (!response.ok) {
            console.warn(`获取 ${source.name} 失败`);
            return [];
          }

          const result = await response.json();
          return (result.data || []).map((item: any) => ({
            ...item,
            category: source.category,
            source: source.name
          }));
        } catch (error) {
          console.error(`获取 ${source.name} 出错:`, error);
          return [];
        }
      });

      const results = await Promise.all(promises);
      results.forEach(newsArray => allNews.push(...newsArray));

      return allNews;
    },
    staleTime: 300000, // 5分钟缓存
    retry: 1
  });

  // 过滤新闻
  const filteredNews = (allNewsList || []).filter((news: NewsItem) => {
    // 分类过滤
    if (filterCategory !== 'all' && news.category !== filterCategory) {
      return false;
    }

    // 来源过滤
    if (filterSource !== 'all' && news.source !== filterSource) {
      return false;
    }

    // 搜索文本过滤
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      return (
        news.title.toLowerCase().includes(searchLower) ||
        news.description.toLowerCase().includes(searchLower)
      );
    }

    return true;
  });

  // 获取所有分类和来源（用于过滤器）
  const availableCategories = Array.from(new Set(allNewsList?.map((n: NewsItem) => n.category) || []));
  const availableSources = Array.from(new Set(allNewsList?.map((n: NewsItem) => n.source) || []));

  // 创建版本
  const createVersionMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const response = await fetch('http://localhost:3001/api/ax-training/versions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          tags: data.tags ? data.tags.split(',').map(t => t.trim()) : []
        })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '创建失败');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast.success(`版本 ${data.data.version} 创建成功！`);
      setShowCreateDialog(false);
      setCreateForm({ description: '', minScore: 70, maxScore: 100, tags: '' });
      queryClient.invalidateQueries({ queryKey: ['ax-versions'] });
      queryClient.invalidateQueries({ queryKey: ['ax-statistics'] });
    },
    onError: (error: Error) => {
      toast.error(`创建失败: ${error.message}`);
    }
  });

  // 激活版本
  const activateVersionMutation = useMutation({
    mutationFn: async (version: string) => {
      const response = await fetch(`http://localhost:3001/api/ax-training/versions/${version}/activate`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('激活失败');
      return response.json();
    },
    onSuccess: (data) => {
      toast.success(`版本 ${data.data.version} 已激活！`);
      toast.success('🔥 模型将在下次请求时自动热重载，无需重启服务', {
        duration: 5000
      });
      queryClient.invalidateQueries({ queryKey: ['ax-versions'] });
    },
    onError: (error: Error) => {
      toast.error(`激活失败: ${error.message}`);
    }
  });

  // 训练模型
  const trainModelMutation = useMutation({
    mutationFn: async ({ version, deploy }: { version: string; deploy: boolean }) => {
      const response = await fetch(`http://localhost:3001/api/ax-training/versions/${version}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deploy })
      });
      if (!response.ok) throw new Error('训练失败');
      return response.json();
    },
    onSuccess: async (data) => {
      const perf = data.data.performance;
      toast.success(`模型训练完成！综合性能: ${(perf.overall * 100).toFixed(1)}%`);
      if (data.data.deployed) {
        // 自动触发重启
        toast.info('模型已部署，正在自动重启API服务...', { duration: 3000 });
        await handleRestart();
      }
      queryClient.invalidateQueries({ queryKey: ['ax-versions'] });
    },
    onError: (error: Error) => {
      toast.error(`训练失败: ${error.message}`);
    }
  });

  // 重启API服务
  const handleRestart = async () => {
    setIsRestarting(true);

    try {
      // 发送重启命令
      const response = await fetch('http://localhost:3001/api/ax-training/restart', {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('重启命令发送失败');
      }

      toast.success('重启命令已发送');

      // 等待5秒后开始检查服务状态
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 轮询检查服务是否恢复
      let attempts = 0;
      const maxAttempts = 20; // 最多尝试20次（约20秒）

      const checkStatus = async (): Promise<boolean> => {
        try {
          const statusResponse = await fetch('http://localhost:3001/api/ax-training/status');
          return statusResponse.ok;
        } catch {
          return false;
        }
      };

      while (attempts < maxAttempts) {
        const isRunning = await checkStatus();

        if (isRunning) {
          toast.success('✅ API服务已成功重启！');
          queryClient.invalidateQueries({ queryKey: ['ax-versions'] });
          setIsRestarting(false);
          return;
        }

        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      toast.warning('服务重启可能需要更多时间，请稍后刷新页面确认');
    } catch (error) {
      toast.error(`重启失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsRestarting(false);
    }
  };

  const versions: TrainingVersion[] = versionsData?.versions || [];
  const currentVersion = versionsData?.currentVersion;

  // 测试AX优化
  const handleTestOptimization = async () => {
    if (!selectedNews) {
      toast.error('请选择新闻');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('http://localhost:3001/api/news/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: selectedNews.category,
          dataSource: 'mock',
          processor: 'ax-optimized',
          index: 0,
          renderer: 'json',
          options: {
            force: true  // 强制跳过缓存
          },
          mockData: {
            title: selectedNews.title,
            content: selectedNews.description,
            link: selectedNews.link,
            source: selectedNews.source
          }
        })
      });

      if (!response.ok) {
        throw new Error('请求失败');
      }

      const result = await response.json();
      setTestResult(result.data);

      // 添加到测试历史
      const historyItem: TestHistoryItem = {
        id: `${Date.now()}-${selectedNews.title}`,
        timestamp: new Date().toISOString(),
        newsTitle: selectedNews.title,
        newsSource: selectedNews.source,
        result: result.data,
        version: currentVersion || '未知'
      };

      setTestHistory(prev => [historyItem, ...prev].slice(0, 50)); // 只保留最近50条

      toast.success('优化完成！');
    } catch (error) {
      toast.error(`测试失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-12rem)]">
      {/* 左侧主内容区 - 固定1/2宽度 */}
      <div className="w-1/2 space-y-6 overflow-y-auto">
      {/* 重启状态提示 */}
      {isRestarting && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <RefreshCw className="w-5 h-5 text-yellow-600 animate-spin mr-3" />
            <div>
              <p className="text-sm font-medium text-yellow-900">正在重启API服务...</p>
              <p className="text-xs text-yellow-700 mt-1">请稍候，服务重启通常需要5-10秒</p>
            </div>
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100 text-blue-600">
              <Package className="w-6 h-6" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">总版本数</p>
              <p className="text-2xl font-bold text-gray-900">
                {statistics?.totalVersions || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100 text-green-600">
              <Database className="w-6 h-6" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">训练样本</p>
              <p className="text-2xl font-bold text-gray-900">
                {statistics?.totalSamples || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100 text-purple-600">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">平均质量</p>
              <p className="text-2xl font-bold text-gray-900">
                {statistics?.avgScore?.toFixed(1) || '0'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-orange-100 text-orange-600">
              <Check className="w-6 h-6" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-500">当前版本</p>
              <p className="text-lg font-bold text-gray-900">
                {currentVersion || '未激活'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-4">
        <button
          onClick={() => setShowCreateDialog(true)}
          className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <GitBranch className="w-5 h-5 mr-2" />
          创建新版本
        </button>

        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['ax-versions'] })}
          className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <RefreshCw className="w-5 h-5 mr-2" />
          刷新
        </button>
      </div>

      {/* 版本列表 */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">训练版本历史</h2>
          <p className="text-sm text-gray-500 mt-1">
            查看和管理所有AX训练数据版本
          </p>
        </div>

        <div className="divide-y divide-gray-200">
          {versionsLoading ? (
            <div className="p-8 text-center text-gray-500">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
              加载中...
            </div>
          ) : versions.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>暂无版本</p>
              <p className="text-sm mt-2">点击"创建新版本"开始</p>
            </div>
          ) : (
            versions.map((version) => (
              <div key={version.version} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {version.version}
                      </h3>
                      {version.isCurrent && (
                        <span className="ml-3 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded">
                          当前激活
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center text-sm text-gray-500 space-x-4">
                      <span className="flex items-center">
                        <Clock className="w-4 h-4 mr-1" />
                        {new Date(version.createdAt).toLocaleString('zh-CN')}
                      </span>
                      <span className="flex items-center">
                        <Database className="w-4 h-4 mr-1" />
                        {version.sampleCount} 样本
                      </span>
                      <span className="flex items-center">
                        <BarChart3 className="w-4 h-4 mr-1" />
                        平均分: {version.avgScore.toFixed(1)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!version.isCurrent && (
                      <button
                        onClick={() => activateVersionMutation.mutate(version.version)}
                        disabled={activateVersionMutation.isPending}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        激活
                      </button>
                    )}

                    <button
                      onClick={() => trainModelMutation.mutate({ version: version.version, deploy: true })}
                      disabled={trainModelMutation.isPending}
                      className="flex items-center px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Zap className="w-4 h-4 mr-1" />
                      训练并部署
                    </button>

                    <button
                      onClick={() => {
                        setSelectedVersion(version.version);
                        setExpandedVersion(expandedVersion === version.version ? null : version.version);
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                    >
                      {expandedVersion === version.version ? (
                        <ChevronUp className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* 展开的详情 */}
                {expandedVersion === version.version && versionDetails && (
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    {/* AI总结 */}
                    {versionDetails.metadata.aiSummary && (
                      <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <h4 className="text-sm font-semibold text-blue-900 mb-2 flex items-center">
                          <Zap className="w-4 h-4 mr-2" />
                          AI训练总结
                        </h4>
                        <p className="text-sm text-blue-800 whitespace-pre-line">
                          {versionDetails.metadata.aiSummary}
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">版本信息</h4>
                        <dl className="space-y-2 text-sm">
                          {versionDetails.metadata.description && (
                            <div className="flex justify-between">
                              <dt className="text-gray-500">用户备注:</dt>
                              <dd className="text-gray-900">{versionDetails.metadata.description}</dd>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <dt className="text-gray-500">创建者:</dt>
                            <dd className="text-gray-900">{versionDetails.metadata.createdBy}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">前一版本:</dt>
                            <dd className="text-gray-900">{versionDetails.metadata.previousVersion || '无'}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">标签:</dt>
                            <dd className="text-gray-900">
                              {versionDetails.metadata.tags.length > 0
                                ? versionDetails.metadata.tags.join(', ')
                                : '无'}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">质量统计</h4>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">高质量</span>
                            <div className="flex items-center">
                              <div className="w-32 bg-gray-200 rounded-full h-2 mr-2">
                                <div
                                  className="bg-green-600 h-2 rounded-full"
                                  style={{
                                    width: `${(versionDetails.metadata.stats.highQuality / versionDetails.metadata.stats.totalSamples) * 100}%`
                                  }}
                                ></div>
                              </div>
                              <span className="text-sm font-medium text-gray-900">
                                {versionDetails.metadata.stats.highQuality}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">中质量</span>
                            <div className="flex items-center">
                              <div className="w-32 bg-gray-200 rounded-full h-2 mr-2">
                                <div
                                  className="bg-yellow-600 h-2 rounded-full"
                                  style={{
                                    width: `${(versionDetails.metadata.stats.mediumQuality / versionDetails.metadata.stats.totalSamples) * 100}%`
                                  }}
                                ></div>
                              </div>
                              <span className="text-sm font-medium text-gray-900">
                                {versionDetails.metadata.stats.mediumQuality}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">低质量</span>
                            <div className="flex items-center">
                              <div className="w-32 bg-gray-200 rounded-full h-2 mr-2">
                                <div
                                  className="bg-red-600 h-2 rounded-full"
                                  style={{
                                    width: `${(versionDetails.metadata.stats.lowQuality / versionDetails.metadata.stats.totalSamples) * 100}%`
                                  }}
                                ></div>
                              </div>
                              <span className="text-sm font-medium text-gray-900">
                                {versionDetails.metadata.stats.lowQuality}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">来源分布</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(versionDetails.metadata.sourceBreakdown).map(([source, count]) => (
                          <span
                            key={source}
                            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-full"
                          >
                            {source}: {count as number}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 创建版本对话框 */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">创建新训练版本</h3>
            <p className="text-sm text-gray-500 mb-4">
              版本号将自动生成（v1, v2, v3...），AI将自动生成训练总结
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  用户备注（可选）
                </label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="可选填写，后续可修改..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    最低分数
                  </label>
                  <input
                    type="number"
                    value={createForm.minScore}
                    onChange={(e) => setCreateForm({ ...createForm, minScore: parseInt(e.target.value) })}
                    min="0"
                    max="100"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    最高分数
                  </label>
                  <input
                    type="number"
                    value={createForm.maxScore}
                    onChange={(e) => setCreateForm({ ...createForm, maxScore: parseInt(e.target.value) })}
                    min="0"
                    max="100"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  标签
                </label>
                <input
                  type="text"
                  value={createForm.tags}
                  onChange={(e) => setCreateForm({ ...createForm, tags: e.target.value })}
                  placeholder="用逗号分隔，例如: technology,initial"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => createVersionMutation.mutate(createForm)}
                disabled={createVersionMutation.isPending}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createVersionMutation.isPending ? '创建中...' : '创建'}
              </button>
              <button
                onClick={() => setShowCreateDialog(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* 右侧 Playground 面板 - 固定显示，占1/2宽度 */}
      <div className="w-1/2 bg-white rounded-lg shadow overflow-y-auto flex flex-col">
          <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4 z-10">
            <h3 className="text-lg font-semibold flex items-center">
              <Zap className="w-5 h-5 mr-2" />
              AX 优化 Playground
            </h3>
            <p className="text-sm text-purple-100 mt-1">
              实时测试当前部署的模型效果
            </p>
          </div>

          <div className="p-6 space-y-4">
            {/* 当前版本信息 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-blue-900">当前激活版本</span>
                <span className="px-3 py-1 bg-blue-600 text-white text-sm font-medium rounded">
                  {currentVersion || '未激活'}
                </span>
              </div>
            </div>

            {/* 搜索框 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                搜索新闻
              </label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索标题或内容..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {/* 分类过滤 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                分类过滤
              </label>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilterCategory('all')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    filterCategory === 'all'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  全部
                </button>
                {availableCategories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      filterCategory === cat
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {cat === 'technology' ? '科技' : '财经'}
                  </button>
                ))}
              </div>
            </div>

            {/* 来源过滤 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                来源过滤
              </label>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilterSource('all')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    filterSource === 'all'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  全部
                </button>
                {availableSources.map(source => (
                  <button
                    key={source}
                    onClick={() => setFilterSource(source)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      filterSource === source
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {source}
                  </button>
                ))}
              </div>
            </div>

            {/* 新闻列表 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  选择新闻进行测试 ({filteredNews.length}/{allNewsList?.length || 0}条)
                </label>
                {newsLoading && (
                  <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />
                )}
              </div>

              {newsLoading ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  正在加载全部新闻...
                </div>
              ) : filteredNews.length > 0 ? (
                <div className="space-y-2 max-h-[500px] overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {filteredNews.map((news: NewsItem, index: number) => (
                    <button
                      key={`${news.source}-${news.title}-${index}`}
                      onClick={() => setSelectedNews(news)}
                      className={`w-full text-left p-3 rounded-lg transition-all ${
                        selectedNews?.title === news.title && selectedNews?.source === news.source
                          ? 'bg-purple-50 border-2 border-purple-600'
                          : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2 flex-1">
                          {news.title}
                        </p>
                        <div className="flex gap-1 shrink-0">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${
                            news.category === 'technology'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {news.category === 'technology' ? '科技' : '财经'}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        {news.source} · {news.description?.substring(0, 50)}...
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 text-sm">
                  没有符合条件的新闻
                </div>
              )}
            </div>

            {/* 测试按钮 */}
            <button
              onClick={handleTestOptimization}
              disabled={isTesting || !selectedNews}
              className="w-full flex items-center justify-center px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isTesting ? (
                <>
                  <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                  优化中...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  测试 AX 优化
                </>
              )}
            </button>

            {/* 历史记录按钮 */}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center justify-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
            >
              <Clock className="w-4 h-4 mr-2" />
              {showHistory ? '隐藏' : '查看'}测试历史 ({testHistory.length})
            </button>

            {/* 结果展示 */}
            {testResult && (
              <div className="space-y-4 pt-4 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900">优化结果</h4>

                {/* 优化后标题 */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <label className="block text-xs font-medium text-green-900 mb-2">
                    优化后标题
                  </label>
                  <p className="text-sm text-green-800 font-medium">
                    {testResult.title || '无'}
                  </p>
                  <div className="mt-2 text-xs text-green-700">
                    长度: {testResult.title?.length || 0} 字符
                  </div>
                </div>

                {/* 优化后摘要 */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <label className="block text-xs font-medium text-blue-900 mb-2">
                    优化后摘要
                  </label>
                  <p className="text-sm text-blue-800 whitespace-pre-line">
                    {testResult.summary || testResult.message || '无'}
                  </p>
                  <div className="mt-2 text-xs text-blue-700">
                    长度: {(testResult.summary || testResult.message || '').length} 字符
                  </div>
                </div>

                {/* 处理信息 */}
                {testResult.processorInfo && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <label className="block text-xs font-medium text-gray-900 mb-2">
                      处理信息
                    </label>
                    <dl className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-gray-600">处理器:</dt>
                        <dd className="text-gray-900 font-medium">{testResult.processorInfo.type}</dd>
                      </div>
                      {testResult.processorInfo.processingTime && (
                        <div className="flex justify-between">
                          <dt className="text-gray-600">处理时间:</dt>
                          <dd className="text-gray-900">{testResult.processorInfo.processingTime}ms</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}

              </div>
            )}

            {/* 测试历史 */}
            {showHistory && testHistory.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900 flex items-center">
                  <Clock className="w-4 h-4 mr-2" />
                  测试历史
                </h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {testHistory.map((item) => (
                    <div
                      key={item.id}
                      className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900">{item.version}</span>
                        <span className="text-gray-500">
                          {new Date(item.timestamp).toLocaleTimeString('zh-CN')}
                        </span>
                      </div>
                      <p className="text-gray-700 font-medium mb-1 line-clamp-1">
                        原文: {item.newsTitle}
                      </p>
                      <p className="text-purple-700 mb-1 line-clamp-1">
                        优化: {item.result.title}
                      </p>
                      <div className="flex items-center justify-between text-gray-500 mt-2">
                        <span>{item.newsSource}</span>
                        <button
                          onClick={() => setTestResult(item.result)}
                          className="text-purple-600 hover:text-purple-700 font-medium"
                        >
                          查看详情
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
    </div>
  );
}

export default TrainingPage;
