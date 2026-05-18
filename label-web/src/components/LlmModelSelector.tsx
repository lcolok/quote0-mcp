import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cpu } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { labelsApi } from '@/api/labels';

export default function LlmModelSelector() {
  const queryClient = useQueryClient();
  const { data: models = [] } = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => labelsApi.fetchLlmModels(),
    staleTime: 5 * 60 * 1000,  // 5min cache
  });
  const { data: active } = useQuery({
    queryKey: ['llm-active'],
    queryFn: () => labelsApi.fetchActiveLlm(),
    staleTime: 0,
  });

  const setActiveMut = useMutation({
    mutationFn: ({ providerId, modelDbId }: { providerId: number; modelDbId: number }) =>
      labelsApi.setActiveLlm(providerId, modelDbId),
    onSuccess: (_, vars) => {
      const m = models.find((x) => x.modelDbId === vars.modelDbId);
      toast.success(`已切换到 ${m?.modelDisplayName ?? 'model'}`);
      queryClient.invalidateQueries({ queryKey: ['llm-active'] });
    },
    onError: (e: any) => {
      toast.error(`切换失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`);
    },
  });

  const onValueChange = (value: string) => {
    // value 是 "providerId:modelDbId" 字符串
    const [providerId, modelDbId] = value.split(':').map(Number);
    if (Number.isNaN(providerId) || Number.isNaN(modelDbId)) return;
    setActiveMut.mutate({ providerId, modelDbId });
  };

  const currentValue = active
    ? `${active.activeProviderId}:${active.activeModelDbId}`
    : '';

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        <Cpu className="h-3.5 w-3.5" />
        LLM 模型（生成时与切换后伴随任务记录）
      </Label>
      <Select value={currentValue} onValueChange={onValueChange} disabled={setActiveMut.isPending}>
        <SelectTrigger>
          <SelectValue placeholder="选择 LLM model" />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.modelDbId} value={`${m.providerId}:${m.modelDbId}`}>
              <span className="font-medium">{m.modelDisplayName}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {m.providerDisplayName} · {(m.contextWindow / 1000).toFixed(0)}K ctx
                {m.reasoning ? ' · reasoning' : ''}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active && (
        <p className="text-xs text-muted-foreground">
          当前生效：{active.modelDisplayName} ({active.providerSlug})
        </p>
      )}
    </div>
  );
}
