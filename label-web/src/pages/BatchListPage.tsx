import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { batchesApi } from '@/api/batches';

export default function BatchListPage() {
  const navigate = useNavigate();
  const { data: batches, isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Layers className="h-5 w-5" />
          批量标签
        </h1>
        <Button onClick={() => navigate('/batches/new')}>
          <Plus className="h-4 w-4 mr-2" />
          新建批次
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        </div>
      ) : batches && batches.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {batches.map((b) => {
            const pct = b.counts.total ? Math.round((b.counts.done / b.counts.total) * 100) : 0;
            return (
              <Card
                key={b.id}
                className="p-4 cursor-pointer hover:shadow-md transition-all-smooth"
                onClick={() => navigate(`/batches/${b.id}`)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-foreground truncate">{b.name}</span>
                  <span className="text-xs text-muted-foreground">{b.status}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {b.counts.done}/{b.counts.total} 完成
                  </span>
                  <span>{b.model ?? ''}</span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex justify-center py-16 text-sm text-muted-foreground">
          暂无批次，点「新建批次」开始
        </div>
      )}
    </div>
  );
}
