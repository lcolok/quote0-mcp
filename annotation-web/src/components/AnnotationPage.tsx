import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, Send, Search, GripVertical } from 'lucide-react';

type RecordType = 'pending' | 'pushed';

interface MixedRecord {
  id: number;
  type: RecordType;
  title: string;
  category: string;
  dataSource: string;
  imagePath: string | null;
  timestamp: Date;
  isRecent?: boolean;
  originalData: any;
}

function AnnotationPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  // 获取待标注新闻列表
  const { data: newsData, isLoading: newsLoading } = useQuery({
    queryKey: ['pending-news'],
    queryFn: () =>
      apiClient.getNews({
        status: 'pending',
        limit: 1000,
      }),
    refetchInterval: 30000,
    staleTime: 0,
  });

  // 获取推送历史
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['push-history-all'],
    queryFn: () => apiClient.getPushHistory({ limit: 1000 }),
    refetchInterval: 10000,
  });

  // 混合并排序数据
  const mixedList = useMemo(() => {
    const pending: MixedRecord[] = (newsData?.data || []).map((item: any) => ({
      id: item.id,
      type: 'pending' as RecordType,
      title: item.title || item.processed_content?.title || item.raw_content?.title || '未知标题',
      category: item.category || '未知',
      dataSource: item.data_source || item.source || '未知',
      imagePath: item.image_path,
      timestamp: new Date(item.created_at || Date.now()),
      originalData: item,
    }));

    const pushed: MixedRecord[] = (historyData?.data || []).map((item: any) => ({
      id: item.id,
      type: 'pushed' as RecordType,
      title: item.title || '未知标题',
      category: item.category || '未知',
      dataSource: item.dataSource || '未知',
      imagePath: item.imagePath,
      timestamp: new Date(item.pushedAt || Date.now()),
      isRecent: item.pushedAt && (Date.now() - new Date(item.pushedAt).getTime() < 3600000),
      originalData: item,
    }));

    // 合并并按时间排序（最新的在前）
    return [...pending, ...pushed].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [newsData, historyData]);

  // 根据搜索关键词筛选数据
  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return mixedList;

    const query = searchQuery.toLowerCase();
    return mixedList.filter(item =>
      item.title.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query) ||
      item.dataSource.toLowerCase().includes(query)
    );
  }, [mixedList, searchQuery]);

  // 查找选中的记录
  const selectedRecord = selectedId
    ? filteredList.find(r => r.id === selectedId && r.type === (mixedList.find(m => m.id === selectedId)?.type || 'pending'))
    : filteredList[0];

  const currentRecord = selectedRecord || filteredList[0];
  const isLoadingData = newsLoading || historyLoading;

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
  const rawImagePath = currentRecord?.imagePath ||
    (renderMutation.isSuccess && renderMutation.data?.success
      ? renderMutation.data.data.imagePath
      : null);

  // 通过API代理访问MinIO图片
  const previewImagePath = rawImagePath
    ? `/api/minio-proxy${rawImagePath}`
    : null;

  // 快速标注mutation（点赞/点踩）
  const quickAnnotateMutation = useMutation({
    mutationFn: (action: 'like' | 'dislike') =>
      apiClient.quickAnnotate(currentRecord.originalData.id, action),
    onSuccess: (_, action) => {
      toast.success(action === 'like' ? '👍 已标记为高质量' : '👎 已标记为低质量');
      queryClient.invalidateQueries({ queryKey: ['pending-news'] });
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
    mutationFn: (id: number) => apiClient.resendPush(id),
    onSuccess: () => {
      toast.success('📤 推送成功');
    },
    onError: (error: Error) => {
      toast.error(`推送失败: ${error.message}`);
    },
  });

  const handleSelectRecord = (record: MixedRecord) => {
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
    if (currentRecord && currentRecord.type === 'pending' && !quickAnnotateMutation.isPending) {
      quickAnnotateMutation.mutate(action);
    }
  };

  const handleRenderPreview = () => {
    if (currentRecord && currentRecord.type === 'pending') {
      renderMutation.mutate(currentRecord.originalData.id);
    }
  };

  const handlePush = () => {
    if (currentRecord && currentRecord.type === 'pushed') {
      pushMutation.mutate(currentRecord.id);
    }
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

  if (isLoadingData) {
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

  const currentNews = currentRecord.originalData;
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
                <span className="ml-1">（共 {mixedList.length} 条）</span>
              </>
            ) : (
              <>
                共 {mixedList.length} 条 ·
                <span className="text-green-600 ml-1">{mixedList.filter(r => r.type === 'pending').length} 待标注</span> ·
                <span className="text-blue-600 ml-1">{mixedList.filter(r => r.type === 'pushed').length} 已推送</span>
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
                    key={`${record.type}-${record.id}`}
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

                        {/* 状态和时间 */}
                        <div className="flex items-center gap-2 text-xs mt-2">
                          {record.type === 'pending' ? (
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                              🟢 待标注
                            </span>
                          ) : (
                            <>
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                                🔵 已推送
                              </span>
                              {record.isRecent && (
                                <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-medium">
                                  ⭐ 最新
                                </span>
                              )}
                            </>
                          )}
                          <span className="text-gray-500">{record.category}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
            <h3 className="text-lg font-semibold text-gray-900">
              {currentRecord.type === 'pending' ? '新闻预览' : '推送历史预览'}
            </h3>
            {(currentNews.link || currentNews.rawContent?.link) && (
              <a
                href={currentNews.link || currentNews.rawContent?.link}
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

            {currentNews.description && !currentNews.raw_content && !currentNews.processed_content && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">
                  摘要
                </label>
                <p className="mt-1 text-sm text-gray-700">
                  {currentNews.description}
                </p>
              </div>
            )}

            {/* 原始RSS数据区域 */}
            {(currentNews.raw_content || currentNews.rawContent) && (
              <div className="mt-2">
                <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">
                  📋 原始RSS数据
                </label>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-yellow-800">原始标题：</span>
                    <p className="text-sm text-yellow-900 mt-1">
                      {(currentNews.raw_content || currentNews.rawContent)?.title}
                    </p>
                  </div>
                  {/* 显示原始正文：优先使用 raw_content.content，回退到 news.description */}
                  {((currentNews.raw_content || currentNews.rawContent)?.content || currentNews.description) && (
                    <div>
                      <span className="text-xs font-semibold text-yellow-800">
                        原始摘要/正文：
                        {(currentNews.raw_content || currentNews.rawContent)?.content
                          ? `（${(currentNews.raw_content || currentNews.rawContent).content.length} 字符）`
                          : '（RSS摘要）'}
                      </span>
                      <p className="text-sm text-yellow-900 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                        {(currentNews.raw_content || currentNews.rawContent)?.content || currentNews.description}
                      </p>
                    </div>
                  )}
                  {(currentNews.raw_content || currentNews.rawContent)?.description && (
                    <div>
                      <span className="text-xs font-semibold text-yellow-800">RSS Description：</span>
                      <p className="text-sm text-yellow-900 mt-1 line-clamp-2">
                        {(currentNews.raw_content || currentNews.rawContent).description}
                      </p>
                    </div>
                  )}
                  <div className="text-xs text-yellow-600">
                    来源: {(currentNews.raw_content || currentNews.rawContent)?.source} | 发布: {(currentNews.raw_content || currentNews.rawContent)?.publishTime || '未知'}
                  </div>
                </div>
              </div>
            )}

            {/* 处理后的数据区域 */}
            {(currentNews.processed_content || currentNews.processedContent) && (
              <div className="mt-2">
                <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">
                  ✨ AX优化后的数据
                </label>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-green-800">优化标题：</span>
                    <p className="text-sm text-green-900 mt-1 font-medium">
                      {(currentNews.processed_content || currentNews.processedContent)?.title}
                    </p>
                  </div>
                  {(currentNews.processed_content || currentNews.processedContent)?.message && (
                    <div>
                      <span className="text-xs font-semibold text-green-800">优化内容：</span>
                      <p className="text-sm text-green-900 mt-1">
                        {(currentNews.processed_content || currentNews.processedContent).message}
                      </p>
                    </div>
                  )}
                  {(currentNews.processed_content || currentNews.processedContent)?.signature && (
                    <div className="text-xs text-green-600">
                      处理器: {(currentNews.processed_content || currentNews.processedContent).signature}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
              <div>
                <span className="font-medium">分类:</span> {currentNews.category || '未知'}
              </div>
              <div>
                <span className="font-medium">数据源:</span> {currentNews.data_source || currentNews.dataSource}
              </div>
              {currentRecord.type === 'pushed' && currentNews.pushedAt && (
                <div className="col-span-2">
                  <span className="font-medium">推送时间:</span>{' '}
                  {new Date(currentNews.pushedAt).toLocaleString('zh-CN')}
                </div>
              )}
              {currentRecord.type === 'pending' && currentNews.publish_time && (
                <div className="col-span-2">
                  <span className="font-medium">发布时间:</span>{' '}
                  {new Date(currentNews.publish_time).toLocaleString('zh-CN')}
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
        {/* 快速标注 / 推送操作 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {currentRecord.type === 'pending' ? '快速标注' : '推送操作'}
          </h3>

          {currentRecord.type === 'pending' ? (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleQuickAnnotate('like')}
                disabled={quickAnnotateMutation.isPending}
                className="flex items-center justify-center px-6 py-4 text-white bg-green-500 hover:bg-green-600 rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="点赞 / 高质量 (快捷键: W)"
              >
                <span className="text-3xl mr-3">👍</span>
                <span className="font-medium text-lg">好 / 高质量</span>
                <span className="text-sm opacity-75 ml-2">(W)</span>
              </button>
              <button
                onClick={() => handleQuickAnnotate('dislike')}
                disabled={quickAnnotateMutation.isPending}
                className="flex items-center justify-center px-6 py-4 text-white bg-red-500 hover:bg-red-600 rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="点踩 / 低质量 (快捷键: S)"
              >
                <span className="text-3xl mr-3">👎</span>
                <span className="font-medium text-lg">差 / 低质量</span>
                <span className="text-sm opacity-75 ml-2">(S)</span>
              </button>
              <button
                onClick={handleSkip}
                className="px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                跳过 (Space)
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                onClick={handlePush}
                disabled={pushMutation.isPending}
                className="flex items-center justify-center px-6 py-4 text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-6 h-6 mr-3" />
                <span className="font-medium text-lg">
                  {pushMutation.isPending ? '推送中...' : '重新推送到设备'}
                </span>
              </button>
              <div className="text-xs text-gray-500 text-center mt-2">
                将此历史记录重新推送到 MindReset 设备
              </div>
            </div>
          )}

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

        {/* 调试信息面板 */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="mt-0 pt-0">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-500 uppercase">
                调试信息
              </label>
              <button
                onClick={() => {
                  const debugInfo = {
                    // 基础信息
                    id: currentNews.id,
                    title: currentNews.title,
                    description: currentNews.description,
                    source: currentNews.source,
                    data_source: currentNews.data_source,
                    category: currentNews.category,
                    rss_index: currentNews.rss_index,
                    image_path: currentNews.image_path,
                    publish_time: currentNews.publish_time,
                    link: currentNews.link,
                    annotation_status: currentNews.annotation_status,
                    created_at: currentNews.created_at,
                    updated_at: currentNews.updated_at,

                    // 原始RSS数据
                    raw_content: currentNews.raw_content || null,

                    // AX优化后的数据
                    processed_content: currentNews.processed_content || null,

                    // 数据对比分析
                    data_analysis: {
                      has_raw_data: !!currentNews.raw_content,
                      has_processed_data: !!currentNews.processed_content,
                      has_description: !!currentNews.description,
                      data_source_type: currentNews.data_source,
                      is_from_push_log: currentNews.data_source === 'push_log',
                      has_image: !!currentNews.image_path
                    }
                  };
                  navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
                  toast.success('完整调试信息已复制到剪贴板');
                }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                📋 复制完整调试信息
              </button>
            </div>
            <div className="bg-gray-100 rounded p-3 text-xs font-mono space-y-1">
              <div><span className="text-gray-600">ID:</span> {currentNews.id}</div>
              <div><span className="text-gray-600">来源字段:</span> {currentNews.source}</div>
              <div><span className="text-gray-600">数据源字段:</span> {currentNews.data_source}</div>
              <div><span className="text-gray-600">RSS索引:</span> {currentNews.rss_index ?? 'null'}</div>
              <div><span className="text-gray-600">图片路径:</span> {currentNews.image_path || '无'}</div>

              <div className="pt-2 border-t border-gray-300">
                <span className="text-gray-600">数据完整性:</span>
                <ul className="ml-4 mt-1 space-y-1">
                  <li className={currentNews.raw_content ? "text-green-600" : "text-gray-500"}>
                    {currentNews.raw_content ? "✓" : "○"} 原始RSS数据
                  </li>
                  <li className={currentNews.processed_content ? "text-green-600" : "text-gray-500"}>
                    {currentNews.processed_content ? "✓" : "○"} AX优化数据
                  </li>
                  <li className={currentNews.description ? "text-green-600" : "text-gray-500"}>
                    {currentNews.description ? "✓" : "○"} 描述信息
                  </li>
                  <li className={currentNews.image_path ? "text-green-600" : "text-gray-500"}>
                    {currentNews.image_path ? "✓" : "○"} 历史图片
                  </li>
                </ul>
              </div>

              <div className="pt-2 border-t border-gray-300">
                <span className="text-gray-600">问题诊断:</span>
                <ul className="ml-4 mt-1 space-y-1">
                  {!currentNews.image_path && (
                    <li className="text-orange-600">⚠️ 无历史图片路径</li>
                  )}
                  {currentNews.data_source !== 'rss' && (
                    <li className="text-blue-600">ℹ️ 数据源类型: {currentNews.data_source}</li>
                  )}
                  {currentNews.rss_index === null && (
                    <li className="text-orange-600">⚠️ 缺少RSS索引</li>
                  )}
                  {!currentNews.raw_content && !currentNews.processed_content && (
                    <li className="text-orange-600">⚠️ 无原始/优化数据（可能是直接导入）</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnnotationPage;
