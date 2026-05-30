import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import {
  Plus,
  Trash2,
  Edit2,
  Play,
  Power,
  PowerOff,
  Settings2,
  Clock,
  Code2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SchedulerJob } from '../types/scheduler';

interface JobFormData {
  id: string;
  name: string;
  description: string;
  category: string;
  dataSource: string;
  rssSource: string;
  rssSources: string;
  processor: string;
  renderer: string;
  intervalMinutes: number;
  enabled: boolean;
  jobRole: 'producer' | 'consumer' | 'mixed';
  indexStrategy: string;
}

const DEFAULT_FORM: JobFormData = {
  id: '',
  name: '',
  description: '',
  category: 'technology',
  dataSource: 'rss',
  rssSource: '',
  rssSources: '',
  processor: 'passthrough',
  renderer: 'device',
  intervalMinutes: 5,
  enabled: true,
  jobRole: 'mixed',
  indexStrategy: JSON.stringify(
    {
      type: 'fair-rotation',
      poolSize: 10,
      startIndex: 0,
      cooldownHours: 24,
      maxPushCount: 5,
      rotateAfterEachPush: true,
      skipEmptySource: true,
    },
    null,
    2
  ),
};

function jobToForm(job: SchedulerJob): JobFormData {
  return {
    id: job.id,
    name: job.name || '',
    description: job.description || '',
    category: job.category || 'technology',
    dataSource: job.dataSource || 'rss',
    rssSource: job.rssSource || '',
    rssSources: (job.rssSources || []).join('\n'),
    processor: job.processor || 'passthrough',
    renderer: job.renderer || 'device',
    intervalMinutes: job.intervalMs ? Math.round(job.intervalMs / 60000) : 5,
    enabled: job.enabled ?? true,
    jobRole: job.jobRole || 'mixed',
    indexStrategy: job.indexStrategy
      ? JSON.stringify(job.indexStrategy, null, 2)
      : DEFAULT_FORM.indexStrategy,
  };
}

function buildDirtyBody(
  current: JobFormData,
  original: JobFormData
): Partial<Record<string, any>> {
  const dirty: Partial<Record<string, any>> = {};
  const keys = Object.keys(current) as Array<keyof JobFormData>;
  for (const key of keys) {
    if (key === 'id') continue;
    const cur = current[key];
    const orig = original[key];
    if (JSON.stringify(cur) !== JSON.stringify(orig)) {
      if (key === 'intervalMinutes') {
        dirty.intervalMs = (cur as number) * 60000;
      } else if (key === 'rssSources') {
        dirty.rssSources = (cur as string)
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (key === 'indexStrategy') {
        try {
          dirty.indexStrategy = JSON.parse(cur as string);
        } catch {
          // invalid JSON, skip or let validation catch it
        }
      } else {
        dirty[key] = cur;
      }
    }
  }
  return dirty;
}

function formatInterval(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}min`;
}

function roleBadge(role: string) {
  const classes: Record<string, string> = {
    producer: 'bg-blue-100 text-blue-700',
    consumer: 'bg-green-100 text-green-700',
    mixed: 'bg-purple-100 text-purple-700',
  };
  const labels: Record<string, string> = {
    producer: 'Producer',
    consumer: 'Consumer',
    mixed: 'Mixed',
  };
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
        classes[role] || 'bg-gray-100 text-gray-600'
      }`}
    >
      {labels[role] || role}
    </span>
  );
}

