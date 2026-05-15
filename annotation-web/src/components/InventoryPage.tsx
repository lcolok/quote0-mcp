import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, type InventoryItem } from '../api/inventory';
import {
  Search,
  Package,
  Trash2,
  Clock,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';

function InventoryPage() {
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['inventory', stateFilter, sourceFilter, search, page],
    queryFn: () =>
      inventoryApi.getInventory({
        state: stateFilter || undefined,
        source: sourceFilter || undefined,
        limit,
        offset: page * limit,
        sort_by: 'created_at',
      }),
    refetchInterval: 10000,
  });

  const { data: statsData } = useQuery({
    queryKey: ['inventory-stats'],
    queryFn: () => inventoryApi.getInventoryStats(),
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => inventoryApi.deleteInventoryItem(id),
    onSuccess: () => {
      toast.success('素材已删除');
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
    },
    onError: (error: Error) => {
      toast.error(`删除失败: ${error.message}`);
    },
  });

  const expireMutation = useMutation({
    mutationFn: (id: number) => inventoryApi.expireItem(id),
    onSuccess: () => {
      toast.success('已标记为过期');
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
    },
    onError: (error: Error) => {
      toast.error(`操作失败: ${error.message}`);
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: () => inventoryApi.cleanupExpired(),
    onSuccess: (data) => {
      toast.success(`已清理 ${data.deleted} 条过期素材`);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
    },
    onError: (error: Error) => {
      toast.error(`清理失败: ${error.message}`);
    },
  });

  const items: InventoryItem[] = inventoryData?.data || [];
  const pagination = inventoryData?.pagination;
  const stats = statsData?.data;

  const stateCount = (targetState: string) => {
    const row = stats?.byState.find((s) => s.state === targetState);
    return row ? parseInt(row.count) : 0;
  };

  const stateBadge = (state: string) => {
    const classes: Record<string, string> = {
      ready: 'bg-green-100 text-green-700',
      pushed: 'bg-blue-100 text-blue-700',
      expired: 'bg-gray-100 text-gray-600',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${classes[state] || 'bg-gray-100 text-gray-600'}`}>
        {state}
      </span>
    );
  };

  const formatTime = (value: string | null) => {
    if (!value) return '-';
    return new Date(value).toLocaleString('zh-CN');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] gap-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
          <div className="p-3 bg-green-100 rounded-lg">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stateCount('ready')}</div>
            <div className="text-sm text-gray-500">待推送 (ready)</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <RotateCcw className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stateCount('pushed')}</div>
            <div className="text-sm text-gray-500">已推送 (pushed)</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
          <div className="p-3 bg-gray-100 rounded-lg">
            <AlertCircle className="w-6 h-6 text-gray-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{stateCount('expired')}</div>
            <div className="text-sm text-gray-500">已过期 (expired)</div>
          </div>
        </div>
      </div>

      {/* 过滤栏 */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索标题..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">全部状态</option>
            <option value="ready">ready</option>
            <option value="pushed">pushed</option>
            <option value="expired">expired</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">全部来源</option>
            {stats?.bySource.map((s) => (
              <option key={s.source} value={s.source}>
                {s.source}
              </option>
            ))}
          </select>
          <button
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            清理过期
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 bg-white rounded-lg shadow overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Package className="w-12 h-12 mb-2 opacity-50" />
              <p>暂无素材</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">缩略图</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">标题</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">来源</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">状态</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">重播</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">创建时间</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="w-16 h-16 bg-gray-100 rounded overflow-hidden">
                        {item.image_path ? (
                          <img
                            src={`/api/minio-proxy/${item.image_path.replace(/^\//, '')}`}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 max-w-xs truncate">
                        {item.title || '无标题'}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {item.fingerprint?.slice(0, 16)}...
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.source || '-'}</td>
                    <td className="px-4 py-3">{stateBadge(item.state)}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.replay_count}/{item.max_replays}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(item.created_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {item.state !== 'expired' && (
                          <button
                            onClick={() => expireMutation.mutate(item.id)}
                            disabled={expireMutation.isPending}
                            className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded"
                            title="标记过期"
                          >
                            <AlertCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteMutation.mutate(item.id)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 分页 */}
        {pagination && pagination.total > limit && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
            >
              上一页
            </button>
            <span className="text-sm text-gray-600">
              第 {page + 1} / {Math.ceil(pagination.total / limit)} 页
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasMore}
              className="px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default InventoryPage;
