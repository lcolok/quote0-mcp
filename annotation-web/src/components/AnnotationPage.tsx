import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type { QualityAnnotation } from '../types';
import AnnotationForm from './AnnotationForm';
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon } from 'lucide-react';

function AnnotationPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const queryClient = useQueryClient();

  // 获取待标注新闻列表
  const { data: newsData, isLoading } = useQuery({
    queryKey: ['pending-news'],
    queryFn: () =>
      apiClient.getNews({
        status: 'pending',
        limit: 50,
      }),
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
  const previewImagePath = currentNews?.image_path ||
    (renderMutation.isSuccess && renderMutation.data?.success
      ? renderMutation.data.data.imagePath
      : null);

  // 提交标注mutation
  const submitMutation = useMutation({
    mutationFn: (annotation: Omit<QualityAnnotation, 'id' | 'news_id'>) =>
      apiClient.submitAnnotation(currentNews.id, annotation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-news'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });

      // 自动跳转到下一条
      if (currentIndex < newsList.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    },
  });

  const handleSubmit = (annotation: Omit<QualityAnnotation, 'id' | 'news_id'>) => {
    submitMutation.mutate(annotation);
  };

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

  const handleRenderPreview = () => {
    if (currentNews) {
      renderMutation.mutate(currentNews.id);
    }
  };

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
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">
                标题
              </label>
              <p className="mt-1 text-base font-medium text-gray-900">
                {currentNews.title}
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 uppercase">
                来源
              </label>
              <p className="mt-1 text-sm text-gray-700">{currentNews.source}</p>
            </div>

            {currentNews.description && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">
                  摘要
                </label>
                <p className="mt-1 text-sm text-gray-700">
                  {currentNews.description}
                </p>
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

            {/* 图片预览区域 - 仅在有历史图片时显示 */}
            {previewImagePath && (
              <div className="mt-4 pt-4 border-t border-gray-200">
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

            {/* 调试信息面板 */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-500 uppercase">
                  调试信息
                </label>
                <button
                  onClick={() => {
                    const debugInfo = {
                      id: currentNews.id,
                      title: currentNews.title,
                      source: currentNews.source,
                      data_source: currentNews.data_source,
                      category: currentNews.category,
                      rss_index: currentNews.rss_index,
                      image_path: currentNews.image_path,
                      publish_time: currentNews.publish_time,
                      link: currentNews.link,
                      annotation_status: currentNews.annotation_status,
                      created_at: currentNews.created_at
                    };
                    navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
                    alert('调试信息已复制到剪贴板');
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  📋 复制调试信息
                </button>
              </div>
              <div className="bg-gray-100 rounded p-3 text-xs font-mono space-y-1">
                <div><span className="text-gray-600">ID:</span> {currentNews.id}</div>
                <div><span className="text-gray-600">来源字段:</span> {currentNews.source}</div>
                <div><span className="text-gray-600">数据源字段:</span> {currentNews.data_source}</div>
                <div><span className="text-gray-600">RSS索引:</span> {currentNews.rss_index ?? 'null'}</div>
                <div><span className="text-gray-600">图片路径:</span> {currentNews.image_path || '无'}</div>
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
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* 导航按钮 */}
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              上一条
            </button>

            <button
              onClick={handleSkip}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              跳过
            </button>

            <button
              onClick={handleNext}
              disabled={currentIndex === newsList.length - 1}
              className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一条
              <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          </div>
        </div>

        {/* 标注表单 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">质量评估</h3>
          <AnnotationForm
            onSubmit={handleSubmit}
            isSubmitting={submitMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}

export default AnnotationPage;
