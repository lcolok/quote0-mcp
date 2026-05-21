import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Label } from '@/components/ui/label';
import { memosApi } from '@/api/memos';
import MemoTargetSelector from './MemoTargetSelector';
import type { Memo, MemoTargetRenderer } from '@/types/memo';

interface Props {
  memo: Memo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MemoDialog({ memo, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const isCreate = !memo;

  const [text, setText] = useState('');
  const [targetRenderer, setTargetRenderer] = useState<MemoTargetRenderer>('both');
  const [enabled, setEnabled] = useState(true);
  const [sortOrder, setSortOrder] = useState<number | ''>(0);

  useEffect(() => {
    if (open) {
      if (memo) {
        setText(memo.text);
        setTargetRenderer(memo.targetRenderer);
        setEnabled(memo.enabled);
        setSortOrder(memo.sortOrder);
      } else {
        setText('');
        setTargetRenderer('both');
        setEnabled(true);
        setSortOrder(0);
      }
    }
  }, [memo, open]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['memos'] });

  const createMut = useMutation({
    mutationFn: () =>
      memosApi.create({
        text: text.trim(),
        enabled,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        targetRenderer,
      }),
    onSuccess: (data) => {
      toast.success(data.renderOk ? '备忘已创建并渲染' : '备忘已创建，渲染失败');
      if (!data.renderOk && data.renderError) {
        toast.error(`渲染错误：${data.renderError}`);
      }
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast.error(`创建失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      memosApi.update(memo!.id, {
        text: text.trim(),
        enabled,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        targetRenderer,
      }),
    onSuccess: (data) => {
      toast.success('备忘已更新');
      if (data.renderError) {
        toast.error(`渲染错误：${data.renderError}`);
      }
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast.error(`更新失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const renderMut = useMutation({
    mutationFn: () => memosApi.render(memo!.id),
    onSuccess: (data) => {
      toast.success(data.renderOk ? '已重新渲染' : '重新渲染失败');
      if (!data.renderOk && data.renderError) {
        toast.error(`渲染错误：${data.renderError}`);
      }
      invalidate();
    },
    onError: (e: any) =>
      toast.error(`渲染失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const deleteMut = useMutation({
    mutationFn: () => memosApi.delete(memo!.id),
    onSuccess: () => {
      toast.success('备忘已删除');
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast.error(`删除失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const isPending = createMut.isPending || updateMut.isPending || deleteMut.isPending || renderMut.isPending;
  const canSubmit = text.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreate ? '新建备忘' : '编辑备忘'}</DialogTitle>
          <DialogDescription>
            {isCreate ? '创建一条新的墨水屏备忘。' : '修改备忘内容、推送目标或启用状态。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">内容</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="输入备忘内容…"
            />
          </div>

          <MemoTargetSelector
            value={targetRenderer}
            onChange={setTargetRenderer}
            disabled={isPending}
          />

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm">启用</Label>
              <p className="text-xs text-muted-foreground">停用后不会推送到墨水屏</p>
            </div>
            <Toggle
              pressed={enabled}
              onPressedChange={setEnabled}
              disabled={isPending}
              variant="outline"
              size="sm"
              className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {enabled ? '已启用' : '已停用'}
            </Toggle>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">排序权重</Label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => {
                const v = e.target.value;
                setSortOrder(v === '' ? '' : Number(v));
              }}
              min={0}
              step={1}
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {!isCreate && (
            <Button
              variant="outline"
              onClick={() => renderMut.mutate()}
              disabled={renderMut.isPending}
            >
              {renderMut.isPending ? '渲染中…' : '重新渲染'}
            </Button>
          )}
          {!isCreate && (
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => {
                if (confirm(`确认删除备忘「${memo.text.slice(0, 20)}」？`)) {
                  deleteMut.mutate();
                }
              }}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? '删除中…' : '删除'}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={() => (isCreate ? createMut.mutate() : updateMut.mutate())}
            disabled={isPending || !canSubmit}
          >
            {isPending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
