import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { memosApi } from '@/api/memos';
import MemoCard from '@/components/MemoCard';
import MemoDialog from '@/components/MemoDialog';
import type { Memo } from '@/types/memo';

export default function MemoPage() {
  const navigate = useNavigate();
  const [dialogMemo, setDialogMemo] = useState<Memo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: memos, isLoading } = useQuery({
    queryKey: ['memos'],
    queryFn: () => memosApi.list(),
  });

  const openCreate = () => {
    setDialogMemo(null);
    setDialogOpen(true);
  };

  const openEdit = (memo: Memo) => {
    setDialogMemo(memo);
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            设计
          </Button>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <StickyNote className="h-5 w-5" />
            备忘 Memo
          </h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          新建备忘
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        </div>
      ) : memos && memos.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {memos.map((memo) => (
            <MemoCard key={memo.id} memo={memo} onClick={() => openEdit(memo)} />
          ))}
        </div>
      ) : (
        <Card className="p-12 flex flex-col items-center justify-center text-center gap-4">
          <StickyNote className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">暂无备忘</p>
            <p className="text-xs text-muted-foreground mt-1">
              点击右上角「新建备忘」创建第一条墨水屏备忘。
            </p>
          </div>
          <Button variant="outline" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            新建备忘
          </Button>
        </Card>
      )}

      <MemoDialog
        memo={dialogMemo}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
