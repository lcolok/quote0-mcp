import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkles, Printer, RefreshCw, Loader2, AlertCircle, Wand2 } from 'lucide-react';
import LlmModelSelector from './LlmModelSelector';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { labelsApi } from '@/api/labels';
import type { GenerateTextRequest, Label as LabelType, WidgetMeta, FontMeta } from '@/types/label';

const AUTO = '__auto__';

export default function TextDesignPanel() {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [widgetChoice, setWidgetChoice] = useState<string>(AUTO);
  const [fontChoice, setFontChoice] = useState<string>(AUTO);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  // Catalog
  const { data: widgets = [] } = useQuery<WidgetMeta[]>({
    queryKey: ['widgets-catalog'],
    queryFn: () => labelsApi.fetchWidgets(),
    staleTime: Infinity,
  });
  const { data: fonts = [] } = useQuery<FontMeta[]>({
    queryKey: ['fonts-catalog'],
    queryFn: () => labelsApi.fetchFonts(),
    staleTime: Infinity,
  });

  // 发起生成
  const generateMutation = useMutation({
    mutationFn: (req: GenerateTextRequest) => labelsApi.generateText(req),
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

  // 轮询 tracked label
  const { data: trackedLabel } = useQuery<LabelType>({
    queryKey: ['label', trackingId],
    queryFn: () => labelsApi.get(trackingId!),
    enabled: !!trackingId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.status !== 'generating') return false;
      return 1500;
    },
  });

  // 终态触发 toast + 列表刷新
  useEffect(() => {
    if (!trackedLabel) return;
    if (trackedLabel.status === 'draft') {
      toast.success(`文字标签生成完成 (${trackedLabel.sourceModel ?? 'widget'})`);
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    } else if (trackedLabel.status === 'failed') {
      toast.error(`生成失败：${trackedLabel.lastError ?? '未知错误'}`);
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
      toast.error(e?.response?.data?.error || '打印失败');
    },
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
    const req: GenerateTextRequest = { prompt: prompt.trim() };
    if (widgetChoice !== AUTO) req.preferredWidget = widgetChoice as any;
    if (fontChoice !== AUTO) req.preferredFont = fontChoice as any;
    generateMutation.mutate(req);
  };

  const isGenerating = trackedLabel?.status === 'generating' || generateMutation.isPending;
  const isFailed = trackedLabel?.status === 'failed';
  const isDraft = trackedLabel?.status === 'draft';

  return (
    <div className="space-y-4">
      {/* Prompt */}
      <div className="space-y-2">
        <Label htmlFor="text-prompt">描述你想要的标签</Label>
        <Textarea
          id="text-prompt"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例：会议室 A 门牌 / 番茄 9.9 元价签 / 请保持安静的告示"
          disabled={generateMutation.isPending}
          className="resize-none"
        />
      </div>

      {/* LLM 模型选择 */}
      <LlmModelSelector />

      {/* Widget 选择 */}
      <div className="space-y-2">
        <Label>Widget 模板（默认让 LLM 自动选）</Label>
        <ToggleGroup
          type="single"
          value={widgetChoice}
          onValueChange={(v) => v && setWidgetChoice(v)}
          variant="outline"
          className="justify-start flex-wrap"
        >
          <ToggleGroupItem value={AUTO} className="gap-1">
            <Wand2 className="h-3.5 w-3.5" />
            自动
          </ToggleGroupItem>
          {widgets.map((w) => (
            <ToggleGroupItem key={w.id} value={w.id} title={w.description}>
              {w.displayName}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {widgetChoice !== AUTO && (
          <p className="text-xs text-muted-foreground">
            {widgets.find((w) => w.id === widgetChoice)?.description}
          </p>
        )}
      </div>

      {/* 字体选择 */}
      <div className="space-y-2">
        <Label>字体（默认让 LLM 自动选）</Label>
        <ToggleGroup
          type="single"
          value={fontChoice}
          onValueChange={(v) => v && setFontChoice(v)}
          variant="outline"
          className="justify-start flex-wrap"
        >
          <ToggleGroupItem value={AUTO} className="gap-1">
            <Wand2 className="h-3.5 w-3.5" />
            自动
          </ToggleGroupItem>
          {fonts.map((f) => (
            <ToggleGroupItem key={f.family} value={f.family} title={f.description}>
              {f.displayName}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {fontChoice !== AUTO && (
          <p className="text-xs text-muted-foreground">
            {fonts.find((f) => f.family === fontChoice)?.description}
          </p>
        )}
      </div>

      {/* 生成按钮 */}
      <Button
        onClick={handleGenerate}
        disabled={generateMutation.isPending || !prompt.trim()}
        className="w-full"
      >
        <Sparkles className="h-4 w-4 mr-2" />
        {generateMutation.isPending ? '提交中…' : '生成'}
      </Button>

      {/* Generating */}
      {isGenerating && trackedLabel && (
        <Card className="border-primary/30 bg-primary/5 py-8">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">LLM 正在为你设计…（约 3-5 秒）</p>
            <p className="text-xs text-muted-foreground">可以刷新页面，任务在后台继续</p>
          </div>
        </Card>
      )}

      {/* Failed */}
      {isFailed && trackedLabel && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertCircle className="h-5 w-5" />
            生成失败
          </div>
          <p className="text-xs text-destructive/80 break-all">
            {trackedLabel.lastError ?? '未知错误'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => regenMutation.mutate(trackedLabel.id)}
            disabled={regenMutation.isPending}
            className="border-destructive/40"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            重试
          </Button>
        </Card>
      )}

      {/* Draft：预览 + 操作 */}
      {isDraft && trackedLabel && (
        <Card className="p-4 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">预览</Label>
            <div className="aspect-[2/1] bg-muted rounded-md overflow-hidden border border-border flex items-center justify-center">
              <img
                src={trackedLabel.pngUrl}
                alt={trackedLabel.prompt}
                className="h-full w-full object-contain"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <Label className="text-muted-foreground">Widget</Label>
              <p className="font-medium">{trackedLabel.sourceModel ?? '-'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">字体</Label>
              <p className="font-medium">{trackedLabel.fontFamily ?? '-'}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={printMutation.isPending}>
                  <Printer className="h-4 w-4 mr-2" />
                  {printMutation.isPending ? '打印中…' : '打印'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认打印？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将向 niimbot 热敏标签机推送本标签。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => printMutation.mutate(trackedLabel.id)}>
                    打印
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              onClick={() => regenMutation.mutate(trackedLabel.id)}
              disabled={regenMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${regenMutation.isPending ? 'animate-spin' : ''}`} />
              重新生成
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
