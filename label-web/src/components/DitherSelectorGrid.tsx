import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { type DitherAlgorithm } from '@/types/label';
import { labelsApi } from '@/api/labels';

const ALGO_LABELS: Record<DitherAlgorithm, string> = {
  threshold: '阈值',
  'bayer-4x4': 'Bayer 4×4',
  'bayer-8x8': 'Bayer 8×8',
  'bayer-16x16': 'Bayer 16×16',
  'blue-noise': '蓝噪声',
  'floyd-steinberg': 'Floyd-Steinberg',
  atkinson: 'Atkinson',
  jarvis: 'Jarvis-JNN',
  stucki: 'Stucki',
  burkes: 'Burkes',
  sierra: 'Sierra',
  'sierra-2': 'Sierra 2',
  'sierra-lite': 'Sierra Lite',
};

const GROUPS: { title: string; algos: DitherAlgorithm[] }[] = [
  { title: '有序 / 阈值', algos: ['threshold', 'bayer-4x4', 'bayer-8x8', 'bayer-16x16', 'blue-noise'] },
  {
    title: '误差扩散',
    algos: ['floyd-steinberg', 'atkinson', 'jarvis', 'stucki', 'burkes', 'sierra', 'sierra-2', 'sierra-lite'],
  },
];

const PREVIEW_IMG_WIDTH = 96; // 缩略图显示宽度，高度按目标比例自适应

interface Props {
  labelId: string;
  currentAlgorithm?: DitherAlgorithm;
  onApplied: () => void;
}

export default function DitherSelectorGrid({ labelId, currentAlgorithm, onApplied }: Props) {
  const queryClient = useQueryClient();
  const current = currentAlgorithm ?? 'threshold';

  // 批量获取各 dither 算法的实时缩略预览
  const previewQuery = useQuery({
    queryKey: ['dither-preview', labelId],
    queryFn: () => labelsApi.previewDitherBatch(labelId),
    staleTime: 60_000,
    retry: false,
  });

  // 将预览列表转成 algorithm -> base64 的映射，方便按算法名快速查找
  const previewMap = useMemo(() => {
    if (!previewQuery.data?.success) return null;
    const map: Record<string, string> = {};
    previewQuery.data.previews.forEach((p) => {
      map[p.algorithm] = p.pngBase64;
    });
    return map;
  }, [previewQuery.data]);

  // 仅当批量预览接口成功返回数据后才启用预览网格；
  // 加载失败（如非 image 标签返回 400）则优雅退回原纯按钮模式，不弹报错。
  const enablePreviews = previewQuery.isSuccess && previewMap !== null;

  const applyMutation = useMutation({
    mutationFn: (algorithm: DitherAlgorithm) => labelsApi.redither(labelId, algorithm),
    onSuccess: (data) => {
      toast.success(`已应用 ${ALGO_LABELS[data.ditherAlgorithm as DitherAlgorithm] ?? data.ditherAlgorithm}`);
      queryClient.invalidateQueries({ queryKey: ['label', labelId] });
      onApplied();
    },
    onError: () => toast.error('应用 dither 算法失败'),
  });

  return (
    <div className="w-full space-y-2">
      <span className="text-xs font-medium text-muted-foreground">
        Dither 算法（点击即应用到上方预览）
      </span>
      {GROUPS.map((group) => (
        <div key={group.title} className="space-y-1">
          <span className="text-[11px] text-muted-foreground/70">{group.title}</span>
          <div className="flex flex-wrap gap-2">
            {group.algos.map((algo) => {
              const selected = current === algo;
              const pending = applyMutation.isPending && applyMutation.variables === algo;
              const previewSrc = enablePreviews && previewMap?.[algo]
                ? `data:image/png;base64,${previewMap[algo]}`
                : null;

              return (
                <div
                  key={algo}
                  className="flex flex-col items-center gap-1"
                >
                  {previewQuery.isLoading && (
                    <Skeleton className="rounded-md bg-muted" style={{ width: PREVIEW_IMG_WIDTH, aspectRatio: '2/1' }} />
                  )}
                  {enablePreviews && previewSrc && (
                    <img
                      src={previewSrc}
                      alt={`${ALGO_LABELS[algo]} 预览`}
                      className="rounded-md border border-border object-contain bg-background"
                      style={{ width: PREVIEW_IMG_WIDTH }}
                    />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    disabled={applyMutation.isPending}
                    onClick={() => applyMutation.mutate(algo)}
                    className="h-7 px-2 text-xs"
                  >
                    {pending ? '应用中…' : ALGO_LABELS[algo]}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
