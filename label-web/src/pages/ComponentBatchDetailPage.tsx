import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, RefreshCw, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import PrintDeviceDialog from '@/components/PrintDeviceDialog';
import { componentBatchesApi } from '@/api/component-batches';

export default function ComponentBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [printOpen, setPrintOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['component-batch', id],
    queryFn: () => componentBatchesApi.get(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const allRendered = items.length > 0 && items.every((it) => !!it.labelId);
      return allRendered ? false : 2000;
    },
  });

  const renderMut = useMutation({
    mutationFn: () => componentBatchesApi.render(id!),
    onSuccess: (res) => {
      toast.success(`渲染完成：${res.rendered} 个`);
      queryClient.invalidateQueries({ queryKey: ['component-batch', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '渲染失败'),
  });

  const printMut = useMutation({
    mutationFn: (deviceId: string) => componentBatchesApi.print(id!, { deviceId }),
    onSuccess: (res) => {
      toast.success(`打印完成：${res.printed} 个`);
      setPrintOpen(false);
      queryClient.invalidateQueries({ queryKey: ['component-batch', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '打印失败'),
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
      </div>
    );
  }

  const { batch, items } = data;
  const renderedCount = items.filter((it) => !!it.labelId).length;
  const printedCount = items.filter((it) => it.printCount > 0).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate('/batches')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <h1 className="text-xl font-semibold text-foreground flex-1 truncate">{batch.name}</h1>
        <span className="text-xs text-muted-foreground">{batch.status}</span>
      </div>

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{items.length} 个编号</span>
        <span>·</span>
        <span>已渲染 {renderedCount}/{items.length}</span>
        <span>·</span>
        <span>已打印 {printedCount}/{items.length}</span>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => renderMut.mutate()} disabled={renderMut.isPending}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {renderMut.isPending ? '渲染中…' : '渲染全部'}
        </Button>
        <Button onClick={() => setPrintOpen(true)} disabled={renderedCount === 0}>
          <Printer className="h-4 w-4 mr-2" />
          批量打印
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {items.map((it) => (
          <Card key={it.id} className="p-3 space-y-2">
            <div className="aspect-[5/2] rounded bg-muted flex items-center justify-center overflow-hidden">
              {it.pngUrl ? (
                <img src={it.pngUrl} alt={it.code} className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">未渲染</span>
              )}
            </div>
            <div className="text-xs font-medium text-foreground truncate" title={it.code}>
              {it.code}
            </div>
            {it.printCount > 0 && (
              <div className="text-xs text-muted-foreground">已打印 {it.printCount} 次</div>
            )}
          </Card>
        ))}
      </div>

      <PrintDeviceDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        targetId={batch.targetId}
        pending={printMut.isPending}
        onConfirm={(deviceId) => printMut.mutate(deviceId)}
        title="批量打印元件标签"
        description={`把 ${renderedCount} 个已渲染的编号发送到设备打印。`}
      />
    </div>
  );
}
