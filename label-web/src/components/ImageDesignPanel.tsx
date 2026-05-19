import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImageIcon, Printer, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import PresetSelector from './PresetSelector';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { labelsApi } from '@/api/labels';
import type { GenerateImageRequest, Label as LabelType, LabelJob } from '@/types/label';

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
  const [trackingJobId, setTrackingJobId] = useState<string | null>(null);

  const { data: targetData } = useQuery({
    queryKey: ['niimbot-current-target'],
    queryFn: () => labelsApi.getCurrentTarget(),
    staleTime: 60_000,
    refetchOnMount: 'always',
  });

  const currentTarget = targetData?.success ? targetData.target : null;
  const fallbackTarget = targetData?.fallback;

  const generateMutation = useMutation({
    mutationFn: (req: GenerateImageRequest) => labelsApi.generateImage(req),
    onSuccess: (data) => {
      setTrackingJobId(data.jobId);
      toast.success('已加入生成队列');
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.message || '提交失败';
      toast.error(`提交失败：${msg}`);
    },
  });

  // 轮询 tracked job
  const { data: trackedJob } = useQuery<LabelJob>({
    queryKey: ['label-job', trackingJobId],
    queryFn: () => labelsApi.getJob(trackingJobId!),
    enabled: !!trackingJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || (data.state !== 'queued' && data.state !== 'running')) return false;
      return 2000;
    },
  });

  // job 成功后拉取 label 详情
  const { data: trackedLabel } = useQuery<LabelType>({
    queryKey: ['label', trackedJob?.labelId],
    queryFn: () => labelsApi.get(trackedJob!.labelId!),
    enabled: !!trackedJob?.labelId && trackedJob?.state === 'succeeded',
  });

  useEffect(() => {
    if (!trackedJob) return;
    if (trackedJob.state === 'succeeded') {
      toast.success('AI 出图完成');
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    } else if (trackedJob.state === 'failed') {
      toast.error(`AI 生成失败：${trackedJob.lastError ?? '未知错误'}`);
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    }
  }, [trackedJob?.state, queryClient]);

  const printMutation = useMutation({
    mutationFn: (id: string) => labelsApi.print(id),
    onSuccess: () => {
      toast.success('打印任务已发送');
      queryClient.invalidateQueries({ queryKey: ['label', trackedJob?.labelId] });
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
      queryClient.invalidateQueries({ queryKey: ['label', trackedJob?.labelId] });
    },
    onError: () => toast.error('重新 dither 失败'),
  });

  const regenMutation = useMutation({
    mutationFn: (id: string) => labelsApi.regenerate(id),
    onSuccess: () => {
      toast.success('已重新加入队列');
      queryClient.invalidateQueries({ queryKey: ['label', trackedJob?.labelId] });
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
  const isGenerating =
    trackedJob?.state === 'queued' || trackedJob?.state === 'running' || generateMutation.isPending;
  const isFailed = trackedJob?.state === 'failed';
  const isDraft = trackedJob?.state === 'succeeded';

  return (
    <div className="space-y-4">
      {/* 当前打印目标显示 */}
      {targetData && (
        <div className={`flex items-center gap-2 p-3 rounded border text-sm ${currentTarget ? 'bg-muted/50 border-border' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
          {currentTarget ? <Printer className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>
            {currentTarget ? (
              <>
                将打印到 <strong>{currentTarget.device?.model ?? 'NiimBot 打印机'}</strong>，
                装载 <strong>{currentTarget.widthMm}×{currentTarget.heightMm}mm</strong> RFID 标签
                {currentTarget.remainingMm !== undefined && currentTarget.totalMm !== undefined && (
                  <span className="text-xs text-muted-foreground ml-2">
                    （剩余 {currentTarget.remainingMm}/{currentTarget.totalMm}mm）
                  </span>
                )}
              </>
            ) : (
              <>
                未检测到 niimbot 网关，按 <strong>{fallbackTarget?.widthMm}×{fallbackTarget?.heightMm}mm</strong> 默认尺寸生成
              </>
            )}
          </span>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-sm font-medium text-foreground">描述（prompt）</label>
          <PresetSelector
            disabled={generateMutation.isPending}
            onSelect={(p) => {
              setPrompt(p.prompt);
              if (p.model) setModel(p.model as any);
              toast.success(`已应用预设：${p.name}`);
            }}
          />
        </div>
        <Textarea
          rows={3}
          placeholder="例如：一只可爱的卡通猫咪图标，圆润的线条"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={generateMutation.isPending}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground">AI 模型</label>
        <Select
          value={model}
          onValueChange={(v) => setModel(v as GenerateImageRequest['model'])}
          disabled={generateMutation.isPending}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择模型" />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label} — {m.hint}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">当前选择：{currentModelInfo.hint}</p>
      </div>

      <Button
        onClick={handleGenerate}
        disabled={generateMutation.isPending || !prompt.trim()}
        className="w-full"
      >
        <ImageIcon className="h-4 w-4 mr-2" />
        {generateMutation.isPending ? '提交中…' : '🎨 提交生成任务'}
      </Button>

      {isGenerating && (
        <Card className="flex flex-col items-center justify-center py-12 space-y-3 border-purple-200 bg-purple-50 dark:bg-purple-950/20">
          <Loader2 className="h-10 w-10 animate-spin text-purple-600 dark:text-purple-400" />
          <p className="text-sm text-purple-800 dark:text-purple-300 font-medium">
            {trackedJob?.state === 'running' ? 'AI 正在创作中…' : '任务已加入队列'}
          </p>
          <p className="text-xs text-muted-foreground">
            可以刷新页面，任务在后台继续。完成后会在右侧列表中显示。
          </p>
        </Card>
      )}

      {isFailed && (
        <Card className="flex flex-col items-start gap-2 p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertCircle className="h-5 w-5" />
            生成失败
          </div>
          <p className="text-xs text-destructive/80 break-all">
            {trackedJob?.lastError ?? '未知错误'}
          </p>
        </Card>
      )}

      {isDraft && trackedLabel && (
        <div className="border-t border-border pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">AI 原图（参考）</h3>
              <Card className="aspect-square overflow-hidden rounded-md p-0">
                {trackedLabel.sourceImageUrl ? (
                  <img src={trackedLabel.sourceImageUrl} alt="AI 原图" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">无原图</div>
                )}
              </Card>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">实物效果（dither 后）</h3>
              <Card className="aspect-[2/1] overflow-hidden rounded-md p-0">
                <img src={trackedLabel.pngUrl} alt="dither 预览" className="h-full w-full object-contain" />
              </Card>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={printMutation.isPending}>
                  <Printer className="h-4 w-4 mr-2" />
                  {printMutation.isPending ? '打印中…' : '打印到 niimbot'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认打印？</AlertDialogTitle>
                  <AlertDialogDescription>将向 niimbot 热敏标签机推送本标签。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => printMutation.mutate(trackedLabel.id)}>打印</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              variant="outline"
              onClick={() => reditherMutation.mutate(trackedLabel.id)}
              disabled={reditherMutation.isPending}
              title="不重新调 AI，仅重新 dither"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              重新 dither
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={regenMutation.isPending}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  重新生成
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认重新生成？</AlertDialogTitle>
                  <AlertDialogDescription>将重新调用 AI 生成图像（会消耗一次 AI 调用）。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => regenMutation.mutate(trackedLabel.id)}>重新生成</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
    </div>
  );
}
