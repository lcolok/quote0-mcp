export interface NewsProcessRequest {
  category?: string;
  dataSource?: string;
  rssSource?: string;
  processor?: string;
  index?: number;
  renderer?: string;
  mockData?: {
    title: string;
    content: string;
    link: string;
    source: string;
  };
  options?: {
    force?: boolean;
    border?: '0' | '1';
    width?: number;
    height?: number;
  };
  context?: NewsPushContext;
}

export interface NewsProcessResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    processingTime: number;
    workflow: string;
    nodeTimings: Record<string, number>;
    cache?: {
      hit: boolean;
      source: string;
      key: string;
    };
    context?: NewsPushContext;
  };
}

export interface NewsProcessingParams {
  category: string;
  dataSource: string;
  processor: string;
  renderer: string;
  index: number;
  rssSource: string;
  force: boolean;
}

export interface NewsProcessingConfig {
  border: '0' | '1';
  width: number;
  height: number;
}

export interface NewsProcessingResult {
  result: any;
  cacheHit: boolean;
  cacheSource: string;
  cacheKey: string;
  processingTime: number;
  workflow: string;
}

export interface FullNewsProcessingResult extends NewsProcessingResult {
  params: NewsProcessingParams;
  config: NewsProcessingConfig;
  context?: NewsPushContext;
  cacheKeyObject: Record<string, any>;
}

export interface SchedulerIndexStrategy {
  type?: 'fair-rotation';
  poolSize?: number; // -1 表示动态获取RSS源的实际条目数量 | -1 means dynamically fetch actual RSS feed item count
  startIndex?: number;
  cooldownHours?: number; // 冷却时间（小时），该时间内不重复推送同一新闻，默认24小时
  maxPushCount?: number; // 单条新闻最多推送次数，默认5次
  rotateAfterEachPush?: boolean; // 每次推送后是否切换RSS源，默认true
  skipEmptySource?: boolean; // 无可推送内容时跳过该源，默认true
}

export interface NewsSchedulerJobConfig {
  id: string;
  enabled?: boolean;
  name?: string;
  category?: string;
  dataSource?: string;
  rssSource?: string; // 单个RSS源（传统模式）
  rssSources?: string[]; // 多个RSS源轮换（新模式）| Multiple RSS sources for rotation (new mode)
  processor?: string;
  renderer?: string;
  intervalMs?: number;
  intervalMinutes?: number;
  initialDelayMs?: number;
  initialDelayMinutes?: number;
  options?: NewsProcessRequest['options'];
  indexStrategy?: SchedulerIndexStrategy;
  description?: string;
}

export interface NewsPushContext {
  fingerprint?: string;
  title?: string;
  link?: string;
  publishTime?: string;
  source?: string;
  category?: string;
  rawIndex?: number;
  content?: string;  // 原始RSS正文内容
  description?: string;  // RSS的description字段
}

export interface NewsSchedulerJobRecord {
  id: string;
  name?: string;
  description?: string;
  category: string;
  dataSource: string;
  rssSource?: string; // 单个RSS源（向后兼容）
  rssSources?: string[]; // 多个RSS源轮换 | Multiple RSS sources for rotation
  disabledSources?: string[]; // 禁用的RSS源列表 | Disabled RSS sources list
  currentSourceIndex?: number; // 当前使用的RSS源索引（多源轮换）
  processor: string;
  renderer: string;
  intervalMs: number;
  initialDelayMs: number;
  options: NewsProcessRequest['options'];
  indexStrategy: RequiredSchedulerIndexStrategy;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  state?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface RequiredSchedulerIndexStrategy {
  type: 'fair-rotation';
  poolSize: number;
  startIndex: number;
  cooldownHours: number;
  maxPushCount: number;
  rotateAfterEachPush: boolean;
  skipEmptySource: boolean;
}

export interface NewsPushHistoryRecord {
  fingerprint: string;
  title?: string;
  link?: string;
  source?: string;
  category?: string;
  pushCount: number;
  lastPushedAt?: string;
  metadata?: Record<string, any>;
}

export interface NewsPushLogEntry {
  id: number;
  jobId: string;
  fingerprint: string;
  pushedAt: string;
  result?: Record<string, any>;
  title?: string;
  link?: string;
  source?: string;
  category?: string;
  layer?: string;
  isFallback?: boolean | null;
  strategySnapshot?: Record<string, any> | null;
}
