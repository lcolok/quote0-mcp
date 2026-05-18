import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImageIcon, Printer, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { labelsApi } from '@/api/labels';
import type { GenerateImageRequest } from '@/types/label';

const MODELS: Array<{ value: GenerateImageRequest['model']; label: string; hint: string }> = [
  { value: 'sd5', label: 'SD5 2K', hint: '~21s · 便宜 · 中文友好' },
  { value: 'sd5-3k', label: 'SD5 3K', hint: '~31s · 高清版' },
  { value: 'nb2', label: 'NB2 4K', hint: '~60s · 画面完整 · 支持超宽' },
  { value: 'nbp', label: 'NBP 4K', hint: '~80s · 最高画质 · 较贵' },
  { value: 'gpt2', label: 'GPT-Image-2', hint: 'OpenAI 最新 · 多比例' },
];

export default function ImageDesignPanel() {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<GenerateImageRequest['model']>('sd5');
  const [trackingId, setTrackingId] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: (req: GenerateImageRequest) => labelsApi.generateImage(req),
    onSuccess: (data) => {
      setTrackingId(data.id);
      toast.success('已加入生成队列');
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.message || '提交失败';
      toast.error(`提交失败：${msg}`);
    },
  });

  const { data: trackedLabel } = useQuery({
    queryKey: ['label', trackingId],
    queryFn: () => labelsApi.get(trackingId!),
    enabled: !!trackingId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.status !== 'generating') return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (!trackedLabel) return;
    if (trackedLabel.status === 'draft') {
      toast.success('AI 出图完成');
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    } else if (trackedLabel.status === 'failed') {
      toast.error(`AI 生成失败：${trackedLabel.lastError ?? '未知错误'}`);
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    }
  }, [trackedLabel?.status, queryClient]);

  const printMutation = useMutation({
    mutationFn: (id: string) => labelsApi.print(id),
    onSuccess: () => {
      toast.success('打印任务已发送');
      queryClient.invalidateQueries({ queryKey: ['label', trackingId] });
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || '打印失败';
      toast.error(msg);
    },
  });

  const reditherMutation = useMutation({
    mutationFn: (id: string) => labelsApi.redither(id),
    onSuccess: () => {
      toast.success('重新 dither 完成');
      queryClient.invalidateQueries({ queryKey: ['label', trackingId] });
    },
    onError: () => toast.error('重新 dither 失败'),
  });

  const regenMutation = useMutation({
    mutationFn: (id: string) => labelsApi.regenerate(id),
    onSuccess: () => {
      toast.success('已重新加入队列');
      queryClient.invalidateQueries({ queryKey: ['label', trackingId] });
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
    onError: () => toast.error('重新生成失败'),
  });

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast.error('请输入 prompt');
      return;
    }
    generateMutation.mutate({ prompt, model });
  };

  const currentModelInfo = MODELS.find((m) => m.value === model)!;
  const isGenerating = trackedLabel?.status === 'generating' || generateMutation.isPending;
  const isFailed = trackedLabel?.status === 'failed';
  const isDraft = trackedLabel?.status === 'draft';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">描述（prompt）</label>
        <textarea
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          rows={3}
          placeholder="例如：一只可爱的卡通猫咪图标，圆润的线条"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={generateMutation.isPending}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">AI 模型</label>
        <select
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          value={model}
          onChange={(e) => setModel(e.target.value as GenerateImageRequest['model'])}
          disabled={generateMutation.isPending}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label} — {m.hint}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500">当前选择：{currentModelInfo.hint}</p>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generateMutation.isPending || !prompt.trim()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300 transition-all-smooth"
      >
        <ImageIcon className="h-4 w-4" />
        {generateMutation.isPending ? '提交中…' : '🎨 提交生成任务'}
      </button>

      {isGenerating && trackedLabel && (
        <div className="flex flex-col items-center justify-center py-12 space-y-3 border border-purple-200 bg-purple-50 rounded-lg">
          <Loader2 className="h-10 w-10 animate-spin text-purple-600" />
          <p className="text-sm text-purple-800 font-medium">
            AI 正在创作中… 预计 {currentModelInfo.hint.match(/~(\d+)s/)?.[1] ?? '?'}s
          </p>
          <p className="text-xs text-gray-500">
            可以刷新页面，任务在后台继续。完成后会在右侧列表中显示。
          </p>
        </div>
      )}

      {isFailed && trackedLabel && (
        <div className="flex flex-col items-start gap-2 p-4 border border-red-200 bg-red-50 rounded-lg">
          <div className="flex items-center gap-2 text-red-700 font-medium">
            <AlertCircle className="h-5 w-5" />
            生成失败
          </div>
          <p className="text-xs text-red-600 break-all">{trackedLabel.lastError ?? '未知错误'}</p>
          <button
            onClick={() => regenMutation.mutate(trackedLabel.id)}
            disabled={regenMutation.isPending}
            className="mt-1 inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-800 underline"
          >
            <RefreshCw className="h-3 w-3" /> 重试
          </button>
        </div>
      )}

      {isDraft && trackedLabel && (
        <div className="border-t border-gray-200 pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-gray-600">AI 原图（参考）</h3>
              <div className="aspect-square overflow-hidden rounded-md bg-gray-50 border border-gray-200">
                {trackedLabel.sourceImageUrl ? (
                  <img src={trackedLabel.sourceImageUrl} alt="AI 原图" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-400">无原图</div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-gray-600">实物效果（dither 后）</h3>
              <div className="aspect-[2/1] overflow-hidden rounded-md bg-gray-50 border border-gray-200">
                <img src={trackedLabel.pngUrl} alt="dither 预览" className="h-full w-full object-contain" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.confirm('确认打印此标签？') && printMutation.mutate(trackedLabel.id)}
              disabled={printMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:bg-gray-300 transition-all-smooth"
            >
              <Printer className="h-4 w-4" />
              {printMutation.isPending ? '打印中…' : '打印到 niimbot'}
            </button>
            <button
              onClick={() => reditherMutation.mutate(trackedLabel.id)}
              disabled={reditherMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all-smooth"
              title="不重新调 AI，仅重新 dither"
            >
              <RefreshCw className="h-4 w-4" />
              重新 dither
            </button>
            <button
              onClick={() => window.confirm('重新调 AI 生成？（会消耗一次 AI 调用）') && regenMutation.mutate(trackedLabel.id)}
              disabled={regenMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all-smooth"
            >
              <RefreshCw className="h-4 w-4" />
              重新生成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
