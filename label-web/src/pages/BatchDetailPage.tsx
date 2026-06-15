import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, AlertCircle, Check, RefreshCw, Printer, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { batchesApi } from '@/api/batches';

import SessionEditorDialog from '@/components/SessionEditorDialog';
import PrintDeviceDialog from '@/components/PrintDeviceDialog';

export default function BatchDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [template, setTemplate] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  // 预览编辑器:?item=<itemId> 打开(可刷新/分享)
  const [searchParams, setSearchParams] = useSearchParams();
  const editorItemId = searchParams.get('item');
  const setEditorItem = (itemId: string | null) => {
    const sp = new URLSearchParams(searchParams);
    if (itemId) sp.set('item', itemId);
    else sp.delete('item');
    setSearchParams(sp, { replace: true });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['batch', id],
    queryFn: () => batchesApi.get(id),
    refetchInterval: (query) => {
      const items = query.state.data?.items;
      const inFlight = items?.some((it) => it.state === 'pending' || it.state === 'running');
      return inFlight ? 2000 : false;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['batch', id] });

  const saveTpl = useMutation({
    mutationFn: () => batchesApi.patch(id, { promptTemplate: template ?? '' }),
    onSuccess: () => {
      toast.success('模板已保存（template_rev+1）');
      setTemplate(null);
      invalidate();
    },
  });
  const runMut = useMutation({
    mutationFn: (scope: any) => batchesApi.run(id, { scope, sampleSize: 3 }),
    onSuccess: (r) => {
      toast.success(`已入队 ${r.enqueued} 个`);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '操作失败'),
  });
  const retryMut = useMutation({
    mutationFn: () => batchesApi.retry(id, { scope: 'failed' }),
    onSuccess: (r) => {
      toast.success(`重试入队 ${r.enqueued} 个`);
      invalidate();
    },
  });

  const printMut = useMutation({
    mutationFn: (deviceId: string) =>
      batchesApi.print(id, { scope: { itemIds: [...selected] }, deviceId }),
    onSuccess: (r) => {
      const failed = (r.results ?? []).filter((x) => !x.ok);
      if (failed.length) {
        toast.warning(`已打印 ${r.printed} 个，${failed.length} 个失败(可重新打印)`, {
          description: failed
            .slice(0, 4)
            .map((x) => x.error || '推送失败')
            .join('；'),
        });
      } else {
        toast.success(`已打印 ${r.printed} 个`);
      }
      invalidate();
      setPrintOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '打印失败'),
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const { batch, items } = data;
  const tpl = template ?? batch.promptTemplate;
  const counts = {
    total: items.length,
    done: items.filter((i) => i.state === 'succeeded').length,
    failed: items.filter((i) => i.state === 'failed').length,
    running: items.filter((i) => i.state === 'running' || i.state === 'pending').length,
  };

  const toggle = (itemId: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(itemId)) n.delete(itemId);
      else n.add(itemId);
      return n;
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate('/batches')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <h1 className="text-xl font-semibold truncate">{batch.name}</h1>
        <span className="text-xs text-muted-foreground">
          rev {batch.templateRev} · {batch.status}
        </span>
      </div>

      <Card className="p-4 space-y-3">
        <label className="text-sm text-muted-foreground">{'提示词模板（用 {{name}} 引用系列名）'}</label>
        <Textarea value={tpl} onChange={(e) => setTemplate(e.target.value)} rows={2} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={tpl === batch.promptTemplate || saveTpl.isPending}
            onClick={() => saveTpl.mutate()}
          >
            保存模板
          </Button>
          <Button size="sm" onClick={() => runMut.mutate('sample')} disabled={runMut.isPending}>
            <Play className="h-4 w-4 mr-1" />
            试运行前3
          </Button>
          <Button size="sm" onClick={() => runMut.mutate('all')} disabled={runMut.isPending}>
            放量运行
          </Button>
          <Button size="sm" variant="outline" onClick={() => retryMut.mutate()} disabled={retryMut.isPending}>
            <RefreshCw className="h-4 w-4 mr-1" />
            重试失败
          </Button>
          <div className="ml-auto text-xs text-muted-foreground flex items-center gap-3">
            <span>完成 {counts.done}</span>
            <span>失败 {counts.failed}</span>
            <span>进行中 {counts.running}</span>
            <span>共 {counts.total}</span>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">标签 {counts.total}</h2>
        {selectMode ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set(items.filter((i) => i.label).map((i) => i.id)))}
            >
              全选
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectMode(false);
                setSelected(new Set());
              }}
            >
              取消
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}>
            选择
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {items.map((it) => (
          <Card
            key={it.id}
            title={selectMode ? '点击选择 / 取消选择' : '点击进入预览编辑器(多轮微调/版本溯源)'}
            onClick={() => (selectMode ? it.label && toggle(it.id) : setEditorItem(it.id))}
            className={`p-3 transition cursor-pointer select-none ${selectMode && selected.has(it.id) ? 'ring-2 ring-primary' : ''}`}
          >
            <div className="relative aspect-[2/1] overflow-hidden rounded-md bg-muted mb-2 flex items-center justify-center transition hover:ring-2 hover:ring-primary/60">
              {selectMode && it.label && (
                <span className="absolute left-1 top-1 z-10">
                  {selected.has(it.id) ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="block h-5 w-5 rounded-full border-2 border-white/90 bg-black/25 shadow" />
                  )}
                </span>
              )}
              <div className="absolute right-1 top-1 z-10 flex items-center gap-1">
                {(it.label?.status === 'printed' || (it.label?.printCount ?? 0) > 0) && (
                  <span
                    className="flex items-center gap-0.5 rounded bg-green-600/85 px-1 py-0.5 text-[10px] font-medium leading-none text-white"
                    title={`已打印${it.label?.printCount ? ` ${it.label.printCount} 次` : ''}`}
                  >
                    <Printer className="h-2.5 w-2.5" />
                    {it.label?.printCount ? it.label.printCount : ''}
                  </span>
                )}
                {it.versionCount > 1 && it.versionNo != null && (
                  <span className="rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium leading-none text-white">
                    v{it.versionNo}/{it.versionCount}
                  </span>
                )}
              </div>
              {it.state === 'pending' || it.state === 'running' ? (
                <div className="flex flex-col items-center gap-1 text-purple-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-xs">{it.state === 'pending' ? '排队' : '生成中'}</span>
                </div>
              ) : it.state === 'failed' ? (
                <div className="flex flex-col items-center gap-1 text-destructive px-1 text-center">
                  <AlertCircle className="h-5 w-5" />
                  <span className="text-[10px] truncate max-w-full" title={it.lastError ?? ''}>
                    {it.lastError ? it.lastError.slice(0, 24) : '失败'}
                  </span>
                </div>
              ) : it.label?.pngUrl ? (
                <img
                  src={it.label.pngUrl}
                  alt={it.name}
                  draggable={false}
                  className="h-full w-full object-contain pointer-events-none select-none"
                />
              ) : (
                <div className="text-xs text-muted-foreground">无预览</div>
              )}
            </div>
            <p className="text-xs font-medium truncate" title={it.name}>
              {it.name}
            </p>
          </Card>
        ))}
      </div>

      {selectMode && (
        <div className="sticky bottom-4 flex items-center gap-3 rounded-lg border border-border bg-background/95 backdrop-blur px-4 py-3 shadow-md">
          <span className="text-sm text-muted-foreground">已选 {selected.size}</span>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            清空
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setPrintOpen(true)}
            disabled={!selected.size || printMut.isPending}
          >
            <Printer className="h-4 w-4 mr-1" />
            打印选中({selected.size})
          </Button>
        </div>
      )}

      <SessionEditorDialog
        items={items}
        itemId={editorItemId}
        targetId={data.batch.targetId}
        onClose={() => setEditorItem(null)}
        onNavigate={(itemId) => setEditorItem(itemId)}
      />

      <PrintDeviceDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        targetId={data.batch.targetId}
        pending={printMut.isPending}
        onConfirm={(deviceId) => printMut.mutate(deviceId)}
        title="打印标签"
        description="选择一台热敏打印机打印选中的标签。"
      />
    </div>
  );
}
