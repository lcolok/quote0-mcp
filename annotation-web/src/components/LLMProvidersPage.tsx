import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Plus,
  Pencil,
  Trash2,
  Zap,
  CheckCircle2,
  X,
  Loader2,
  Server,
  Cpu,
} from 'lucide-react';
import { toast } from 'sonner';
import { llmProvidersApi, type LLMProvider, type LLMModel } from '../api/llm-providers';

export default function LLMProvidersPage() {
  const queryClient = useQueryClient();
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LLMProvider | null>(null);
  const [editingModel, setEditingModel] = useState<LLMModel | null>(null);
  const [activeModelProviderId, setActiveModelProviderId] = useState<number | null>(null);

  // 查询 providers
  const { data: providersData, isLoading } = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => llmProvidersApi.getProviders(),
    refetchInterval: 10000,
  });

  // 查询 active
  const { data: activeData } = useQuery({
    queryKey: ['llm-active'],
    queryFn: () => llmProvidersApi.getActive(),
    refetchInterval: 10000,
  });

  const providers: LLMProvider[] = providersData?.data || [];
  const active = activeData?.data;

  // Mutations
  const setActiveMutation = useMutation({
    mutationFn: ({ providerId, modelId }: { providerId: number; modelId: number }) =>
      llmProvidersApi.setActive(providerId, modelId),
    onSuccess: () => {
      toast.success('已切换 active model');
      queryClient.invalidateQueries({ queryKey: ['llm-active'] });
    },
    onError: (err: Error) => toast.error(`切换失败: ${err.message}`),
  });

  const deleteProviderMutation = useMutation({
    mutationFn: (id: number) => llmProvidersApi.deleteProvider(id),
    onSuccess: () => {
      toast.success('Provider 已删除');
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
    },
    onError: (err: Error) => toast.error(`删除失败: ${err.message}`),
  });

  const deleteModelMutation = useMutation({
    mutationFn: ({ pid, mid }: { pid: number; mid: number }) => llmProvidersApi.deleteModel(pid, mid),
    onSuccess: () => {
      toast.success('Model 已删除');
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
    },
    onError: (err: Error) => toast.error(`删除失败: ${err.message}`),
  });

  const testMutation = useMutation({
    mutationFn: ({ providerId, modelId }: { providerId: number; modelId: number }) =>
      llmProvidersApi.testProvider(providerId, modelId),
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`测试通过 (${data.latency_ms}ms): ${data.response}`);
      } else {
        toast.error(`测试失败: ${data.error}`);
      }
    },
    onError: (err: Error) => toast.error(`测试失败: ${err.message}`),
  });

  const activeProvider = providers.find((p) => p.id === active?.active_provider_id);
  const activeModel = activeProvider?.models?.find((m) => m.id === active?.active_model_id);

  return (
    <div className="h-[calc(100vh-4rem)] overflow-y-auto p-6">
      {/* 顶部 Active 卡片 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-50 rounded-full">
              <Brain className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">当前 Active LLM</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {activeProvider?.display_name || '—'} / {activeModel?.display_name || '—'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 truncate max-w-md">
                {activeProvider?.base_url || '—'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (active?.active_provider_id && active?.active_model_id) {
                testMutation.mutate({
                  providerId: active.active_provider_id,
                  modelId: active.active_model_id,
                });
              }
            }}
            disabled={testMutation.isPending || !active}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            测试
          </button>
        </div>
      </div>

      {/* Providers 列表 */}
      <div className="space-y-4 mb-8">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Providers</h3>
          <button
            onClick={() => {
              setEditingProvider(null);
              setProviderModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            新建 Provider
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : providers.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            <Server className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>暂无 Provider</p>
          </div>
        ) : (
          providers.map((provider) => (
            <div key={provider.id} className="bg-white rounded-lg shadow overflow-hidden">
              {/* Card Header */}
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5 text-gray-500" />
                  <div>
                    <div className="font-medium text-gray-900">
                      {provider.display_name}
                      <span className="ml-2 text-xs text-gray-400">({provider.slug})</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {provider.base_url}
                      <span className="ml-2 text-gray-400">
                        key: ****{provider.api_key.slice(-4)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      provider.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {provider.enabled ? '启用' : '禁用'}
                  </span>
                  <button
                    onClick={() => {
                      setEditingProvider(provider);
                      setProviderModalOpen(true);
                    }}
                    className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteProviderMutation.mutate(provider.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Models */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-700">Models</h4>
                  <button
                    onClick={() => {
                      setEditingModel(null);
                      setActiveModelProviderId(provider.id);
                      setModelModalOpen(true);
                    }}
                    className="flex items-center gap-1 text-xs px-2 py-1 text-primary-600 hover:bg-primary-50 rounded"
                  >
                    <Plus className="w-3 h-3" />
                    添加 Model
                  </button>
                </div>
                <div className="space-y-2">
                  {provider.models?.map((model) => (
                    <div
                      key={model.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Cpu className="w-4 h-4 text-gray-400" />
                        <div>
                          <div className="text-sm text-gray-900">
                            {model.display_name}
                            <span className="ml-1 text-xs text-gray-400">({model.model_id})</span>
                          </div>
                          <div className="text-xs text-gray-500">
                            ctx={model.context_window || '-'} / max_tokens={model.max_tokens || '-'}
                            {model.reasoning ? ' / reasoning' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {active?.active_model_id === model.id ? (
                          <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            当前激活
                          </span>
                        ) : (
                          <button
                            onClick={() =>
                              setActiveMutation.mutate({
                                providerId: provider.id,
                                modelId: model.id,
                              })
                            }
                            disabled={setActiveMutation.isPending}
                            className="text-xs px-2 py-1 text-primary-600 border border-primary-200 hover:bg-primary-50 rounded"
                          >
                            设为 active
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingModel(model);
                            setActiveModelProviderId(provider.id);
                            setModelModalOpen(true);
                          }}
                          className="p-1 text-gray-500 hover:bg-gray-200 rounded"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            deleteModelMutation.mutate({ pid: provider.id, mid: model.id })
                          }
                          className="p-1 text-red-500 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!provider.models?.length && (
                    <div className="text-xs text-gray-400 py-2">暂无 model</div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Provider Modal */}
      {providerModalOpen && (
        <ProviderModal
          provider={editingProvider}
          onClose={() => setProviderModalOpen(false)}
          onSaved={() => {
            setProviderModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
          }}
        />
      )}

      {/* Model Modal */}
      {modelModalOpen && activeModelProviderId !== null && (
        <ModelModal
          providerId={activeModelProviderId}
          model={editingModel}
          onClose={() => setModelModalOpen(false)}
          onSaved={() => {
            setModelModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
          }}
        />
      )}
    </div>
  );
}

// Provider Modal
function ProviderModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: LLMProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    slug: provider?.slug || '',
    display_name: provider?.display_name || '',
    base_url: provider?.base_url || '',
    api_key: provider?.api_key || '',
    api_type: provider?.api_type || 'openai-completions',
    enabled: provider?.enabled ?? true,
  });

  const mutation = useMutation({
    mutationFn: () =>
      provider
        ? llmProvidersApi.updateProvider(provider.id, form)
        : llmProvidersApi.createProvider(form as any),
    onSuccess: () => {
      toast.success(provider ? 'Provider 已更新' : 'Provider 已创建');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            {provider ? '编辑 Provider' : '新建 Provider'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Type</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.api_type}
              onChange={(e) => setForm({ ...form, api_type: e.target.value })}
            >
              <option value="openai-completions">openai-completions</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="p-enabled"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <label htmlFor="p-enabled" className="text-sm text-gray-700">
              启用
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {mutation.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Model Modal
function ModelModal({
  providerId,
  model,
  onClose,
  onSaved,
}: {
  providerId: number;
  model: LLMModel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    model_id: model?.model_id || '',
    display_name: model?.display_name || '',
    context_window: model?.context_window || undefined,
    max_tokens: model?.max_tokens || undefined,
    reasoning: model?.reasoning || false,
    enabled: model?.enabled ?? true,
  });

  const mutation = useMutation({
    mutationFn: () =>
      model
        ? llmProvidersApi.updateModel(providerId, model.id, form)
        : llmProvidersApi.createModel(providerId, form as any),
    onSuccess: () => {
      toast.success(model ? 'Model 已更新' : 'Model 已创建');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{model ? '编辑 Model' : '新建 Model'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Model ID</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.model_id}
              onChange={(e) => setForm({ ...form, model_id: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Context Window</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                value={form.context_window || ''}
                onChange={(e) =>
                  setForm({ ...form, context_window: e.target.value ? parseInt(e.target.value) : undefined })
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Tokens</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                value={form.max_tokens || ''}
                onChange={(e) =>
                  setForm({ ...form, max_tokens: e.target.value ? parseInt(e.target.value) : undefined })
                }
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="m-reasoning"
              checked={form.reasoning}
              onChange={(e) => setForm({ ...form, reasoning: e.target.checked })}
            />
            <label htmlFor="m-reasoning" className="text-sm text-gray-700">
              Reasoning
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="m-enabled"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <label htmlFor="m-enabled" className="text-sm text-gray-700">
              启用
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {mutation.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