function JobsManagementPage() {
  const queryClient = useQueryClient();
  const [modalMode, setModalMode] = useState<'edit' | 'create' | null>(null);
  const [form, setForm] = useState<JobFormData>(DEFAULT_FORM);
  const [originalForm, setOriginalForm] = useState<JobFormData>(DEFAULT_FORM);
  const [expandedStrategy, setExpandedStrategy] = useState<Record<string, boolean>>({});

  const { data: jobsResponse, isLoading } = useQuery({
    queryKey: ['scheduler-jobs'],
    queryFn: async () => {
      const res = await apiClient.getSchedulerJobs();
      return res.data || [];
    },
    refetchInterval: 10000,
  });

  const jobs: SchedulerJob[] = jobsResponse || [];

  const stats = useMemo(() => {
    const total = jobs.length;
    const enabled = jobs.filter((j) => j.enabled).length;
    const producers = jobs.filter((j) => j.jobRole === 'producer').length;
    const consumers = jobs.filter((j) => j.jobRole === 'consumer').length;
    return { total, enabled, producers, consumers };
  }, [jobs]);

  const toggleMutation = useMutation({
    mutationFn: async ({ jobId, enabled }: { jobId: string; enabled: boolean }) => {
      await apiClient.toggleSchedulerJob(jobId, enabled);
    },
    onSuccess: (_, vars) => {
      toast.success(`任务已${vars.enabled ? '启用' : '禁用'}`);
      queryClient.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: (error: any) => {
      toast.error(`操作失败: ${error.message}`);
    },
  });

  const triggerMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiClient.triggerSchedulerJob(jobId);
    },
    onSuccess: () => {
      toast.success('任务已手动触发');
      queryClient.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: (error: any) => {
      toast.error(`触发失败: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiClient.deleteSchedulerJob(jobId);
    },
    onSuccess: () => {
      toast.success('任务已删除');
      queryClient.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: (error: any) => {
      toast.error(`删除失败: ${error.message}`);
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ jobId, body }: { jobId: string; body: any }) => {
      const res = await apiClient.patchSchedulerJob(jobId, body);
      return res;
    },
    onSuccess: () => {
      toast.success('任务已更新');
      setModalMode(null);
      queryClient.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiClient.createSchedulerJob(body);
      return res;
    },
    onSuccess: () => {
      toast.success('任务已创建');
      setModalMode(null);
      queryClient.invalidateQueries({ queryKey: ['scheduler-jobs'] });
    },
    onError: (error: any) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const handleOpenCreate = () => {
    setForm({ ...DEFAULT_FORM });
    setOriginalForm({ ...DEFAULT_FORM });
    setModalMode('create');
  };

  const handleOpenEdit = (job: SchedulerJob) => {
    const f = jobToForm(job);
    setForm(f);
    setOriginalForm(f);
    setModalMode('edit');
  };

  const handleCloseModal = () => {
    const dirtyCount = Object.keys(buildDirtyBody(form, originalForm)).length;
    if (dirtyCount > 0) {
      if (!window.confirm('有未保存的更改，确定要关闭吗？')) return;
    }
    setModalMode(null);
  };

  const handleDelete = (jobId: string, name: string) => {
    if (!window.confirm(`确认删除任务 "${name || jobId}" 吗？`)) return;
    deleteMutation.mutate(jobId);
  };

  const validateForm = (): string | null => {
    if (modalMode === 'create' && !form.id.trim()) return '任务 ID 不能为空';
    if (!form.name.trim()) return '任务名称不能为空';
    if (!form.category.trim()) return '分类不能为空';
    if (!form.dataSource.trim()) return '数据源不能为空';
    if (!form.processor.trim()) return '处理器不能为空';
    if (!form.renderer.trim()) return '渲染器不能为空';
    if (form.intervalMinutes <= 0) return '间隔必须大于 0';
    try {
      JSON.parse(form.indexStrategy);
    } catch {
      return 'index_strategy 不是合法的 JSON';
    }
    return null;
  };

  const handleSubmit = () => {
    const err = validateForm();
    if (err) {
      toast.error(err);
      return;
    }

    if (modalMode === 'edit') {
      const dirty = buildDirtyBody(form, originalForm);
      if (Object.keys(dirty).length === 0) {
        toast.info('没有改动');
        setModalMode(null);
        return;
      }
      patchMutation.mutate({ jobId: form.id, body: dirty });
    } else {
      const body: any = {
        id: form.id.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category.trim(),
        dataSource: form.dataSource.trim(),
        processor: form.processor.trim(),
        renderer: form.renderer.trim(),
        intervalMs: form.intervalMinutes * 60000,
        enabled: form.enabled,
        jobRole: form.jobRole,
        indexStrategy: JSON.parse(form.indexStrategy),
      };
      if (form.rssSource.trim()) body.rssSource = form.rssSource.trim();
      const rssSources = form.rssSources
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (rssSources.length > 0) body.rssSources = rssSources;
      createMutation.mutate(body);
    }
  };

  const updateForm = <K extends keyof JobFormData>(key: K, value: JobFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">任务管理</h2>
          <p className="text-sm text-gray-600 mt-1">
            管理调度任务的完整配置 · 共 {stats.total} 个任务
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Plus className="w-4 h-4" />
          新建任务
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
          <div className="p-3 bg-primary-100 rounded-lg">
            <Settings2 className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-500">总任务数</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
          <div className="p-3 bg-green-100 rounded-lg">
            <Power className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stats.enabled}</div>
            <div className="text-sm text-gray-500">已启用</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Settings2 className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stats.producers}</div>
            <div className="text-sm text-gray-500">Producer</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
          <div className="p-3 bg-orange-100 rounded-lg">
            <Clock className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stats.consumers}</div>
            <div className="text-sm text-gray-500">Consumer</div>
          </div>
        </div>
      </div>

      {/* Job Cards */}
      <div className="space-y-4">
        {jobs.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
            <Settings2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>暂无调度任务</p>
          </div>
        )}
        {jobs.map((job) => {
          const isStrategyExpanded = expandedStrategy[job.id];
          return (
            <div
              key={job.id}
              className={`bg-white rounded-lg shadow overflow-hidden ${
                job.enabled ? '' : 'opacity-75'
              }`}
            >
              {/* Card Header */}
              <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      {job.id}
                    </span>
                    {roleBadge(job.jobRole || 'mixed')}
                    {!job.enabled && (
                      <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded-full">
                        已禁用
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mt-1">
                    {job.name || job.id}
                  </h3>
                  {job.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{job.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() =>
                      toggleMutation.mutate({
                        jobId: job.id,
                        enabled: !job.enabled,
                      })
                    }
                    disabled={toggleMutation.isPending}
                    className={`p-2 rounded ${
                      job.enabled
                        ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    } disabled:opacity-50`}
                    title={job.enabled ? '禁用' : '启用'}
                  >
                    {job.enabled ? (
                      <Power className="w-4 h-4" />
                    ) : (
                      <PowerOff className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => triggerMutation.mutate(job.id)}
                    disabled={triggerMutation.isPending}
                    className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded disabled:opacity-50"
                    title="手动触发"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleOpenEdit(job)}
                    className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
                    title="编辑"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(job.id, job.name || '')}
                    disabled={deleteMutation.isPending}
                    className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded disabled:opacity-50"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded font-medium">
                    {job.dataSource}
                  </span>
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded font-medium">
                    {job.processor}
                  </span>
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded font-medium">
                    {job.renderer}
                  </span>
                  <span className="px-2 py-1 bg-indigo-50 text-indigo-700 text-xs rounded font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatInterval(Math.round((job.intervalMs || 0) / 60000))}
                  </span>
                </div>

                {(job.rssSource || (job.rssSources && job.rssSources.length > 0)) && (
                  <div className="text-sm text-gray-600">
                    <div className="font-medium text-gray-700 mb-1">RSS 源</div>
                    {job.rssSource && (
                      <div className="font-mono text-xs text-gray-500 mb-1">
                        {job.rssSource}
                      </div>
                    )}
                    {job.rssSources && job.rssSources.length > 0 && (
                      <div className="space-y-0.5">
                        {job.rssSources.map((s) => (
                          <div key={s} className="font-mono text-xs text-gray-500">
                            {s}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Index Strategy */}
                <div>
                  <button
                    onClick={() =>
                      setExpandedStrategy((prev) => ({
                        ...prev,
                        [job.id]: !prev[job.id],
                      }))
                    }
                    className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span className="font-medium">index_strategy</span>
                    {isStrategyExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {isStrategyExpanded && (
                    <pre className="mt-2 p-3 bg-gray-50 rounded-lg text-xs font-mono text-gray-700 overflow-x-auto">
                      {JSON.stringify(job.indexStrategy, null, 2)}
                    </pre>
                  )}
                </div>

                {job.lastRunAt && (
                  <div className="text-xs text-gray-400">
                    上次运行: {new Date(job.lastRunAt).toLocaleString('zh-CN')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modalMode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">
                {modalMode === 'edit' ? '编辑任务' : '新建任务'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <AlertTriangle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  任务 ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.id}
                  onChange={(e) => updateForm('id', e.target.value)}
                  disabled={modalMode === 'edit'}
                  placeholder="例如: daily-news-push"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500 font-mono text-sm"
                />
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  任务名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateForm('name', e.target.value)}
                  placeholder="例如: 每日新闻推送"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  描述
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm('description', e.target.value)}
                  placeholder="任务用途说明..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  分类 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => updateForm('category', e.target.value)}
                  placeholder="technology / news / inventory"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Data Source */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  数据源 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.dataSource}
                  onChange={(e) => updateForm('dataSource', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="rss">rss</option>
                  <option value="weather">weather</option>
                  <option value="inventory">inventory</option>
                </select>
              </div>

              {/* Processor */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  处理器 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.processor}
                  onChange={(e) => updateForm('processor', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="passthrough">passthrough</option>
                  <option value="basic-llm">basic-llm</option>
                  <option value="ax-optimized">ax-optimized</option>
                </select>
              </div>

              {/* Renderer */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  渲染器 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.renderer}
                  onChange={(e) => updateForm('renderer', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="device">device</option>
                  <option value="local-eink">local-eink</option>
                  <option value="news">news</option>
                  <option value="json">json</option>
                </select>
              </div>

              {/* RSS Source (legacy) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  RSS 源（单源，向后兼容）
                </label>
                <input
                  type="text"
                  value={form.rssSource}
                  onChange={(e) => updateForm('rssSource', e.target.value)}
                  placeholder="例如: solidot"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* RSS Sources */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  RSS 源列表（多源轮换，每行一个）
                </label>
                <textarea
                  value={form.rssSources}
                  onChange={(e) => updateForm('rssSources', e.target.value)}
                  placeholder="solidot&#10;ithome&#10;cnbeta"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
                />
              </div>

              {/* Interval */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  执行间隔（分钟） <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.intervalMinutes}
                  onChange={(e) => updateForm('intervalMinutes', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Enabled */}
              <div className="flex items-center gap-3">
                <input
                  id="enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => updateForm('enabled', e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
                  启用任务
                </label>
              </div>

              {/* Job Role */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  任务角色 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.jobRole}
                  onChange={(e) =>
                    updateForm('jobRole', e.target.value as JobFormData['jobRole'])
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="producer">producer</option>
                  <option value="consumer">consumer</option>
                  <option value="mixed">mixed</option>
                </select>
              </div>

              {/* Index Strategy */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Index Strategy（JSON） <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={form.indexStrategy}
                  onChange={(e) => updateForm('indexStrategy', e.target.value)}
                  placeholder="{}"
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={patchMutation.isPending || createMutation.isPending}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {patchMutation.isPending || createMutation.isPending
                  ? '保存中...'
                  : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default JobsManagementPage;
