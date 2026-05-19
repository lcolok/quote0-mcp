import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookmarkPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { labelsApi } from '@/api/labels';

interface Props {
  labelId: string;
  defaultPrompt: string;
  defaultModel?: string | null;
}

export default function SavePresetDialog({ labelId, defaultPrompt, defaultModel }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultPrompt.slice(0, 20));  // 默认从 prompt 取前 20 字
  const queryClient = useQueryClient();

  const createMut = useMutation({
    mutationFn: () =>
      labelsApi.createPreset({
        name: name.trim(),
        prompt: defaultPrompt,
        model: defaultModel ?? null,
        sourceLabelId: labelId,
      }),
    onSuccess: () => {
      toast.success('已存为预设');
      queryClient.invalidateQueries({ queryKey: ['image-presets'] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(`保存失败：${e?.message ?? '未知'}`),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setName(defaultPrompt.slice(0, 20));  // 每次打开重置
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <BookmarkPlus className="h-4 w-4 mr-2" />
          存为预设
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>存为预设</DialogTitle>
          <DialogDescription>
            该标签的 prompt、模型、缩略图将作为预设保存，下次可一键复用。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1.5">预设名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：可爱猫咪图标"
              maxLength={100}
            />
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>prompt：<span className="line-clamp-2">{defaultPrompt}</span></div>
            {defaultModel && <div>默认模型：{defaultModel}</div>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !name.trim()}
          >
            {createMut.isPending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
