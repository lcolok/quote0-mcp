export interface NewsProcessRequest {
  category?: string;
  dataSource?: string;
  rssSource?: string;
  processor?: string;
  index?: number;
  renderer?: string;
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
  type?: 'sequential' | 'shuffle' | 'random';
  poolSize?: number;
  startIndex?: number;
}

export interface NewsSchedulerJobConfig {
  id: string;
  enabled?: boolean;
  name?: string;
  category?: string;
  dataSource?: string;
  rssSource?: string;
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
}

export interface NewsSchedulerJobRecord {
  id: string;
  name?: string;
  description?: string;
  category: string;
  dataSource: string;
  rssSource: string;
  processor: string;
  renderer: string;
  intervalMs: number;
  initialDelayMs: number;
  options: NewsProcessRequest['options'];
  indexStrategy: RequiredSchedulerIndexStrategy;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RequiredSchedulerIndexStrategy {
  type: 'sequential' | 'shuffle' | 'random';
  poolSize: number;
  startIndex: number;
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
}
