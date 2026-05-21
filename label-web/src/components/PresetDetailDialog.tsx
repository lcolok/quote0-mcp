import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { labelsApi } from '@/api/labels';
import type { ImagePreset } from '@/types/label';

interface Props {
  preset: ImagePreset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STYLE_MODE_DESC: Record<string, string> = {
  oneshot: 'oneshot · 多模态 LLM 看参考图+原 prompt 重写新提示词（风格学习）',
  static_suffix: 'static_suffix · 拼接固定英文约束，不走 LLM',
};

export default function PresetDetailDialog({ preset, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [suffix, setSuffix] = useState('');

  // 每次切换 preset / 打开，重置本地编辑态
  useEffect(() => {
    if (preset) {
      setName(preset.name);
      setPrompt(preset.prompt);
      setSuffix(preset.staticSuffixText ?? '');
      setEditing(false);
    }
  }, [preset, open]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['image-presets'] });

  const saveMut = useMutation({
    mutationFn: () =>
      labelsApi.updatePreset(preset!.id, {
        name: name.trim(),
        prompt: prompt.trim(),
        ...(preset!.styleMode === 'static_suffix' ? { staticSuffixText: suffix } : {}),
      }),
    onSuccess: () => { toast.success('已保存修改'); invalidate(); setEditing(false); },
    onError: (e: any) => toast.error(`保存失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const dupMut = useMutation({
    mutationFn: () => labelsApi.duplicatePreset(preset!.id),
    onSuccess: () => { toast.success('已复制为副本'); invalidate(); onOpenChange(false); },
    onError: (e: any) => toast.error(`复制失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  const delMut = useMutation({
    mutationFn: () => labelsApi.deletePreset(preset!.id),
    onSuccess: () => { toast.success('已删除预设'); invalidate(); onOpenChange(false); },
    onError: (e: any) => toast.error(`删除失败：${e?.response?.data?.error ?? e?.message ?? '未知'}`),
  });

  if (!preset) return null;
  const refImage = preset.sourceImageUrl || preset.thumbnailUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            预设详情 · {preset.name}
            {preset.isSystem && (
              <span className="bg-primary/90 text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded">内置</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {preset.isSystem ? '系统内置预设，只读；可复制为副本后自由编辑。' : '可编辑名称 / 提示词，或复制为副本。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {refImage && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">{preset.sourceImageUrl ? '参考图（AI 源图）' : '缩略图'}</div>
              <img src={refImage} alt={preset.name} className="max-h-40 rounded-lg border border-border object-contain bg-muted" />
            </div>
          )}

          <div>
            <div className="text-xs text-muted-foreground mb-1">风格模式</div>
            <div className="text-foreground">{STYLE_MODE_DESC[preset.styleMode] ?? preset.styleMode}</div>
          </div>

          {preset.model && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">默认模型</div>
              <div className="text-foreground font-mono text-xs">{preset.model}</div>
            </div>
          )}

          {!editing ? (
            <>
              <div>
                <div className="text-xs text-muted-foreground mb-1">提示词（prompt）</div>
                <div className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">{preset.prompt}</div>
              </div>
              {preset.styleMode === 'static_suffix' && preset.staticSuffixText && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">英文约束（拼接到 prompt 后）</div>
                  <div className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">{preset.staticSuffixText}</div>
                </div>
              )}
              <div className="text-xs text-muted-foreground">使用次数：{preset.useCount}</div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">名称</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">提示词</label>
                <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={4000} />
              </div>
              {preset.styleMode === 'static_suffix' && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">英文约束</label>
                  <Textarea value={suffix} onChange={(e) => setSuffix(e.target.value)} rows={4} maxLength={4000} />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {!editing ? (
            <>
              <Button variant="outline" onClick={() => dupMut.mutate()} disabled={dupMut.isPending}>
                {dupMut.isPending ? '复制中…' : '复制为副本'}
              </Button>
              {!preset.isSystem && (
                <Button variant="outline" onClick={() => setEditing(true)}>编辑</Button>
              )}
              {!preset.isSystem && (
                <Button
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => { if (confirm(`确认删除预设「${preset.name}」？`)) delMut.mutate(); }}
                  disabled={delMut.isPending}
                >
                  删除
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>取消</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name.trim() || !prompt.trim()}>
                {saveMut.isPending ? '保存中…' : '保存'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
