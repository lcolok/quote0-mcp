import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, BASE_URL } from '../api/client';
import {
  Search,
  Send,
  Clock,
  Image as ImageIcon,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

interface PushRecord {
  id: number;
  title: string;
  originalTitle: string;
  summary: string;
  imagePath: string | null;
  publishTime: string;
  pushedAt: string;
  pushedAtUtc?: string | null;
  pushedAtEpoch?: number | null;
  category: string;
  dataSource: string;
  rawContent: any;
  processedContent: any;
}

function SchedulerPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const limit = 50;

  // 查询推送历史
  const { data: historyData, isLoading } = useQuery({
    queryKey: ['push-history', search, page],
    queryFn: () =>
      apiClient.getPushHistory({
        search,
        limit,
        offset: page * limit,
      }),
    refetchInterval: 10000, // 每10秒刷新
  });

  // 查询选中记录的详情（保留用于未来扩展）
  useQuery({
    queryKey: ['push-detail', selectedId],
    queryFn: () => apiClient.getPushDetail(selectedId!),
    enabled: !!selectedId,
  });

  // 重新推送
  const resendMutation = useMutation({
    mutationFn: (id: number) => apiClient.resendPush(id, 'device'),
    onSuccess: () => {
      toast.success('推送成功');
      queryClient.invalidateQueries({ queryKey: ['push-history'] });
    },
    onError: (error: Error) => {
      toast.error(`推送失败: ${error.message}`);
    },
  });

  const records: PushRecord[] = historyData?.data || [];
  const pagination = historyData?.pagination;
  const selectedRecord = records.find(r => r.id === selectedId);

  const parseCstString = (value: string): Date => {
    const normalized = value
      .replace(/\//g, '-')
      .replace(' ', 'T');
    return new Date(`${normalized}+08:00`);
  };

  const getPushedDate = (record: PushRecord): Date => {
    if (typeof record.pushedAtEpoch === 'number') {
      return new Date(record.pushedAtEpoch);
    }
    const base = record.pushedAtUtc || record.pushedAt;
    if (!base) return new Date();
    if (record.pushedAtUtc) {
      return new Date(base);
    }
    return parseCstString(base);
  };

  const formatTime = (record: PushRecord) => {
    const date = getPushedDate(record);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const isRecent = (record: PushRecord) => {
    const diff = Date.now() - getPushedDate(record).getTime();
    return diff < 3600000; // 1小时内
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-6">
      {/* 左侧：推送列表 */}
      <div className="w-2/5 flex flex-col bg-white rounded-lg shadow overflow-hidden">
        {/* 搜索栏 */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索标题或摘要..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          {pagination && (
            <div className="mt-2 text-xs text-gray-600">
              共 {pagination.total} 条推送记录
            </div>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Search className="w-12 h-12 mb-2 opacity-50" />
              <p>暂无推送记录</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {records.map((record) => {
                const isSelected = record.id === selectedId;
                const recent = isRecent(record);

                return (
                  <div
                    key={record.id}
                    onClick={() => setSelectedId(record.id)}
                    className={`p-4 cursor-pointer transition-colors hover:bg-gray-50 ${
                      isSelected ? 'bg-primary-50 border-l-4 border-primary-600' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* 缩略图 */}
                      <div className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded overflow-hidden">
                        {record.imagePath ? (
                          <img
                            src={`${BASE_URL}${record.imagePath}`}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.src = '';
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3
                            className={`text-sm font-medium line-clamp-2 ${
                              isSelected ? 'text-primary-900' : 'text-gray-900'
                            }`}
                          >
                            {record.title}
                          </h3>
                          {recent && (
                            <span className="flex-shrink-0 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                              最新
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                          {record.summary}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTime(record)}
                          </span>
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                            {record.category}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 分页 */}
        {pagination && pagination.total > limit && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="text-sm text-gray-600">
              第 {page + 1} / {Math.ceil(pagination.total / limit)} 页
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!pagination.hasMore}
              className="px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        )}
      </div>

      {/* 右侧：详情预览 */}
      <div className="flex-1 bg-white rounded-lg shadow overflow-hidden flex flex-col">
        {selectedRecord ? (
          <>
            {/* 头部操作栏 */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">推送详情</h2>
                <p className="text-sm text-gray-600 mt-0.5">
                  ID: {selectedRecord.id} · {formatTime(selectedRecord)}
                </p>
              </div>
              <button
                onClick={() => resendMutation.mutate(selectedRecord.id)}
                disabled={resendMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {resendMutation.isPending ? '推送中...' : '重新推送'}
              </button>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 图片预览 */}
              {selectedRecord.imagePath && (
                <div className="bg-gray-50 rounded-lg overflow-hidden">
                  <img
                    src={`${BASE_URL}${selectedRecord.imagePath}`}
                    alt={selectedRecord.title}
                    className="w-full h-auto"
                    onError={(e) => {
                      e.currentTarget.parentElement!.style.display = 'none';
                    }}
                  />
                </div>
              )}

              {/* 处理后的内容 */}
              {selectedRecord.processedContent && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Sparkles className="w-4 h-4 text-primary-600" />
                    优化后的内容
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                    <div>
                      <div className="text-xs text-blue-700 mb-1">标题</div>
                      <div className="text-sm font-medium text-blue-900">
                        {selectedRecord.processedContent.title || selectedRecord.title}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-blue-700 mb-1">摘要</div>
                      <div className="text-sm text-blue-900 whitespace-pre-wrap">
                        {selectedRecord.processedContent.message || selectedRecord.summary}
                      </div>
                    </div>
                    {selectedRecord.processedContent.signature && (
                      <div className="text-xs text-blue-600 pt-2 border-t border-blue-200">
                        处理器: {selectedRecord.processedContent.signature}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 原始内容 */}
              {selectedRecord.rawContent && (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-gray-700">原始内容</div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">标题</div>
                      <div className="text-sm text-gray-900">
                        {selectedRecord.rawContent.title}
                      </div>
                    </div>
                    {selectedRecord.rawContent.description && (
                      <div>
                        <div className="text-xs text-gray-600 mb-1">描述</div>
                        <div className="text-sm text-gray-700 whitespace-pre-wrap">
                          {selectedRecord.rawContent.description}
                        </div>
                      </div>
                    )}
                    {selectedRecord.rawContent.content && (
                      <div>
                        <div className="text-xs text-gray-600 mb-1">正文</div>
                        <div className="text-sm text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {selectedRecord.rawContent.content}
                        </div>
                      </div>
                    )}
                    {selectedRecord.rawContent.link && (
                      <div>
                        <a
                          href={selectedRecord.rawContent.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
                        >
                          <ExternalLink className="w-4 h-4" />
                          访问原文
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 元数据 */}
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-700">元数据</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600 mb-1">分类</div>
                    <div className="font-medium text-gray-900">{selectedRecord.category}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600 mb-1">数据源</div>
                    <div className="font-medium text-gray-900">{selectedRecord.dataSource}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600 mb-1">推送时间</div>
                    <div className="font-medium text-gray-900">
                      {new Date(selectedRecord.pushedAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  {selectedRecord.publishTime && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-600 mb-1">发布时间</div>
                      <div className="font-medium text-gray-900">
                        {new Date(selectedRecord.publishTime).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg font-medium">选择一条推送记录查看详情</p>
            <p className="text-sm mt-1">点击左侧列表中的任意记录</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SchedulerPage;
