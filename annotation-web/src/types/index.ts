// 新闻原始数据类型
export interface NewsRawData {
  id: number;
  title: string;
  source: string;
  description?: string;
  link?: string;
  publish_time?: string;
  data_source: string;
  category?: string;
  rss_index?: number;
  image_path?: string; // 推送预览图路径
  annotation_status: 'pending' | 'annotating' | 'completed' | 'skipped';
  created_at: string;
  updated_at: string;
  raw_content?: any; // 原始RSS数据
  processed_content?: any; // AX优化后的数据
}

// 质量维度
export interface QualityDimensions {
  newsValue?: number;
  practicality?: number;
  density?: number;
  timeliness?: number;
  universality?: number;
}

// 质量标注
export interface QualityAnnotation {
  id?: number;
  news_id: number;
  overall_score: number;
  category: 'high' | 'medium' | 'low';
  should_filter: boolean;
  news_value?: number;
  practicality?: number;
  density?: number;
  timeliness?: number;
  universality?: number;
  reason: string;
  tags?: string[];
  annotator?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  confidence?: number;
  version?: number;
  is_latest?: boolean;
  created_at?: string;
  updated_at?: string;

  // 新增：优化后的内容（用于训练）
  optimized_title?: string;      // 优化后的标题
  optimized_summary?: string;    // 优化后的摘要
  optimized_content?: string;    // 优化后的正文（可选）
}

// 新闻详情（含标注）
export interface NewsWithAnnotation {
  news: NewsRawData;
  annotation: QualityAnnotation | null;
}

// 分页信息
export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// API响应
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: Pagination;
}

// 标注统计
export interface AnnotationProgress {
  total_count: number;
  pending_count: number;
  completed_count: number;
  completion_rate: number;
  high_quality_count: number;
  medium_quality_count: number;
  low_quality_count: number;
}

export interface QualityDistribution {
  quality_level: 'high' | 'medium' | 'low';
  count: number;
  avg_score: number;
  min_score: number;
  max_score: number;
}

export interface CategoryStatistics {
  total_news: number;
  pending_count: number;
  completed_count: number;
  skipped_count: number;
  data_source: string;
  category: string;
}

export interface AnnotationStatistics {
  progress: AnnotationProgress;
  qualityDistribution: QualityDistribution[];
  categoryStatistics: CategoryStatistics[];
}

// RSS导入请求
export interface ImportRSSRequest {
  category: string;
  rssSource: string;
  count?: number;
  startIndex?: number;
}

// 训练样本导出
export interface TrainingSample {
  id: number;
  input: {
    title: string;
    source: string;
    description?: string;
    content?: string;  // 原始正文
  };
  output: {
    score: number;
    category: 'high' | 'medium' | 'low';
    shouldFilter: boolean;
    reason: string;
    dimensions: QualityDimensions;
    tags: string[];

    // 新增：优化后的内容（AX训练目标）
    optimizedTitle?: string;     // 优化后的标题
    optimizedSummary?: string;   // 优化后的摘要
    optimizedContent?: string;   // 优化后的正文
  };
  metadata: {
    annotator: string;
    annotatedAt: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    confidence?: number;
  };
}

export interface TrainingDataExport {
  version: string;
  createdAt: string;
  samples: TrainingSample[];
}
