/**
 * 通用小组件插件系统接口定义
 * 支持可扩展的组件类型和数据源
 */

import { ReactElement } from 'react';

/**
 * CLI选项定义
 */
export interface CliOption {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: any;
  choices?: string[];
  validator?: (value: any) => boolean;
}

/**
 * 组件通用属性接口
 */
export interface WidgetProps<TData = any> {
  data: TData;
  config?: WidgetConfig;
}

/**
 * 组件配置接口
 */
export interface WidgetConfig {
  width?: number;
  height?: number;
  theme?: 'light' | 'dark' | 'eink';
  fontSize?: 'small' | 'medium' | 'large';
  border?: '0' | '1';
  [key: string]: any; // 允许插件特定配置
}

/**
 * 数据提供者接口
 */
export interface WidgetDataProvider<TData = any> {
  /** 获取支持的数据源列表 */
  getSources(): string[];
  
  /** 获取默认数据源 */
  getDefaultSource(): string;
  
  /** 获取数据 */
  getData(source: string, params: WidgetDataParams): Promise<TData>;
  
  /** 验证参数 */
  validateParams(params: WidgetDataParams): boolean;
  
  /** 获取数据源描述 */
  getSourceDescription(source: string): string;
}

/**
 * 数据获取参数
 */
export interface WidgetDataParams {
  [key: string]: any;
}

/**
 * 插件元数据
 */
export interface WidgetPluginMeta {
  type: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
}

/**
 * 通用小组件插件接口
 */
export interface WidgetPlugin<TData = any, TConfig extends WidgetConfig = WidgetConfig> {
  /** 插件元数据 */
  meta: WidgetPluginMeta;
  
  /** 数据提供者 */
  dataProvider: WidgetDataProvider<TData>;
  
  /** React组件 */
  component: React.ComponentType<WidgetProps<TData>>;
  
  /** CLI参数定义 */
  getCliOptions(): CliOption[];
  
  /** 配置验证 */
  validateConfig(config: TConfig): boolean;
  
  /** 参数解析器 - 将CLI参数转换为数据获取参数 */
  parseCliArgs(args: string[]): { params: WidgetDataParams; config: TConfig };
  
  /** 使用说明生成器 */
  getUsageHelp(): string;
  
  /** 示例命令生成器 */
  getExampleCommands(): string[];
}

/**
 * 插件注册表接口
 */
export interface WidgetPluginRegistry {
  /** 注册插件 */
  register(plugin: WidgetPlugin): void;
  
  /** 获取插件 */
  get(type: string): WidgetPlugin | undefined;
  
  /** 获取所有插件 */
  getAll(): WidgetPlugin[];
  
  /** 检查插件是否存在 */
  has(type: string): boolean;
  
  /** 获取插件列表 */
  getTypes(): string[];
}

/**
 * 通用CLI执行上下文
 */
export interface WidgetExecutionContext {
  widgetType: string;
  args: string[];
  outputDir: string;
  timestamp: number;
}

/**
 * 通用CLI执行结果
 */
export interface WidgetExecutionResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  data?: any;
  metadata?: {
    executionTime: number;
    dataSource: string;
    [key: string]: any;
  };
}