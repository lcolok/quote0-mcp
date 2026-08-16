import axios, { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  NewsRawData,
  NewsWithAnnotation,
  QualityAnnotation,
  AnnotationStatistics,
  ImportRSSRequest,
} from '../types';

// 在生产环境（Docker）中使用相对路径，nginx会代理到news-api
// 在开发环境中使用localhost
export const BASE_URL = (import.meta as any).env?.VITE_API_URL || (
  (import.meta as any).env?.MODE === 'production' ? '' : 'http://localhost:3001'
);

class AnnotationApiClient {
  public client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('API请求失败:', error);
        return Promise.reject(error);
      }
    );
  }

  /**
   * 获取待标注新闻列表
   */
  async getNews(params: {
    status?: 'pending' | 'annotating' | 'completed' | 'skipped';
    limit?: number;
    offset?: number;
    category?: string;
  }): Promise<ApiResponse<NewsRawData[]>> {
    const response = await this.client.get<ApiResponse<NewsRawData[]>>('/api/annotation/news', {
      params,
    });
    return response.data;
  }

  /**
   * 获取新闻详情
   */
  async getNewsById(id: number): Promise<ApiResponse<NewsWithAnnotation>> {
    const response = await this.client.get<ApiResponse<NewsWithAnnotation>>(
      `/api/annotation/news/${id}`
    );
    return response.data;
  }

  /**
   * 提交标注
   */
  async submitAnnotation(
    newsId: number,
    annotation: Omit<QualityAnnotation, 'id' | 'news_id'>
  ): Promise<ApiResponse<QualityAnnotation>> {
    const response = await this.client.post<ApiResponse<QualityAnnotation>>(
      `/api/annotation/news/${newsId}/annotate`,
      annotation
    );
    return response.data;
  }

  /**
   * 快速标注（点赞/点踩）
   */
  async quickAnnotate(
    newsId: number,
    action: 'like' | 'dislike'
  ): Promise<ApiResponse<QualityAnnotation>> {
    const response = await this.client.post<ApiResponse<QualityAnnotation>>(
      `/api/annotation/news/${newsId}/quick`,
      { action }
    );
    return response.data;
  }

  /**
   * 更新标注
   */
  async updateAnnotation(
    annotationId: number,
    updates: Partial<QualityAnnotation>
  ): Promise<ApiResponse<QualityAnnotation>> {
    const response = await this.client.put<ApiResponse<QualityAnnotation>>(
      `/api/annotation/annotations/${annotationId}`,
      updates
    );
    return response.data;
  }

  /**
   * 删除标注
   */
  async deleteAnnotation(annotationId: number): Promise<ApiResponse<void>> {
    const response = await this.client.delete<ApiResponse<void>>(
      `/api/annotation/annotations/${annotationId}`
    );
    return response.data;
  }

  /**
   * 获取标注统计
   */
  async getStatistics(): Promise<ApiResponse<AnnotationStatistics>> {
    const response = await this.client.get<ApiResponse<AnnotationStatistics>>(
      '/api/annotation/statistics'
    );
    return response.data;
  }

  /**
   * 导出训练样本
   */
  async exportSamples(params?: {
    minScore?: number;
    maxScore?: number;
    limit?: number;
  }): Promise<any[]> {
    const response = await this.client.get<any[]>(
      '/api/annotation/samples/export',
      { params }
    );
    return response.data;
  }

  /**
   * 从RSS导入新闻
   */
  async importFromRSS(request: ImportRSSRequest): Promise<ApiResponse<{
    importedCount: number;
    requestedCount: number;
    errors?: string[];
  }>> {
    const response = await this.client.post<ApiResponse<{
      importedCount: number;
      requestedCount: number;
      errors?: string[];
    }>>('/api/annotation/news/import/rss', request);
    return response.data;
  }

  /**
   * 获取人工评审主体（轻量、fingerprint 稳定主体、cursor 分页）。
   * 列表不携带 raw/processed 大 JSON；详情按 id 懒加载。
   */
  async getReviewSubjects(params?: {
    limit?: number;
    offset?: number;
    cursor?: string;
    search?: string;
  }): Promise<ApiResponse<any[]>> {
    const response = await this.client.get<ApiResponse<any[]>>(
      '/api/review/subjects',
      { params }
    );
    return response.data;
  }

  async getReviewStatistics(): Promise<ApiResponse<AnnotationStatistics>> {
    const response = await this.client.get<ApiResponse<AnnotationStatistics>>('/api/review/statistics');
    return response.data;
  }

  /**
   * 获取推送历史（Scheduler 等旧页面仍使用 delivery history）。
   */
  async getPushHistory(params?: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<ApiResponse<any[]>> {
    const response = await this.client.get<ApiResponse<any[]>>(
      '/api/scheduler/push-history',
      { params }
    );
    return response.data;
  }

  /**
   * 获取推送详情
   */
  async getPushDetail(id: number): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(
      `/api/scheduler/push-history/${id}`
    );
    return response.data;
  }

  /**
   * 重新推送
   */
  async resendPush(
    id: number,
    renderer: 'device' | 'local-eink' | 'both' = 'device',
    deviceIds?: string[]
  ): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(
      `/api/scheduler/push-history/${id}/resend`,
      { renderer, ...(deviceIds ? { deviceIds } : {}) }
    );
    return response.data;
  }

  /**
   * 获取调度器任务列表
   */
  async getSchedulerJobs(): Promise<ApiResponse<any[]>> {
    const response = await this.client.get<ApiResponse<any[]>>('/api/scheduler/jobs');
    return response.data;
  }

  /**
   * 触发调度任务
   */
  async triggerSchedulerJob(jobId: string, index?: number): Promise<ApiResponse<void>> {
    const response = await this.client.post<ApiResponse<void>>(
      `/api/scheduler/jobs/${jobId}/trigger`,
      index !== undefined ? { index } : {}
    );
    return response.data;
  }

  /**
   * 启用/禁用调度任务
   */
  async toggleSchedulerJob(jobId: string, enabled: boolean): Promise<ApiResponse<void>> {
    const response = await this.client.patch<ApiResponse<void>>(
      `/api/scheduler/jobs/${jobId}/enabled`,
      { enabled }
    );
    return response.data;
  }

  /**
   * 局部更新调度任务（PATCH 语义，未传字段保留原值）
   */
  async patchSchedulerJob(jobId: string, updates: Partial<any>): Promise<ApiResponse<any>> {
    const response = await this.client.patch<ApiResponse<any>>(
      `/api/scheduler/jobs/${jobId}`,
      updates
    );
    return response.data;
  }

  /**
   * 创建调度任务
   */
  async createSchedulerJob(body: any): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(
      '/api/news/scheduler/jobs',
      body
    );
    return response.data;
  }

  /**
   * 删除调度任务
   */
  async deleteSchedulerJob(jobId: string): Promise<ApiResponse<void>> {
    const response = await this.client.delete<ApiResponse<void>>(
      `/api/news/scheduler/jobs/${jobId}`
    );
    return response.data;
  }

  /**
   * 重新加载调度器配置
   */
  async reloadScheduler(): Promise<ApiResponse<void>> {
    const response = await this.client.post<ApiResponse<void>>('/api/scheduler/reload');
    return response.data;
  }

  /**
   * 批量标注
   */
  async batchAnnotate(
    annotations: Omit<QualityAnnotation, 'id'>[]
  ): Promise<ApiResponse<QualityAnnotation[]>> {
    const response = await this.client.post<ApiResponse<QualityAnnotation[]>>(
      '/api/annotation/batch',
      annotations
    );
    return response.data;
  }
}

export const apiClient = new AnnotationApiClient();
