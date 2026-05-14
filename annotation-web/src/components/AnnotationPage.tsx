import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, Send, Search, GripVertical } from 'lucide-react';

interface NewsRecord {
  id: number;
  title: string;
  category: string;
  dataSource: string;
  imagePath: string | null;
  pushedAt: Date;
  pushedAtUtc?: string | null;
  annotationStatus: 'pending' | 'annotating' | 'completed' | 'skipped';
  isRecent?: boolean;
  rawContent: any;
  processedContent: any;
}

function AnnotationPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pushTarget, setPushTarget] = useState<{cloud: boolean, esp32: boolean}>({cloud: true, esp32: true});

  // 从localStorage读取列宽配置，默认值：25%, 50%, 25%
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem('annotation-left-width');
    return saved ? parseFloat(saved) : 25;
  });
  const [middleWidth, setMiddleWidth] = useState(() => {
    const saved = localStorage.getItem('annotation-middle-width');
    return saved ? parseFloat(saved) : 50;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<'left' | 'right' | null>(null);
  const queryClient = useQueryClient();

  // 拖动事件处理
  const handleMouseDown = (divider: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = divider;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const percentage = (mouseX / containerRect.width) * 100;

    if (isDraggingRef.current === 'left') {
      // 左侧分隔条：调整左列宽度（限制在15%-40%）
      const newLeftWidth = Math.max(15, Math.min(40, percentage));
      setLeftWidth(newLeftWidth);
      localStorage.setItem('annotation-left-width', String(newLeftWidth));
    } else {
      // 右侧分隔条：调整中间列宽度（限制在30%-70%）
      const newMiddleWidth = Math.max(30, Math.min(70, percentage - leftWidth));
      setMiddleWidth(newMiddleWidth);
      localStorage.setItem('annotation-middle-width', String(newMiddleWidth));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftWidth]);

  // 获取标注总览统计（用于显示真实总数/状态）
  const { data: statisticsData } = useQuery({
    queryKey: ['statistics'],
    queryFn: () => apiClient.getStatistics(),
    refetchInterval: 30000,
  });

  const PAGE_SIZE = 2000;

  const {
    data: newsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['push-history-all'],
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      apiClient.getPushHistory({ limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.pagination?.hasMore ? pages.length * PAGE_SIZE : undefined,
    refetchInterval: 30000,
  });

  // 处理数据并排序
  const parsePushedAt = (item: any): { date: Date; utc?: string | null } => {
    if (typeof item.pushedAtEpoch === 'number') {
      return { date: new Date(item.pushedAtEpoch), utc: item.pushedAtUtc };
    }
    if (item.pushedAtUtc) {
      return { date: new Date(item.pushedAtUtc), utc: item.pushedAtUtc };
    }
    if (item.pushedAt) {
      const normalized = item.pushedAt
        .replace(/\//g, '-')
        .replace(' ', 'T');
      return { date: new Date(`${normalized}+08:00`) };
    }
    return { date: new Date() };
  };

  const allPages = newsData?.pages ?? [];

  const newsList = useMemo(() => {
    const combined = allPages.flatMap((page: any) => page?.data || []);
    return combined.map((item: any): NewsRecord => {
      const { date: pushedAtDate, utc: pushedAtUtc } = parsePushedAt(item);
      return {
        id: item.id,
        title: item.title || '未知标题',
        category: item.category || 'unknown',
        dataSource: item.dataSource || '未知',
        imagePath: item.imagePath,
        pushedAt: pushedAtDate,
        pushedAtUtc,
        annotationStatus: item.annotationStatus || 'pending',
        isRecent: Date.now() - pushedAtDate.getTime() < 3600000,
        rawContent: item.rawContent,
        processedContent: item.processedContent,
      };
    }).sort((a, b) => b.pushedAt.getTime() - a.pushedAt.getTime());
  }, [allPages]);

  const progress = statisticsData?.data?.progress;
  const firstPageTotal = allPages[0]?.pagination?.total;
  const overallTotal = progress?.total_count ?? firstPageTotal ?? newsList.length;
  const statusCounts = useMemo(() => {
    return newsList.reduce(
      (acc, record) => {
        if (record.annotationStatus === 'completed') {
          acc.completed += 1;
        } else if (record.annotationStatus === 'skipped') {
          acc.skipped += 1;
        } else {
          acc.pending += 1;
        }
        return acc;
      },
      { pending: 0, completed: 0, skipped: 0 }
    );
  }, [newsList]);
  const pendingTotal = newsList.length > 0
    ? statusCounts.pending
    : (progress?.pending_count ?? 0);
  const completedTotal = newsList.length > 0
    ? statusCounts.completed
    : (progress?.completed_count ?? 0);
  const skippedTotal = newsList.length > 0
    ? statusCounts.skipped
    : (progress?.skipped_count ?? 0);

  // 根据搜索关键词筛选数据
  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return newsList;

    const query = searchQuery.toLowerCase();
    return newsList.filter(item =>
      item.title.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query) ||
      item.dataSource.toLowerCase().includes(query)
    );
  }, [newsList, searchQuery]);

  // 查找选中的记录
  const selectedRecord = selectedId
    ? filteredList.find(r => r.id === selectedId)
    : filteredList[0];

  const currentRecord = selectedRecord || filteredList[0];

  // 格式化时间显示
  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;

    // 超过7天显示具体日期
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    return `${month}/${day} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  // 手动渲染的 mutation（仅在没有历史图片时使用）
  const renderMutation = useMutation({
    mutationFn: async (newsId: number) => {
      const response = await apiClient.client.post(
        `/api/annotation/news/${newsId}/render-preview`
      );
      return response.data;
    },
    onSuccess: () => {
      // 重新获取新闻列表以更新 image_path
      queryClient.invalidateQueries({ queryKey: ['pending-news'] });
    },
  });

  // 获取预览图路径
  const previewImagePath = currentRecord?.imagePath
    ? `/api/minio-proxy${currentRecord.imagePath}`
    : (renderMutation.isSuccess && renderMutation.data?.success
      ? `/api/minio-proxy${renderMutation.data.data.imagePath}`
      : null);

  // 快速标注mutation（点赞/点踩）
  const quickAnnotateMutation = useMutation({
    mutationFn: (action: 'like' | 'dislike') =>
      apiClient.quickAnnotate(currentRecord.id, action),
    onSuccess: (_, action) => {
      toast.success(action === 'like' ? '👍 已标记为高质量' : '👎 已标记为低质量');
      queryClient.invalidateQueries({ queryKey: ['push-history-all'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });

      // 自动跳转到下一条
      handleNext();
    },
    onError: () => {
      toast.error('标注失败，请重试');
    },
  });

  // 推送mutation
  const pushMutation = useMutation({
    mutationFn: ({id, renderer}: {id: number, renderer: 'device' | 'local-eink' | 'both'}) =>
      apiClient.resendPush(id, renderer),
    onSuccess: () => {
      toast.success('📤 推送已发送');
      queryClient.invalidateQueries({ queryKey: ['push-history-all'] });
    },
    onError: (error: Error) => {
      toast.error(`推送失败: ${error.message}`);
    },
  });

  const handleSelectRecord = (record: NewsRecord) => {
    setSelectedId(record.id);
  };

  const handlePrevious = () => {
    const currentIdx = filteredList.findIndex(r => r.id === selectedId);
    if (currentIdx > 0) {
      setSelectedId(filteredList[currentIdx - 1].id);
    }
  };

  const handleNext = () => {
    const currentIdx = filteredList.findIndex(r => r.id === selectedId);
    if (currentIdx >= 0 && currentIdx < filteredList.length - 1) {
      setSelectedId(filteredList[currentIdx + 1].id);
    }
  };

  const handleSkip = () => {
    handleNext();
  };

  const handleQuickAnnotate = (action: 'like' | 'dislike') => {
    if (currentRecord && !quickAnnotateMutation.isPending) {
      quickAnnotateMutation.mutate(action);
    }
  };

  const handleRenderPreview = () => {
    if (currentRecord) {
      renderMutation.mutate(currentRecord.id);
    }
  };

  const handlePush = () => {
    if (!currentRecord) return;
    let renderer: 'device' | 'local-eink' | 'both';
    if (pushTarget.cloud && pushTarget.esp32) renderer = 'both';
    else if (pushTarget.cloud) renderer = 'device';
    else if (pushTarget.esp32) renderer = 'local-eink';
    else return;
    pushMutation.mutate({ id: currentRecord.id, renderer });
  };

  // 搜索时重置选中
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setSelectedId(null);
  };

  // 键盘快捷键（WASD布局）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 检查是否在输入框中，避免干扰正常输入
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // W键：点赞（高质量/好）
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        handleQuickAnnotate('like');
      }
      // S键：点踩（低质量/差）
      else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleQuickAnnotate('dislike');
      }
      // A键：上一条
      else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handlePrevious();
      }
      // D键：下一条
      else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleNext();
      }
      // Space：跳过
      else if (e.key === ' ') {
        e.preventDefault();
        handleSkip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, filteredList, currentRecord]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!currentRecord) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <Search className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <p className="text-lg text-gray-600">
          {searchQuery ? '未找到匹配的记录' : '暂无数据'}
        </p>
        <p className="text-sm text-gray-500 mt-2">
          {searchQuery ? `没有包含 "${searchQuery}" 的记录` : '暂无任何新闻或推送记录'}
        </p>
        {searchQuery && (
          <button
            onClick={() => handleSearchChange('')}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            清除搜索
          </button>
        )}
      </div>
    );
  }

  const currentIdx = filteredList.findIndex(r => r.id === selectedId);

  return (
    <div ref={containerRef} className="flex h-[calc(100vh-12rem)] gap-0">
      {/* 第一列：新闻列表 */}
      <div style={{ width: `${leftWidth}%` }} className="flex flex-col bg-white rounded-lg shadow overflow-hidden">
        {/* 搜索框 */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索标题、分类或数据源..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* 统计信息 */}
          <div className="mt-2 text-xs text-gray-600">
            {searchQuery ? (
              <>
                找到 <span className="font-medium text-primary-600">{filteredList.length}</span> 条结果
                <span className="ml-1">（已加载 {newsList.length} / 总 {overallTotal}）</span>
              </>
            ) : (
              <>
                共 {overallTotal} 条 ·
                <span className="text-green-600 ml-1">{pendingTotal} 待标注</span> ·
                <span className="text-blue-600 ml-1">{completedTotal} 已标注</span> ·
                <span className="text-gray-600 ml-1">{skippedTotal} 已跳过</span>
                {overallTotal > newsList.length && (
                  <span className="ml-1 text-orange-600">
                    （当前已加载 {newsList.length} 条最新记录）
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* 新闻列表 */}
        <div className="flex-1 overflow-y-auto">
          {filteredList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Search className="w-12 h-12 mb-2 opacity-50" />
              <p>{searchQuery ? '未找到匹配的记录' : '暂无记录'}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredList.map((record) => {
                const isSelected = record.id === selectedId;
                return (
                  <div
                    key={record.id}
                    onClick={() => handleSelectRecord(record)}
                    className={`p-4 cursor-pointer transition-colors hover:bg-gray-50 ${
                      isSelected ? 'bg-primary-50 border-l-4 border-primary-600' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* 缩略图 */}
                      <div className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded overflow-hidden">
                        {record.imagePath ? (
                          <img
                            src={`/api/minio-proxy${record.imagePath}`}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
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

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className={`text-sm font-medium line-clamp-2 ${
                            isSelected ? 'text-primary-900' : 'text-gray-900'
                          }`}>
                            {record.title}
                          </h3>
                        </div>

                        {/* 状态标签 */}
                        <div className="flex items-center gap-1.5 text-xs mt-2 flex-wrap">
                          {record.annotationStatus === 'pending' && (
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                              🟢 待标注
                            </span>
                          )}
                          {record.annotationStatus === 'completed' && (
                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                              ✅ 已标注
                            </span>
                          )}
                          {record.annotationStatus === 'skipped' && (
                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded-full font-medium">
                              ⏭️ 已跳过
                            </span>
                          )}
                          {record.isRecent && (
                            <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-medium">
                              ⭐ 最新
                            </span>
                          )}
                          <span className="text-gray-500">{record.category}</span>
                          <span className="text-gray-400">·</span>
                          <span className="text-gray-500">{formatTime(record.pushedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasNextPage && (
          <div className="p-3 border-t border-gray-200 flex items-center justify-center bg-gray-50">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="px-3 py-1.5 text-xs rounded border border-primary-200 text-primary-600 hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFetchingNextPage ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>

      {/* 左侧拖动分隔条 */}
      <div
        onMouseDown={handleMouseDown('left')}
        className="w-1 bg-gray-200 hover:bg-primary-500 cursor-col-resize flex items-center justify-center transition-colors"
      >
        <GripVertical className="w-4 h-4 text-gray-400" />
      </div>

      {/* 第二列：新闻预览 */}
      <div style={{ width: `${middleWidth}%` }} className="bg-white rounded-lg shadow overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">新闻预览</h3>
            {(currentRecord.rawContent?.link || currentRecord.processedContent?.link) && (
              <a
                href={currentRecord.rawContent?.link || currentRecord.processedContent?.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-sm text-primary-600 hover:text-primary-700"
              >
                <ExternalLink className="w-4 h-4 mr-1" />
                查看原文
              </a>
            )}
          </div>

          <div className="space-y-4">
            {/* 图片预览区域 - 顶置显示 */}
            {previewImagePath && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-medium text-gray-500 uppercase">
                    推送预览图（历史图片）
                  </label>
                  <button
                    onClick={handleRenderPreview}
                    disabled={renderMutation.isPending}
                    className="flex items-center px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ImageIcon className="w-3 h-3 mr-1.5" />
                    重新渲染
                  </button>
                </div>

                {renderMutation.isPending ? (
                  <div className="border border-gray-200 rounded-lg p-8 bg-gray-50 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-2"></div>
                    <p className="text-sm text-gray-500">正在渲染图片...</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                    <img
                      src={previewImagePath}
                      alt="新闻预览图"
                      className="w-full h-auto"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      296×152 像素 - 实际推送到设备的样式
                    </p>
                  </div>
                )}

                {renderMutation.isError && (
                  <div className="mt-2 text-xs text-red-600">
                    渲染失败: {(renderMutation.error as Error).message}
                  </div>
                )}
              </div>
            )}

            {currentRecord.rawContent?.description && !currentRecord.rawContent && !currentRecord.processedContent && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">
                  摘要
                </label>
                <p className="mt-1 text-sm text-gray-700">
                  {currentRecord.rawContent?.description}
                </p>
              </div>
            )}

            {/* 原始RSS数据区域 */}
            {(currentRecord.rawContent || currentRecord.rawContent) && (
              <div className="mt-2">
                <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">
                  📋 原始RSS数据
                </label>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-yellow-800">原始标题：</span>
                    <p className="text-sm text-yellow-900 mt-1">
                      {(currentRecord.rawContent || currentRecord.rawContent)?.title}
                    </p>
                  </div>
                  {/* 显示原始正文：优先使用 raw_content.content，回退到 news.description */}
                  {((currentRecord.rawContent || currentRecord.rawContent)?.content || currentRecord.rawContent?.description) && (
                    <div>
                      <span className="text-xs font-semibold text-yellow-800">
                        原始摘要/正文：
                        {(currentRecord.rawContent || currentRecord.rawContent)?.content
                          ? `（${(currentRecord.rawContent || currentRecord.rawContent).content.length} 字符）`
                          : '（RSS摘要）'}
                      </span>
                      <p className="text-sm text-yellow-900 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                        {(currentRecord.rawContent || currentRecord.rawContent)?.content || currentRecord.rawContent?.description}
                      </p>
                    </div>
                  )}
                  {(currentRecord.rawContent || currentRecord.rawContent)?.description && (
                    <div>
                      <span className="text-xs font-semibold text-yellow-800">RSS Description：</span>
                      <p className="text-sm text-yellow-900 mt-1 line-clamp-2">
                        {(currentRecord.rawContent || currentRecord.rawContent).description}
                      </p>
                    </div>
                  )}
                  <div className="text-xs text-yellow-600">
                    来源: {(currentRecord.rawContent || currentRecord.rawContent)?.source} | 发布: {(currentRecord.rawContent || currentRecord.rawContent)?.publishTime || '未知'}
                  </div>
                </div>
              </div>
            )}

            {/* 处理后的数据区域 */}
            {(currentRecord.processedContent || currentRecord.processedContent) && (
              <div className="mt-2">
                <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">
                  ✨ AX优化后的数据
                </label>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-green-800">优化标题：</span>
                    <p className="text-sm text-green-900 mt-1 font-medium">
                      {(currentRecord.processedContent || currentRecord.processedContent)?.title}
                    </p>
                  </div>
                  {(currentRecord.processedContent || currentRecord.processedContent)?.message && (
                    <div>
                      <span className="text-xs font-semibold text-green-800">优化内容：</span>
                      <p className="text-sm text-green-900 mt-1">
                        {(currentRecord.processedContent || currentRecord.processedContent).message}
                      </p>
                    </div>
                  )}
                  {(currentRecord.processedContent || currentRecord.processedContent)?.signature && (
                    <div className="text-xs text-green-600">
                      处理器: {(currentRecord.processedContent || currentRecord.processedContent).signature}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
              <div>
                <span className="font-medium">分类:</span> {currentRecord.category || '未知'}
              </div>
              <div>
                <span className="font-medium">数据源:</span> {currentRecord.dataSource || currentRecord.dataSource}
              </div>
              <div className="col-span-2">
                <span className="font-medium">推送时间:</span>{' '}
                {new Date(currentRecord.pushedAt).toLocaleString('zh-CN')}
              </div>
              {currentRecord.rawContent?.publishTime && (
                <div className="col-span-2">
                  <span className="font-medium">发布时间:</span>{' '}
                  {new Date(currentRecord.rawContent.publishTime).toLocaleString('zh-CN')}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* 右侧拖动分隔条 */}
      <div
        onMouseDown={handleMouseDown('right')}
        className="w-1 bg-gray-200 hover:bg-primary-500 cursor-col-resize flex items-center justify-center transition-colors"
      >
        <GripVertical className="w-4 h-4 text-gray-400" />
      </div>

      {/* 第三列：标注和调试信息 */}
      <div style={{ width: `${100 - leftWidth - middleWidth}%` }} className="flex flex-col gap-4 overflow-y-auto">
        {/* 操作面板 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">操作</h3>

          <div className="space-y-3">
            {/* 标注按钮（待标注状态） */}
            {currentRecord.annotationStatus === 'pending' && (
              <>
                <button
                  onClick={() => handleQuickAnnotate('like')}
                  disabled={quickAnnotateMutation.isPending}
                  className="w-full flex items-center justify-center px-6 py-4 text-white bg-green-500 hover:bg-green-600 rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="点赞 / 高质量 (快捷键: W)"
                >
                  <span className="text-3xl mr-3">👍</span>
                  <span className="font-medium text-lg">好 / 高质量</span>
                  <span className="text-sm opacity-75 ml-2">(W)</span>
                </button>
                <button
                  onClick={() => handleQuickAnnotate('dislike')}
                  disabled={quickAnnotateMutation.isPending}
                  className="w-full flex items-center justify-center px-6 py-4 text-white bg-red-500 hover:bg-red-600 rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="点踩 / 低质量 (快捷键: S)"
                >
                  <span className="text-3xl mr-3">👎</span>
                  <span className="font-medium text-lg">差 / 低质量</span>
                  <span className="text-sm opacity-75 ml-2">(S)</span>
                </button>
                <button
                  onClick={handleSkip}
                  className="w-full px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  跳过 (Space)
                </button>
              </>
            )}

            {/* 重新推送按钮（所有记录都可推送） */}
            <div className="space-y-2">
              <div className="flex gap-4 px-2">
                <label className="flex items-center text-sm">
                  <input type="checkbox" checked={pushTarget.cloud}
                         onChange={e => setPushTarget(t => ({...t, cloud: e.target.checked}))}
                         className="mr-2" />
                  ☁️ MindReset 云端
                </label>
                <label className="flex items-center text-sm">
                  <input type="checkbox" checked={pushTarget.esp32}
                         onChange={e => setPushTarget(t => ({...t, esp32: e.target.checked}))}
                         className="mr-2" />
                  📟 ESP32-C3 本地
                </label>
              </div>
              <button
                onClick={handlePush}
                disabled={pushMutation.isPending || (!pushTarget.cloud && !pushTarget.esp32)}
                className="w-full flex items-center justify-center px-6 py-4 text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-6 h-6 mr-3" />
                <span className="font-medium text-lg">
                  {pushMutation.isPending ? '推送中...' : '重新推送到选中设备'}
                </span>
              </button>
            </div>

            {/* 已标注/跳过的提示 */}
            {currentRecord.annotationStatus === 'completed' && (
              <div className="text-sm text-green-600 text-center py-2 bg-green-50 rounded">
                ✅ 已完成标注
              </div>
            )}
            {currentRecord.annotationStatus === 'skipped' && (
              <div className="text-sm text-gray-600 text-center py-2 bg-gray-50 rounded">
                ⏭️ 已跳过此条
              </div>
            )}
          </div>

          {/* 导航按钮 */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="text-xs text-gray-500 text-center mb-3">
              💡 A 上一条 | D 下一条 | Space 跳过
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={handlePrevious}
                disabled={currentIdx <= 0}
                className="flex-1 flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                上一条
              </button>
              <button
                onClick={handleNext}
                disabled={currentIdx >= filteredList.length - 1}
                className="flex-1 flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一条
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default AnnotationPage;
