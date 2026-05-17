import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
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
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all-smooth"
        >
          <ArrowLeft className="h-4 w-4" />
          设计
        </button>
        <h1 className="text-xl font-semibold text-gray-900">历史标签</h1>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">状态:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="输入标签筛选..."
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      ) : labels && labels.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {labels.map((label) => (
            <LabelCard key={label.id} label={label} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-16 text-sm text-gray-400">
          暂无标签记录
        </div>
      )}
    </div>
  );
}
