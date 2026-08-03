/**
 * 模块化架构设计 - 核心接口定义
 * 将系统分解为三个独立模块：数据源、LLM处理、组件渲染
 */

/**
 * 原始数据接口 - 来自数据源模块的输出
 */
export interface RawDataItem {
  id: string;
  title: string;
  content: string;
  source: string;
  publishTime: string;
  link?: string;
  category?: string;
  metadata?: Record<string, any>;
}

/**
 * 处理后数据接口 - 来自LLM处理模块的输出
 */
export interface ProcessedDataItem {
  id: string;
  originalTitle: string;
  optimizedTitle: string;
  originalContent: string;
  processedContent: string;
  summary?: string;
  keywords?: string[];
  highlights?: string[];
  qualityScore?: number;
  processingMetadata: {
    processor: string;
    model: string;
    /** fallback 链实际命中并成功的 provider slug（active 解析为真实 slug）；供观测哪一跳在干活 */
    llm_provider?: string;
    /** fallback 链实际命中并成功的 model id */
    llm_model?: string;
    processedAt: string;
    processingTime: number;
    confidence?: number;
  };
  rawData: RawDataItem;
}

/**
 * 渲染数据接口 - 传递给组件渲染模块的数据
 */
export interface RenderableDataItem {
  id: string;
  title: string;
  message: string;
  signature: string;
  source: string;
  publishTime: string;
  category: string;
  link?: string;
  highlights?: string[];
  metadata?: Record<string, any>;
  index?: number;
}

/**
 * 数据源模块接口
 */
export interface DataSourceModule {
  name: string;
  version: string;
  description: string;
  
  /**
   * 获取原始数据
   */
  fetchRawData(params: DataSourceParams): Promise<RawDataItem[]>;
  
  /**
   * 获取数据源支持的参数类型
   */
  getSupportedParams(): DataSourceParamDefinition[];
  
  /**
   * 验证参数
   */
  validateParams(params: DataSourceParams): boolean;
  
  /**
   * 获取数据源健康状态
   */
  getHealthStatus(): Promise<DataSourceHealthStatus>;
}

/**
 * LLM处理模块接口
 */
export interface ProcessingModule {
  name: string;
  version: string;
  description: string;
  
  /**
   * 处理原始数据
   */
  processData(rawData: RawDataItem, params: ProcessingParams): Promise<ProcessedDataItem>;
  
  /**
   * 批量处理数据
   */
  batchProcessData(rawDataList: RawDataItem[], params: ProcessingParams): Promise<ProcessedDataItem[]>;
  
  /**
   * 获取处理器支持的参数
   */
  getSupportedParams(): ProcessingParamDefinition[];
  
  /**
   * 验证参数
   */
  validateParams(params: ProcessingParams): boolean;
  
  /**
   * 获取处理器健康状态
   */
  getHealthStatus(): Promise<ProcessingHealthStatus>;
}

/**
 * 组件渲染模块接口
 */
export interface RenderingModule<T = any> {
  name: string;
  version: string;
  description: string;
  
  /**
   * 将处理后数据转换为渲染数据
   */
  transformToRenderable(processedData: ProcessedDataItem, params: RenderingParams): RenderableDataItem;
  
  /**
   * 渲染组件
   */
  render(data: RenderableDataItem, config: RenderingConfig): Promise<T>;
  
  /**
   * 获取渲染器支持的参数
   */
  getSupportedParams(): RenderingParamDefinition[];
  
  /**
   * 验证参数
   */
  validateParams(params: RenderingParams): boolean;
  
  /**
   * 获取渲染器健康状态
   */
  getHealthStatus(): Promise<RenderingHealthStatus>;
}

/**
 * 参数定义接口
 */
export interface ParamDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  defaultValue?: any;
  description: string;
  choices?: any[];
  validation?: (value: any) => boolean;
}

export interface DataSourceParamDefinition extends ParamDefinition {}
export interface ProcessingParamDefinition extends ParamDefinition {}
export interface RenderingParamDefinition extends ParamDefinition {}

/**
 * 参数接口
 */
export interface DataSourceParams {
  [key: string]: any;
}

export interface ProcessingParams {
  [key: string]: any;
}

export interface RenderingParams {
  [key: string]: any;
}

export interface RenderingConfig {
  [key: string]: any;
}

/**
 * 健康状态接口
 */
export interface HealthStatus {
  healthy: boolean;
  message: string;
  lastChecked: string;
  responseTime?: number;
  additionalInfo?: Record<string, any>;
}

export interface DataSourceHealthStatus extends HealthStatus {
  dataAvailability?: boolean;
  connectionStatus?: 'connected' | 'disconnected' | 'error';
  dataQuality?: number;
}

export interface ProcessingHealthStatus extends HealthStatus {
  modelStatus?: 'ready' | 'loading' | 'error';
  queueLength?: number;
}

export interface RenderingHealthStatus extends HealthStatus {
  renderingCapacity?: number;
  fontStatus?: 'loaded' | 'loading' | 'error';
}

/**
 * 工作流节点接口
 */
export interface WorkflowNode {
  id: string;
  name: string;
  type: 'datasource' | 'processing' | 'rendering';
  module: DataSourceModule | ProcessingModule | RenderingModule;
  params: DataSourceParams | ProcessingParams | RenderingParams;
  config?: Record<string, any>;
}

/**
 * 工作流连接接口
 */
export interface WorkflowConnection {
  from: string; // 源节点ID
  to: string;   // 目标节点ID
  dataTransform?: (data: any) => any; // 可选的数据转换函数
}

/**
 * 工作流定义接口
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  metadata?: Record<string, any>;
}

/**
 * 工作流执行结果接口
 */
export interface WorkflowExecutionResult {
  workflowId: string;
  executionId: string;
  startTime: string;
  endTime: string;
  status: 'success' | 'error' | 'partial';
  result: any;
  error?: string;
  nodeResults: Record<string, any>; // 每个节点的执行结果
  metrics: {
    totalDuration: number;
    nodesDuration: Record<string, number>;
    cacheHits?: number;
    cacheMisses?: number;
  };
}