import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Printer, RefreshCw, Archive, ImageIcon } from 'lucide-react';
import SavePresetDialog from '@/components/SavePresetDialog';
import DitherSelectorGrid from '@/components/DitherSelectorGrid';
import DeviceInfoCard from '@/components/DeviceInfoCard';
import PrintDeviceDialog from '@/components/PrintDeviceDialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
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
import StatusBadge from '@/components/StatusBadge';

export default function DetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from');
  const tabFromQuery = searchParams.get('tab');

  const backPath = (() => {
    if (from === 'design') {
      return tabFromQuery ? `/?tab=${tabFromQuery}` : '/';
    }
    if (from === 'history') {
      return '/history';
    }
    return '/history';
  })();

  const backLabel = from === 'design' ? '设计' : '历史';
  const [printOpen, setPrintOpen] = useState(false);

  const { data: label, isLoading, refetch } = useQuery({
    queryKey: ['label', id],
    queryFn: () => labelsApi.get(id!),
    enabled: !!id,
  });

  const printMutation = useMutation({
    mutationFn: ({ lid, req }: { lid: string; req?: Parameters<typeof labelsApi.print>[1] }) =>
      labelsApi.print(lid, req),
    onSuccess: () => {
      toast.success('打印任务已发送');
      setPrintOpen(false);
      refetch();
    },
    onError: () => {
      toast.error('打印失败');
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: labelsApi.regenerate,
    onSuccess: () => {
      toast.success('重新生成成功');
      refetch();
    },
    onError: () => {
      toast.error('重新生成失败');
    },
  });

  const reditherMutation = useMutation({
    mutationFn: () => labelsApi.redither(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['label', id] });
      toast.success('重新 dither 完成');
    },
    onError: () => {
      toast.error('重新 dither 失败');
    },
  });

  const regenDecorationMut = useMutation({
    mutationFn: (lid: string) => labelsApi.regenDecoration(lid),
    onSuccess: () => {
      toast.success('装饰重新生成完成');
      queryClient.invalidateQueries({ queryKey: ['label', id] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error || '重新生成装饰失败');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: labelsApi.delete,
    onSuccess: () => {
      toast.success('已归档（删除）');
      navigate(backPath);
    },
    onError: () => {
      toast.error('归档失败');
    },
  });



  const handleRegenerate = () => {
    if (!label) return;
    regenerateMutation.mutate(label.id);
  };

  const handleRedither = () => {
    if (!label) return;
    reditherMutation.mutate();
  };

  const handleArchive = () => {
    if (!label) return;
    archiveMutation.mutate(label.id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!label) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 text-center text-muted-foreground">
        标签不存在
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate(backPath)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {backLabel}
        </Button>
        <h1 className="text-xl font-semibold text-foreground">标签详情</h1>
      </div>

      <DeviceInfoCard />

      <Card className="p-6 space-y-4">
        <div>
          <span className="text-sm text-muted-foreground">Prompt:</span>
          <p className="mt-1 text-base font-medium text-foreground">{label.prompt}</p>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:w-[480px] shrink-0 space-y-3">
            <img
              src={`${label.pngUrl}?v=${encodeURIComponent(label.updatedAt)}`}
              alt={label.prompt}
              className="w-full max-w-[480px] aspect-[2/1] rounded-lg border border-border object-contain bg-background"
            />
            {label.sourceType === 'image' && label.sourceImageUrl && (
              <div>
                <span className="text-xs text-muted-foreground mb-1 block">AI 原图</span>
                <img
                  src={label.sourceImageUrl}
                  alt="AI 原图"
                  className="w-full max-w-[480px] rounded-lg border border-border object-contain bg-muted"
                />
              </div>
            )}
            {label.sourceType === 'image' && label.sourceImageUrl && (
              <DitherSelectorGrid
                labelId={label.id}
                currentAlgorithm={label.ditherAlgorithm}
                onApplied={() => refetch()}
              />
            )}
            {label.sourceType === 'widget' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Widget:</span>
                  <span className="font-medium">{label.sourceModel}</span>
                </div>
                {label.fontFamily && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">字体:</span>
                    <span>{label.fontFamily}</span>
                  </div>
                )}
                {label.widgetProps && (
                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer">Widget props JSON</summary>
                    <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                      {JSON.stringify(label.widgetProps, null, 2)}
                    </pre>
                  </details>
                )}
                {label.iconSvg && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">SVG icon (LLM 生成):</span>
                    <div className="w-16 h-16 p-2 bg-muted rounded border border-border flex items-center justify-center">
                      <svg
                        width="48"
                        height="48"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d={label.iconSvg}
                          fill="currentColor"
                          stroke="currentColor"
                          strokeWidth={0.3}
                        />
                      </svg>
                    </div>
                  </div>
                )}
                {label.frameSvgPaths && label.frameSvgPaths.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">装饰 frame paths ({label.frameSvgPaths.length} 个):</span>
                    <details className="text-xs">
                      <summary className="text-muted-foreground cursor-pointer">展开 path d 值</summary>
                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                        {label.frameSvgPaths.join('\n')}
                      </pre>
                    </details>
                  </div>
                )}
                {label.decoratorCode && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">装饰函数代码 (LLM 生成):</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => regenDecorationMut.mutate(label.id)}
                        disabled={regenDecorationMut.isPending}
                      >
                        🔀 重新生成装饰
                      </Button>
                    </div>
                    <details className="text-xs">
                      <summary className="text-muted-foreground cursor-pointer">展开 JS 代码</summary>
                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-64">
                        {label.decoratorCode}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2 text-sm md:flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">targetId:</span>
              <span className="font-mono text-foreground">{label.targetId}</span>
            </div>
            {label.sourceType && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">来源:</span>
                <span className="inline-flex items-center gap-1 text-foreground">
                  {label.sourceType === 'image' && <ImageIcon className="h-3 w-3 text-purple-600 dark:text-purple-400" />}
                  {label.sourceType === 'image' ? '图像（AI）' : label.sourceType}
                </span>
              </div>
            )}
            {label.sourceModel && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">模型:</span>
                <span className="text-foreground">{label.sourceModel}</span>
              </div>
            )}
            {label.llmModel && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">LLM:</span>
                <span className="text-foreground">{label.llmModel}</span>
              </div>
            )}
            {typeof label.llmLatencyMs === 'number' && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Latency:</span>
                <span className="text-foreground">{(label.llmLatencyMs / 1000).toFixed(1)}s</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              <StatusBadge status={label.status} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Print Count:</span>
              <span className="text-foreground">{label.printCount}</span>
            </div>
            {label.tags.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Tags:</span>
                <span className="text-foreground">{label.tags.join(', ')}</span>
              </div>
            )}
          </div>
        </div>

        {label.printHistory.length > 0 && (
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground mb-2">打印历史</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {label.printHistory.map((p, idx) => (
                <li key={idx}>
                  <Separator className="mb-1" />
                  {new Date(p.printedAt).toLocaleString('zh-CN')} → niimbot @ {p.niimbotEndpoint} (HTTP{' '}
                  {p.httpStatus})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button variant="outline" onClick={() => setPrintOpen(true)} disabled={printMutation.isPending}>
            <Printer className="h-4 w-4 mr-2" />
            {printMutation.isPending ? '打印中...' : '重新打印'}
          </Button>

          <Button
            variant="outline"
            onClick={handleRegenerate}
            disabled={regenerateMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
            {regenerateMutation.isPending ? '重新生成中...' : '重新生成'}
          </Button>

          {label.sourceType === 'image' && (
            <Button
              variant="outline"
              onClick={handleRedither}
              disabled={reditherMutation.isPending}
              title="不重新调 AI，仅重新 dither"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${reditherMutation.isPending ? 'animate-spin' : ''}`} />
              {reditherMutation.isPending ? '重新 dither 中...' : '重新 dither'}
            </Button>
          )}

          {label.sourceType === 'image' && (
            <SavePresetDialog
              labelId={label.id}
              defaultPrompt={label.prompt}
              defaultModel={label.sourceModel}
            />
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={archiveMutation.isPending} className="border-yellow-500/50 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950/20">
                <Archive className="h-4 w-4 mr-2" />
                {archiveMutation.isPending ? '归档中...' : '归档'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认归档？</AlertDialogTitle>
                <AlertDialogDescription>归档后将删除此标签，无法撤销。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleArchive}>归档</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Card>

      {label && (
        <PrintDeviceDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          targetId={label.targetId}
          pending={printMutation.isPending}
          onConfirm={(deviceId) => printMutation.mutate({ lid: label.id, req: { deviceId } })}
          title="重新打印"
          description="选择一台热敏打印机重新打印本标签。"
        />
      )}
    </div>
  );
}
