import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImageIcon, Printer, RefreshCw } from 'lucide-react';
import { labelsApi } from '@/api/labels';
import type { GenerateImageRequest, Label } from '@/types/label';

const MODELS: Array<{ value: GenerateImageRequest['model']; label: string; hint: string }> = [
  { value: 'sd5', label: 'SD5 2K', hint: '~21s · 便宜 · 中文友好' },
  { value: 'sd5-3k', label: 'SD5 3K', hint: '~31s · 高清版' },
  { value: 'nb2', label: 'NB2 4K', hint: '~60s · 画面完整 · 支持超宽' },
  { value: 'nbp', label: 'NBP 4K', hint: '~80s · 最高画质 · 较贵' },
  { value: 'gpt2', label: 'GPT-Image-2', hint: 'OpenAI 最新 · 多比例' },
];

export default function ImageDesignPanel() {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<GenerateImageRequest['model']>('sd5');
  const [label, setLabel] = useState<Label | null>(null);

  const generateMutation = useMutation({
    mutationFn: (req: GenerateImageRequest) => labelsApi.generateImage(req),
    onSuccess: (data) => {
      setLabel({
        id: data.id,
        prompt,
        pngPath: data.pngPath,
        pngUrl: data.pngUrl,
        targetId: data.targetId,
        status: 'draft',
        printCount: 0,
        printHistory: [],
        tags: [],
        sourceType: 'image',
        sourceModel: data.sourceModel,
        sourceImageUrl: data.sourceImageUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      toast.success(`AI 出图成功（${(data.bizyairLatencyMs / 1000).toFixed(1)}s）`);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.message || '生成失败';
      toast.error(`AI 生成失败：${msg}`);
    },
  });

  const printMutation = useMutation({
    mutationFn: (id: string) => labelsApi.print(id),
    onSuccess: () => {
      if (label) setLabel({ ...label, status: 'printed', printCount: label.printCount + 1 });
      toast.success('打印任务已发送');
    },
    onError: () => toast.error('打印失败'),
  });

  const reditherMutation = useMutation({
    mutationFn: (id: string) => labelsApi.redither(id),
    onSuccess: (data) => {
      if (label) setLabel({ ...label, pngPath: data.pngPath, pngUrl: data.pngUrl + '?t=' + Date.now() });
      toast.success('重新 dither 完成');
    },
    onError: () => toast.error('重新 dither 失败'),
  });

  const regenMutation = useMutation({
    mutationFn: (id: string) => labelsApi.regenerate(id),
    onSuccess: (data: any) => {
      if (label) setLabel({ ...label, pngUrl: (data.pngUrl ?? label.pngUrl) + '?t=' + Date.now() });
      toast.success('重新调 AI 生成完成');
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

  return (
    <div className="space-y-4">
      {/* Prompt 输入区 */}
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

      {/* Model 选择 */}
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

      {/* 生成按钮 */}
      <button
        onClick={handleGenerate}
        disabled={generateMutation.isPending || !prompt.trim()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300 transition-all-smooth"
      >
        <ImageIcon className="h-4 w-4" />
        {generateMutation.isPending ? `AI 出图中（约 ${currentModelInfo.hint.match(/~(\d+)s/)?.[1] ?? '?'}s）…` : '🎨 生成图像'}
      </button>

      {/* Loading */}
      {generateMutation.isPending && (
        <div className="flex items-center justify-center py-8">
          <div className="text-center space-y-3">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
            <p className="text-sm text-gray-500">AI 正在创作中…</p>
          </div>
        </div>
      )}

      {/* 双预览（原图 + dither） */}
      {!generateMutation.isPending && label && (
        <div className="border-t border-gray-200 pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-gray-600">AI 原图（参考）</h3>
              <div className="aspect-square overflow-hidden rounded-md bg-gray-50 border border-gray-200">
                {label.sourceImageUrl ? (
                  <img src={label.sourceImageUrl} alt="AI 原图" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-400">无原图</div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-gray-600">实物效果（dither 后）</h3>
              <div className="aspect-[2/1] overflow-hidden rounded-md bg-gray-50 border border-gray-200">
                <img src={label.pngUrl} alt="dither 预览" className="h-full w-full object-contain" />
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.confirm('确认打印此标签？') && printMutation.mutate(label.id)}
              disabled={printMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:bg-gray-300 transition-all-smooth"
            >
              <Printer className="h-4 w-4" />
              {printMutation.isPending ? '打印中…' : '打印到 niimbot'}
            </button>
            <button
              onClick={() => reditherMutation.mutate(label.id)}
              disabled={reditherMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all-smooth"
              title="不重新调 AI，仅重新 dither"
            >
              <RefreshCw className="h-4 w-4" />
              重新 dither
            </button>
            <button
              onClick={() => window.confirm('重新调 AI 生成？（会消耗一次 AI 调用）') && regenMutation.mutate(label.id)}
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
