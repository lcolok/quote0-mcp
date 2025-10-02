import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon } from 'lucide-react';

function AnnotationPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const queryClient = useQueryClient();

  // 获取待标注新闻列表（自动刷新）
  const { data: newsData, isLoading } = useQuery({
    queryKey: ['pending-news'],
    queryFn: () =>
      apiClient.getNews({
        status: 'pending',
        limit: 1000, // 加载全量待标注数据
      }),
    refetchInterval: 30000, // 每30秒自动刷新一次
    staleTime: 0, // 数据立即过期，确保每次都是最新的
  });

  const newsList = newsData?.data || [];
  const currentNews = newsList[currentIndex];

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

  // 获取预览图路径（优先使用历史图片）
  const rawImagePath = currentNews?.image_path ||
    (renderMutation.isSuccess && renderMutation.data?.success
      ? renderMutation.data.data.imagePath
      : null);

  // 通过API代理访问MinIO图片（使用相对路径，nginx会转发到news-api）
  const previewImagePath = rawImagePath
    ? `/api/minio-proxy${rawImagePath}`
    : null;

  // 快速标注mutation（点赞/点踩）
  const quickAnnotateMutation = useMutation({
    mutationFn: (action: 'like' | 'dislike') =>
      apiClient.quickAnnotate(currentNews.id, action),
    onSuccess: (_, action) => {
      toast.success(action === 'like' ? '👍 已标记为高质量' : '👎 已标记为低质量');
      queryClient.invalidateQueries({ queryKey: ['pending-news'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });

      // 自动跳转到下一条
      if (currentIndex < newsList.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    },
    onError: () => {
      toast.error('标注失败，请重试');
    },
  });

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < newsList.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleSkip = () => {
    if (currentIndex < newsList.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleQuickAnnotate = (action: 'like' | 'dislike') => {
    if (currentNews && !quickAnnotateMutation.isPending) {
      quickAnnotateMutation.mutate(action);
    }
  };

  const handleRenderPreview = () => {
    if (currentNews) {
      renderMutation.mutate(currentNews.id);
    }
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
  }, [currentIndex, newsList.length, currentNews]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!currentNews) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-lg text-gray-600">暂无待标注新闻</p>
        <p className="text-sm text-gray-500 mt-2">
          请前往"导入数据"页面导入新的新闻数据
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 进度条 */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            进度: {currentIndex + 1} / {newsList.length}
          </span>
          <span className="text-sm text-gray-500">
            剩余 {newsList.length - currentIndex - 1} 条
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-primary-600 h-2 rounded-full transition-all duration-300"
            style={{
              width: `${((currentIndex + 1) / newsList.length) * 100}%`,
            }}
          ></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 新闻预览 */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">新闻预览</h3>
            {currentNews.link && (
              <a
                href={currentNews.link}
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
            {currentNews.raw_content && (
              <div className="mt-2">
                <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">
                  📋 原始RSS数据
                </label>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-yellow-800">原始标题：</span>
                    <p className="text-sm text-yellow-900 mt-1">{currentNews.raw_content.title}</p>
                  </div>
                  {/* 显示原始正文：优先使用 raw_content.content，回退到 news.description */}
                  {(currentNews.raw_content.content || currentNews.description) && (
                    <div>
                      <span className="text-xs font-semibold text-yellow-800">
                        原始摘要/正文：
                        {currentNews.raw_content.content
                          ? `（${currentNews.raw_content.content.length} 字符）`
                          : '（RSS摘要）'}
                      </span>
                      <p className="text-sm text-yellow-900 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                        {currentNews.raw_content.content || currentNews.description}
                      </p>
                    </div>
                  )}
                  {currentNews.raw_content.description && (
                    <div>
                      <span className="text-xs font-semibold text-yellow-800">RSS Description：</span>
                      <p className="text-sm text-yellow-900 mt-1 line-clamp-2">
                        {currentNews.raw_content.description}
                      </p>
                    </div>
                  )}
                  <div className="text-xs text-yellow-600">
                    来源: {currentNews.raw_content.source} | 发布: {currentNews.raw_content.publishTime || '未知'}
                  </div>
                </div>
              </div>
            )}

            {/* 处理后的数据区域 */}
            {currentNews.processed_content && (
              <div className="mt-2">
                <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">
                  ✨ AX优化后的数据
                </label>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-green-800">优化标题：</span>
                    <p className="text-sm text-green-900 mt-1 font-medium">{currentNews.processed_content.title}</p>
                  </div>
                  {currentNews.processed_content.message && (
                    <div>
                      <span className="text-xs font-semibold text-green-800">优化内容：</span>
                      <p className="text-sm text-green-900 mt-1">
                        {currentNews.processed_content.message}
                      </p>
                    </div>
                  )}
                  {currentNews.processed_content.signature && (
                    <div className="text-xs text-green-600">
                      处理器: {currentNews.processed_content.signature}
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
                <span className="font-medium">数据源:</span> {currentNews.data_source}
              </div>
              {currentNews.publish_time && (
                <div className="col-span-2">
                  <span className="font-medium">发布时间:</span>{' '}
                  {new Date(currentNews.publish_time).toLocaleString('zh-CN')}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* 右侧：调试信息和快速标注 */}
        <div className="space-y-6">
          {/* 快速标注按钮 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">快速标注</h3>
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

            {/* 导航按钮 */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="text-xs text-gray-500 text-center mb-3">
                💡 A 上一条 | D 下一条 | Space 跳过
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={handlePrevious}
                  disabled={currentIndex === 0}
                  className="flex-1 flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  上一条
                </button>
                <button
                  onClick={handleNext}
                  disabled={currentIndex === newsList.length - 1}
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
    </div>
  );
}

export default AnnotationPage;
