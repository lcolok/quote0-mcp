import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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

interface Props {
  labelId: string;
  currentAlgorithm?: DitherAlgorithm;
  onApplied: () => void;
}

export default function DitherSelectorGrid({ labelId, currentAlgorithm, onApplied }: Props) {
  const queryClient = useQueryClient();
  const current = currentAlgorithm ?? 'threshold';

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
          <div className="flex flex-wrap gap-1.5">
            {group.algos.map((algo) => {
              const selected = current === algo;
              const pending = applyMutation.isPending && applyMutation.variables === algo;
              return (
                <Button
                  key={algo}
                  type="button"
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  disabled={applyMutation.isPending}
                  onClick={() => applyMutation.mutate(algo)}
                  className="h-7 px-2 text-xs"
                >
                  {pending ? '应用中…' : ALGO_LABELS[algo]}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
