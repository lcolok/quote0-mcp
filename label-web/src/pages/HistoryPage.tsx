import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { labelsApi } from '@/api/labels';
import LabelCard from '@/components/LabelCard';

const statusOptions = [
  { value: '', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'approved', label: '已批准' },
  { value: 'printed', label: '已打印' },
  { value: 'archived', label: '已归档' },
];

export default function HistoryPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const { data: labels, isLoading } = useQuery({
    queryKey: ['labels', statusFilter, tagFilter],
    queryFn: () => labelsApi.list({ status: statusFilter || undefined, tag: tagFilter || undefined }),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          设计
        </Button>
        <h1 className="text-xl font-semibold text-foreground">历史标签</h1>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">状态:</span>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="输入标签筛选..."
              className="pl-8"
            />
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        </div>
      ) : labels && labels.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {labels.map((label) => (
            <LabelCard key={label.id} label={label} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          暂无标签记录
        </div>
      )}
    </div>
  );
}
