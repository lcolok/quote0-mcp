import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import {
  Play,
  Pause,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Settings,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';

interface SchedulerJob {
  id: string;
  name: string | null;
  description: string | null;
  nextIndex: number;
  intervalMs: number;
  lastIndex: number | null;
  consecutiveFailures: number;
  indexStrategy: {
    type: string;
    poolSize: number;
    startIndex: number;
    cooldownHours?: number;
    maxPushCount?: number;
    rotateAfterEachPush?: boolean;
  };
  enabled: boolean;
}

function SchedulerPage() {
  const queryClient = useQueryClient();
  const [triggerIndex, setTriggerIndex] = useState<{ [key: string]: string }>({});

  // 查询调度任务
  const { data: jobsData, isLoading } = useQuery({
    queryKey: ['scheduler-jobs'],
    queryFn: () => apiClient.getSchedulerJobs(),
    refetchInterval: 5000, // 每5秒自动刷新
  });

  // 触发任务
  const triggerMutation = useMutation({
    mutationFn: (params: { jobId: string; index?: number }) =>
      apiClient.triggerSchedulerJob(params.jobId, params.index),
    onSuccess: (_, variables) => {
      toast.success(`任务已触发执行`);
      queryClient.invalidateQueries({ queryKey: ['scheduler-jobs'] });
      setTriggerIndex(prev => ({ ...prev, [variables.jobId]: '' }));
    },
    onError: (error: Error) => {
      toast.error(`触发失败: ${error.message}`);
    },
  });

  // 启用/禁用任务
  const toggleMutation = useMutation({
    mutationFn: (params: { jobId: string; enabled: boolean }) =>
      apiClient.toggleSchedulerJob(params.jobId, params.enabled),
    onSuccess: () => {
      toast.success('状态已更新');
      queryClient.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: (error: Error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  // 重新加载任务
  const reloadMutation = useMutation({
    mutationFn: () => apiClient.reloadScheduler(),
    onSuccess: () => {
      toast.success('已重新加载调度任务');
      queryClient.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: (error: Error) => {
      toast.error(`重新加载失败: ${error.message}`);
    },
  });

  const jobs: SchedulerJob[] = jobsData?.data || [];

  const formatInterval = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}小时${remainingMinutes}分钟` : `${hours}小时`;
  };

  const getStrategyLabel = (type: string) => {
    const labels: { [key: string]: string } = {
      'sequential': '顺序索引',
      'random-with-cooldown': '随机冷却',
      'least-pushed-with-cooldown': '最少推送优先',
    };
    return labels[type] || type;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">调度器管理</h2>
          <p className="text-gray-600 mt-1">
            查看和管理RSS新闻自动推送调度任务
          </p>
        </div>
        <button
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${reloadMutation.isPending ? 'animate-spin' : ''}`} />
          重新加载配置
        </button>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Activity className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="text-sm text-gray-600">总任务数</div>
              <div className="text-2xl font-bold text-gray-900">{jobs.length}</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <div className="text-sm text-gray-600">运行中</div>
              <div className="text-2xl font-bold text-gray-900">
                {jobs.filter(j => j.enabled).length}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-100 rounded-lg">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <div className="text-sm text-gray-600">连续失败</div>
              <div className="text-2xl font-bold text-gray-900">
                {jobs.reduce((sum, j) => sum + j.consecutiveFailures, 0)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="space-y-4">
        {jobs.map((job) => (
          <div key={job.id} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {job.name || job.id}
                    </h3>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        job.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {job.enabled ? '运行中' : '已暂停'}
                    </span>
                    {job.consecutiveFailures > 0 && (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
                        失败 {job.consecutiveFailures} 次
                      </span>
                    )}
                  </div>
                  {job.description && (
                    <p className="text-sm text-gray-600 mt-1">{job.description}</p>
                  )}
                  <div className="text-xs text-gray-500 mt-2">ID: {job.id}</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      toggleMutation.mutate({ jobId: job.id, enabled: !job.enabled })
                    }
                    disabled={toggleMutation.isPending}
                    className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    title={job.enabled ? '暂停' : '启动'}
                  >
                    {job.enabled ? (
                      <Pause className="w-5 h-5" />
                    ) : (
                      <Play className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* 配置信息 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                    <Clock className="w-4 h-4" />
                    执行间隔
                  </div>
                  <div className="text-sm font-semibold text-gray-900">
                    {formatInterval(job.intervalMs)}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                    <Settings className="w-4 h-4" />
                    索引策略
                  </div>
                  <div className="text-sm font-semibold text-gray-900">
                    {getStrategyLabel(job.indexStrategy.type)}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-600 mb-1">当前索引</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {job.nextIndex}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-600 mb-1">上次索引</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {job.lastIndex !== null ? job.lastIndex : '-'}
                  </div>
                </div>
              </div>

              {/* 策略详情 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">策略配置</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-blue-700">池大小:</span>
                    <span className="ml-1 font-medium text-blue-900">
                      {job.indexStrategy.poolSize === -1 ? '动态' : job.indexStrategy.poolSize}
                    </span>
                  </div>
                  <div>
                    <span className="text-blue-700">起始索引:</span>
                    <span className="ml-1 font-medium text-blue-900">
                      {job.indexStrategy.startIndex}
                    </span>
                  </div>
                  {job.indexStrategy.cooldownHours !== undefined && (
                    <div>
                      <span className="text-blue-700">冷却时间:</span>
                      <span className="ml-1 font-medium text-blue-900">
                        {job.indexStrategy.cooldownHours}小时
                      </span>
                    </div>
                  )}
                  {job.indexStrategy.maxPushCount !== undefined && (
                    <div>
                      <span className="text-blue-700">最大推送:</span>
                      <span className="ml-1 font-medium text-blue-900">
                        {job.indexStrategy.maxPushCount}次
                      </span>
                    </div>
                  )}
                  {job.indexStrategy.rotateAfterEachPush !== undefined && (
                    <div>
                      <span className="text-blue-700">源轮换:</span>
                      <span className="ml-1 font-medium text-blue-900">
                        {job.indexStrategy.rotateAfterEachPush ? '是' : '否'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 手动触发 */}
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  placeholder="指定索引（可选）"
                  value={triggerIndex[job.id] || ''}
                  onChange={(e) =>
                    setTriggerIndex(prev => ({ ...prev, [job.id]: e.target.value }))
                  }
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <button
                  onClick={() => {
                    const index = triggerIndex[job.id]
                      ? parseInt(triggerIndex[job.id])
                      : undefined;
                    triggerMutation.mutate({ jobId: job.id, index });
                  }}
                  disabled={triggerMutation.isPending}
                  className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
                >
                  立即执行
                </button>
              </div>
            </div>
          </div>
        ))}

        {jobs.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无调度任务</h3>
            <p className="text-gray-600">
              请检查数据库中的 news_scheduler_jobs 表配置
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SchedulerPage;
