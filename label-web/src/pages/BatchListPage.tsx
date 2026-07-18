import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Layers, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { batchesApi } from '@/api/batches';
import { componentBatchesApi } from '@/api/component-batches';

// 统一列表项：图片批次(label-batches)和元件标签批次(component-label-batches)
// 是两套完全独立的后端(component-labels 刻意跟 LLM job 队列解耦)，这里只在
// 前端展示层合并，不合并数据模型。
interface UnifiedBatchCard {
  id: string;
  kind: 'image' | 'component';
  name: string;
  status: string;
  done: number;
  total: number;
  subtitle: string;
  createdAt: string;
}

export default function BatchListPage() {
  const navigate = useNavigate();

  const { data: imageBatches, isLoading: loadingImage } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(),
  });

  const { data: componentBatches, isLoading: loadingComponent } = useQuery({
    queryKey: ['component-batches'],
    queryFn: () => componentBatchesApi.list(),
  });

  const isLoading = loadingImage || loadingComponent;

  const cards: UnifiedBatchCard[] = [
    ...(imageBatches ?? []).map((b): UnifiedBatchCard => ({
      id: b.id,
      kind: 'image',
      name: b.name,
      status: b.status,
      done: b.counts.done,
      total: b.counts.total,
      subtitle: b.model ?? '',
      createdAt: b.createdAt,
    })),
    ...(componentBatches ?? []).map((b): UnifiedBatchCard => ({
      id: b.id,
      kind: 'component',
      name: b.name,
      status: b.status,
      done: b.counts.printed,
      total: b.counts.total,
      subtitle: `已渲染 ${b.counts.rendered}/${b.counts.total}`,
      createdAt: b.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Layers className="h-5 w-5" />
          批量标签
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/batches/component/new')}>
            <Tag className="h-4 w-4 mr-2" />
            新建元件标签批次
          </Button>
          <Button onClick={() => navigate('/batches/new')}>
            <Plus className="h-4 w-4 mr-2" />
            新建图片批次
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        </div>
      ) : cards.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((b) => {
            const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
            return (
              <Card
                key={`${b.kind}-${b.id}`}
                className="p-4 cursor-pointer hover:shadow-md transition-all-smooth"
                onClick={() => navigate(b.kind === 'component' ? `/batches/component/${b.id}` : `/batches/${b.id}`)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-foreground truncate flex items-center gap-1.5">
                    {b.kind === 'component' && <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    {b.name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{b.status}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {b.done}/{b.total} 完成
                  </span>
                  <span>{b.subtitle}</span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex justify-center py-16 text-sm text-muted-foreground">
          暂无批次，点上方按钮开始
        </div>
      )}
    </div>
  );
}
