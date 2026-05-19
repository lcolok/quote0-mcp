import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookMarked, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { labelsApi } from '@/api/labels';
import type { ImagePreset } from '@/types/label';

interface Props {
  onSelect: (preset: ImagePreset) => void;
  disabled?: boolean;
}

export default function PresetSelector({ onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: presets = [], isLoading } = useQuery({
    queryKey: ['image-presets'],
    queryFn: () => labelsApi.listPresets(),
    enabled: open,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => labelsApi.deletePreset(id),
    onSuccess: () => {
      toast.success('已删除预设');
      queryClient.invalidateQueries({ queryKey: ['image-presets'] });
      setConfirmDeleteId(null);
    },
    onError: (e: any) => toast.error(`删除失败：${e?.message ?? '未知'}`),
  });

  const handleSelect = async (p: ImagePreset) => {
    onSelect(p);
    setOpen(false);
    // 后台记录使用（不阻塞）
    labelsApi.recordUsePreset(p.id).catch(() => {});
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost" disabled={disabled}>
            <BookMarked className="h-4 w-4 mr-1" />
            从预设选择
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>选择图像预设</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[480px] pr-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                加载中…
              </div>
            ) : presets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
                <BookMarked className="h-8 w-8 opacity-30" />
                <div>暂无预设</div>
                <div className="text-xs">在标签详情页点击「📚 存为预设」来创建</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {presets.map((p) => (
                  <Card
                    key={p.id}
                    className="overflow-hidden cursor-pointer hover:border-primary hover:shadow-md transition relative group"
                    onClick={() => handleSelect(p)}
                  >
                    {/* 缩略图（2:1 纵横比对应 label 320x160） */}
                    <div className="bg-muted aspect-[2/1] flex items-center justify-center">
                      {p.thumbnailUrl ? (
                        <img src={p.thumbnailUrl} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <BookMarked className="h-8 w-8 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="p-2 space-y-1">
                      <div className="text-sm font-medium truncate" title={p.name}>{p.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2" title={p.prompt}>{p.prompt}</div>
                      {p.model && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">{p.model}</Badge>
                      )}
                    </div>
                    {/* 删除按钮（hover 显示） */}
                    <button
                      type="button"
                      className="absolute top-1 right-1 p-1 rounded bg-background/80 opacity-0 group-hover:opacity-100 transition hover:bg-destructive hover:text-destructive-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(p.id);
                      }}
                      title="删除预设"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除预设？</AlertDialogTitle>
            <AlertDialogDescription>
              该预设将被永久删除，已生成的标签不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteId && deleteMut.mutate(confirmDeleteId)}
              disabled={deleteMut.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
