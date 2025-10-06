import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { Plus, Trash2, RefreshCw, Settings, Power, PowerOff, Edit2, X } from 'lucide-react';
import { toast } from 'sonner';

interface SourceMetadata {
  displayName: string;
  description: string;
}

function SourcesPage() {
  const queryClient = useQueryClient();
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // 获取multi-source-rotation任务配置
  const { data: jobData, isLoading } = useQuery({
    queryKey: ['scheduler-job', 'multi-source-rotation'],
    queryFn: async () => {
      const response = await apiClient.client.get('/api/scheduler/jobs');
      const jobs = response.data.data || [];
      return jobs.find((j: any) => j.id === 'multi-source-rotation');
    },
    refetchInterval: 5000,
  });

  // 获取完整job配置（包含rssSources）
  const { data: fullJobData } = useQuery({
    queryKey: ['scheduler-job-full', 'multi-source-rotation'],
    queryFn: async () => {
      const response = await apiClient.client.get('/api/scheduler/jobs/multi-source-rotation');
      return response.data.data;
    },
  });

  // 获取可用RSS源列表
  const { data: availableSources } = useQuery({
    queryKey: ['available-rss-sources'],
    queryFn: async () => {
      const response = await apiClient.client.get('/api/news/sources');
      return response.data.sources || [];
    },
  });

  // 获取RSS源元数据
  const { data: sourceMetadata } = useQuery({
    queryKey: ['rss-source-metadata'],
    queryFn: async () => {
      const response = await apiClient.client.get('/api/rss-sources/metadata');
      return response.data.data as Record<string, SourceMetadata>;
    },
  });

  // 重新加载调度器
  const reloadMutation = useMutation({
    mutationFn: async () => {
      await apiClient.client.post('/api/scheduler/reload');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduler-job'] });
      queryClient.invalidateQueries({ queryKey: ['scheduler-job-full'] });
      toast.success('调度器已重新加载');
    },
    onError: (error: any) => {
      toast.error(`重新加载失败: ${error.message}`);
    },
  });

  // 更新RSS源列表
  const updateSourcesMutation = useMutation({
    mutationFn: async (newSources: string[]) => {
      // 直接更新数据库
      await apiClient.client.post('/api/scheduler/jobs/multi-source-rotation/update-sources', {
        rssSources: newSources,
      });
    },
    onSuccess: () => {
      reloadMutation.mutate();
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // 禁用/启用RSS源
  const toggleSourceMutation = useMutation({
    mutationFn: async ({ source, enabled }: { source: string; enabled: boolean }) => {
      await apiClient.client.post('/api/scheduler/jobs/multi-source-rotation/toggle-source', {
        source,
        enabled,
      });
    },
    onSuccess: (_, variables) => {
      toast.success(`${variables.source} 已${variables.enabled ? '启用' : '禁用'}`);
      queryClient.invalidateQueries({ queryKey: ['scheduler-job-full'] });
      reloadMutation.mutate();
    },
    onError: (error: any) => {
      toast.error(`操作失败: ${error.message}`);
    },
  });

  // 更新RSS源元数据
  const updateMetadataMutation = useMutation({
    mutationFn: async ({ sourceId, displayName, description }: { sourceId: string; displayName: string; description: string }) => {
      await apiClient.client.post(`/api/rss-sources/${sourceId}/metadata`, {
        displayName,
        description,
      });
    },
    onSuccess: () => {
      toast.success('RSS源信息已更新');
      queryClient.invalidateQueries({ queryKey: ['rss-source-metadata'] });
      setEditingSource(null);
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  const currentSources = fullJobData?.rssSources || [];
  const disabledSources = fullJobData?.disabledSources || [];
  const activeSourceIndex = fullJobData?.currentSourceIndex || 0;
  const strategy = jobData?.indexStrategy || {};

  const isSourceEnabled = (source: string) => !disabledSources.includes(source);

  const getSourceDisplayName = (source: string) => {
    return sourceMetadata?.[source]?.displayName || source;
  };

  const getSourceDescription = (source: string) => {
    return sourceMetadata?.[source]?.description || '';
  };

  const handleEditSource = (source: string) => {
    setEditingSource(source);
    setEditDisplayName(getSourceDisplayName(source));
    setEditDescription(getSourceDescription(source));
  };

  const handleSaveEdit = () => {
    if (!editingSource) return;
    updateMetadataMutation.mutate({
      sourceId: editingSource,
      displayName: editDisplayName,
      description: editDescription,
    });
  };

  const handleRemoveSource = (source: string) => {
    const newSources = currentSources.filter((s: string) => s !== source);
    if (newSources.length === 0) {
      toast.error('至少需要保留一个RSS源');
      return;
    }
    updateSourcesMutation.mutate(newSources);
  };

  const handleAddSource = () => {
    if (!newSourceName.trim()) {
      toast.error('请输入RSS源名称');
      return;
    }
    if (currentSources.includes(newSourceName)) {
      toast.error('该RSS源已存在');
      return;
    }
    updateSourcesMutation.mutate([...currentSources, newSourceName]);
    setNewSourceName('');
    setShowAddSource(false);
  };

  const handleReorderSource = (source: string, direction: 'up' | 'down') => {
    const index = currentSources.indexOf(source);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= currentSources.length) return;

    const newSources = [...currentSources];
    [newSources[index], newSources[newIndex]] = [newSources[newIndex], newSources[index]];
    updateSourcesMutation.mutate(newSources);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">RSS源管理</h2>
          <p className="text-sm text-gray-600 mt-1">
            管理混流任务的RSS订阅源 · 策略: {strategy.type} · 间隔: {jobData?.intervalMs / 1000}秒
          </p>
        </div>
        <button
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${reloadMutation.isPending ? 'animate-spin' : ''}`} />
          重新加载
        </button>
      </div>

      {/* 策略配置卡片 */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5 text-primary-600" />
          <h3 className="text-lg font-semibold text-gray-900">轮播策略配置</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-600 mb-1">冷却时间</div>
            <div className="text-lg font-semibold text-gray-900">{strategy.cooldownHours || 6}小时</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-600 mb-1">最大推送次数</div>
            <div className="text-lg font-semibold text-gray-900">{strategy.maxPushCount || 3}次</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-600 mb-1">池大小</div>
            <div className="text-lg font-semibold text-gray-900">{strategy.poolSize === -1 ? '动态' : strategy.poolSize}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-600 mb-1">推送后轮换</div>
            <div className="text-lg font-semibold text-gray-900">{strategy.rotateAfterEachPush ? '是' : '否'}</div>
          </div>
        </div>
      </div>

      {/* RSS源列表 */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">RSS订阅源</h3>
              <p className="text-sm text-gray-600 mt-1">
                共 {currentSources.length} 个源 · 当前轮换到: <span className="font-medium text-primary-600">{currentSources[activeSourceIndex] || '未知'}</span>
              </p>
            </div>
            <button
              onClick={() => setShowAddSource(!showAddSource)}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Plus className="w-4 h-4" />
              添加源
            </button>
          </div>

          {/* 添加源表单 */}
          {showAddSource && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <div className="flex gap-3">
                <select
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">选择RSS源...</option>
                  {availableSources
                    ?.filter((s: string) => !currentSources.includes(s))
                    .map((source: string) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                </select>
                <button
                  onClick={handleAddSource}
                  disabled={!newSourceName || updateSourcesMutation.isPending}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  添加
                </button>
                <button
                  onClick={() => {
                    setShowAddSource(false);
                    setNewSourceName('');
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="divide-y divide-gray-200">
          {currentSources.map((source: string, index: number) => {
            const isActive = index === activeSourceIndex;
            const enabled = isSourceEnabled(source);
            const displayName = getSourceDisplayName(source);
            const description = getSourceDescription(source);

            return (
              <div
                key={source}
                className={`p-4 ${
                  isActive ? 'bg-primary-50' : 'hover:bg-gray-50'
                } ${!enabled ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="text-gray-500 font-mono text-sm w-8 mt-1">#{index + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-medium text-lg ${enabled ? 'text-gray-900' : 'text-gray-500 line-through'}`}>
                          {displayName}
                        </span>
                        {isActive && enabled && (
                          <span className="px-2 py-0.5 bg-primary-600 text-white text-xs rounded-full">
                            当前
                          </span>
                        )}
                        {!enabled && (
                          <span className="px-2 py-0.5 bg-gray-400 text-white text-xs rounded-full">
                            已禁用
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mb-1">{source}</div>
                      {description && (
                        <div className="text-sm text-gray-600 mt-2">{description}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleEditSource(source)}
                      className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleSourceMutation.mutate({ source, enabled: !enabled })}
                      disabled={toggleSourceMutation.isPending}
                      className={`p-2 rounded ${
                        enabled
                          ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                      } disabled:opacity-50`}
                      title={enabled ? '禁用' : '启用'}
                    >
                      {enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleReorderSource(source, 'up')}
                      disabled={index === 0 || updateSourcesMutation.isPending}
                      className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="上移"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleReorderSource(source, 'down')}
                      disabled={index === currentSources.length - 1 || updateSourcesMutation.isPending}
                      className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="下移"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleRemoveSource(source)}
                      disabled={currentSources.length <= 1 || updateSourcesMutation.isPending}
                      className="p-2 text-red-600 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="移除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 编辑对话框 */}
      {editingSource && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">编辑RSS源信息</h3>
              <button
                onClick={() => setEditingSource(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  源ID（只读）
                </label>
                <input
                  type="text"
                  value={editingSource}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  显示名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="例如：奇客资讯"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  描述
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="例如：Solidot - 科技新闻聚合，关注开源、隐私、安全等话题"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setEditingSource(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editDisplayName || updateMetadataMutation.isPending}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {updateMetadataMutation.isPending ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SourcesPage;
