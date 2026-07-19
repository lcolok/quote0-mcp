import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, RefreshCw, Printer, Link2, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import PrintDeviceDialog from '@/components/PrintDeviceDialog';
import { componentBatchesApi } from '@/api/component-batches';
import type { ComponentBatchItem } from '@/types/component-batch';

export default function ComponentBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [printOpen, setPrintOpen] = useState(false);
  const [bindingItem, setBindingItem] = useState<ComponentBatchItem | null>(null);
  const [bindValue, setBindValue] = useState('');
  const [bindPackage, setBindPackage] = useState('');

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
      toast.success(`打印完成：${res.printed} 张`);
      setPrintOpen(false);
      queryClient.invalidateQueries({ queryKey: ['component-batch', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '打印失败'),
  });

  const bindMut = useMutation({
    mutationFn: () =>
      componentBatchesApi.pair(id!, bindingItem!.id, { value: bindValue.trim(), package: bindPackage.trim() }),
    onSuccess: () => {
      toast.success('已绑定，下次打印会连数值封装标签一起打印');
      setBindingItem(null);
      queryClient.invalidateQueries({ queryKey: ['component-batch', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '绑定失败'),
  });

  const archiveMut = useMutation({
    mutationFn: () => componentBatchesApi.archive(id!),
    onSuccess: () => {
      toast.success('批次已归档');
      queryClient.invalidateQueries({ queryKey: ['component-batch', id] });
      queryClient.invalidateQueries({ queryKey: ['component-batches'] });
      navigate('/batches');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '归档失败'),
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
  const boundCount = items.filter((it) => !!it.binding).length;

  function openBindingDialog(item: ComponentBatchItem) {
    setBindingItem(item);
    setBindValue(item.binding?.value ?? '');
    setBindPackage(item.binding?.package ?? '');
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate('/batches')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <h1 className="text-xl font-semibold text-foreground flex-1 truncate">{batch.name}</h1>
        <span className="text-xs text-muted-foreground">{batch.status}</span>
        {batch.status !== 'archived' && (
          <Button variant="outline" onClick={() => archiveMut.mutate()} disabled={archiveMut.isPending}>
            <Archive className="h-4 w-4 mr-2" />
            {archiveMut.isPending ? '归档中…' : '归档'}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
        <span>{items.length} 个编号</span>
        <span>·</span>
        <span>已渲染 {renderedCount}/{items.length}</span>
        <span>·</span>
        <span>已打印 {printedCount}/{items.length}</span>
        <span>·</span>
        <span>已绑定数值封装 {boundCount}/{items.length}</span>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => renderMut.mutate()} disabled={renderMut.isPending}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {renderMut.isPending ? '渲染中…' : '渲染全部'}
        </Button>
        <Button onClick={() => setPrintOpen(true)} disabled={renderedCount === 0}>
          <Printer className="h-4 w-4 mr-2" />
          批量打印{boundCount > 0 ? `（含 ${boundCount} 个数值封装配对）` : ''}
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

            {it.binding ? (
              <div className="pt-2 border-t space-y-1.5">
                <div className="aspect-[5/2] rounded bg-muted flex items-center justify-center overflow-hidden">
                  {it.binding.pngUrl ? (
                    <img src={it.binding.pngUrl} alt={`${it.binding.value}[${it.binding.package}]`} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <span className="text-xs text-muted-foreground">配对未渲染</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openBindingDialog(it)}
                  className="flex items-center gap-1 text-xs w-full text-left"
                >
                  <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="text-foreground truncate">{it.binding.value}[{it.binding.package}]</span>
                </button>
                {it.binding.printCount > 0 && (
                  <div className="text-xs text-muted-foreground">配对已打印 {it.binding.printCount} 次</div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => openBindingDialog(it)}
                className="flex items-center gap-1 text-xs w-full text-left pt-2 border-t"
              >
                <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground underline">绑定数值/封装</span>
              </button>
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
        description={`把 ${renderedCount} 个已渲染的编号发送到设备打印${boundCount > 0 ? `，其中 ${boundCount} 个已绑定的会连数值封装标签一起打印` : ''}。`}
      />

      <Dialog open={!!bindingItem} onOpenChange={(v) => !v && setBindingItem(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>绑定数值/封装</DialogTitle>
            <DialogDescription>
              给料号 <span className="font-mono">{bindingItem?.code}</span> 关联主参数+封装，之后批量打印会连数值封装标签一起打印。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">主参数</label>
              <Input value={bindValue} onChange={(e) => setBindValue(e.target.value)} placeholder="如 10kΩ / 100nF / 220µH" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">封装</label>
              <Input value={bindPackage} onChange={(e) => setBindPackage(e.target.value)} placeholder="如 0603" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindingItem(null)} disabled={bindMut.isPending}>
              取消
            </Button>
            <Button
              onClick={() => bindMut.mutate()}
              disabled={bindMut.isPending || !bindValue.trim() || !bindPackage.trim()}
            >
              {bindMut.isPending ? '保存中…' : '保存绑定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
