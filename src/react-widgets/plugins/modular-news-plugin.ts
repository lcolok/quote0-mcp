/**
 * 模块化新闻插件 - 使用工作流架构
 * 演示三层模块化设计：数据源 -> 处理 -> 渲染
 */

import { 
  WidgetPlugin, 
  CliOption, 
  WidgetConfig, 
  WidgetDataParams 
} from './widget-plugin.js';

import { workflowEngine } from '../core/workflow-engine.js';
import { dataSourceRegistry } from '../core/data-source-modules.js';
import { processingRegistry } from '../core/processing-modules.js';
import { renderingRegistry } from '../core/rendering-modules.js';
import { EnvLoader } from '../../image-sender/adapters/environments/env-loader.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from '../core/device-constants.js';

/**
 * 模块化新闻插件参数接口
 */
interface ModularNewsParams extends WidgetDataParams {
  category?: string;
  index?: number;
  dataSource?: string;
  processor?: string;
  renderer?: string;
  force?: boolean;
  rssSource?: string; // 新增: RSS源选择参数
  border?: string; // 边框设置
}

/**
 * 模块化新闻插件配置接口
 */
interface ModularNewsConfig extends WidgetConfig {
  border?: '0' | '1';
  width?: number;
  height?: number;
}

/**
 * 模块化新闻插件实现
 */
export class ModularNewsPlugin implements WidgetPlugin<string, ModularNewsConfig> {
  meta = {
    type: 'modular-news',
    name: '模块化新闻组件',
    description: '基于工作流的模块化新闻处理系统，支持灵活的数据源、处理器和渲染器组合',
    version: '2.0.0',
    author: 'MindReset Team',
    homepage: 'https://github.com/anthropics/claude-code'
  };

  constructor() {
    // 确保环境变量已加载
    EnvLoader.load();
  }

  /**
   * 获取数据 - 使用工作流引擎处理
   */
  async getData(params: ModularNewsParams): Promise<string> {
    console.log('🚀 启动模块化新闻处理工作流...');
    
    // 解析参数
    const dataSource = params.dataSource || 'mock';
    const processor = params.processor || 'passthrough';
    const renderer = params.renderer || 'news';
    const category = params.category || 'technology';
    const index = params.index || 0;
    
    console.log(`📋 工作流配置: ${dataSource} -> ${processor} -> ${renderer}`);
    
    try {
      // 创建工作流
      const workflow = workflowEngine.createNewsWorkflow({
        dataSource: dataSource,
        dataSourceParams: {
          category: category,
          startIndex: index,
          count: 1,
          source: params.rssSource || 'solidot' // 使用RSS源选择参数
        },
        processor: processor,
        processingParams: {
          maxTitleLength: 20,
          maxContentLength: 150,
          temperature: 0.3
        },
        renderer: renderer,
        renderingParams: {
          signatureStyle: 'auto'
        },
        renderingConfig: {
          border: params.border || '0',
          // 设备真实分辨率 296×152（v1.0.22 起 widget 统一按此渲染）
          width: EINK_DEVICE_WIDTH,
          height: EINK_DEVICE_HEIGHT
        }
      });
      
      // 执行工作流
      const result = await workflowEngine.executeWorkflow(workflow);
      
      if (result.status === 'success') {
        console.log(`✅ 模块化新闻处理完成，总耗时: ${result.metrics.totalDuration}ms`);
        console.log(`📊 节点耗时分布:`, result.metrics.nodesDuration);
        
        return result.result;
      } else {
        throw new Error(result.error || '工作流执行失败');
      }
      
    } catch (error) {
      console.error('❌ 模块化新闻处理失败:', error);
      throw new Error(`模块化新闻处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 验证参数
   */
  validateParams(params: ModularNewsParams): boolean {
    // 验证数据源
    if (params.dataSource && !dataSourceRegistry.get(params.dataSource)) {
      console.error(`不支持的数据源: ${params.dataSource}`);
      return false;
    }
    
    // 验证处理器
    if (params.processor && !processingRegistry.get(params.processor)) {
      console.error(`不支持的处理器: ${params.processor}`);
      return false;
    }
    
    // 验证渲染器
    if (params.renderer && !renderingRegistry.get(params.renderer)) {
      console.error(`不支持的渲染器: ${params.renderer}`);
      return false;
    }
    
    return true;
  }

  /**
   * 获取CLI选项
   */
  getCliOptions(): CliOption[] {
    return [
      {
        name: 'category',
        description: '新闻分类: technology, finance, sports',
        required: false,
        defaultValue: 'technology',
        choices: ['technology', 'finance', 'sports']
      },
      {
        name: 'dataSource',
        description: '数据源模块',
        required: false,
        defaultValue: 'mock',
        choices: dataSourceRegistry.getAvailable()
      },
      {
        name: 'processor',
        description: '处理器模块',
        required: false,
        defaultValue: 'passthrough',
        choices: processingRegistry.getAvailable()
      },
      {
        name: 'renderer',
        description: '渲染器模块',
        required: false,
        defaultValue: 'news',
        choices: renderingRegistry.getAvailable()
      },
      {
        name: 'border',
        description: '边框颜色: 0=白色, 1=黑色',
        required: false,
        defaultValue: '0',
        choices: ['0', '1']
      }
    ];
  }

  /**
   * 验证配置
   */
  validateConfig(config: ModularNewsConfig): boolean {
    if (config.border && !['0', '1'].includes(config.border)) {
      return false;
    }
    return true;
  }

  /**
   * 解析CLI参数
   */
  parseCliArgs(args: string[]): { params: ModularNewsParams; config: ModularNewsConfig } {
    // 处理特殊参数
    const force = args.includes('--force');
    const filteredArgs = args.filter(arg => arg !== '--force');

    const category = filteredArgs[0] || 'technology';
    const dataSource = filteredArgs[1] || 'mock';
    const processor = filteredArgs[2] || 'passthrough';
    const index = filteredArgs[3] ? parseInt(filteredArgs[3], 10) : 0;
    let renderer = filteredArgs[4] || 'news';
    const rssSource = filteredArgs[5] || 'solidot'; // 新增：RSS源选择参数
    
    // 如果没有显式指定渲染器，且是完整的数据源+处理器组合，默认使用设备推送
    if (!filteredArgs[4] && dataSource !== 'mock' && processor !== 'passthrough') {
      renderer = 'device'; // 默认推送到设备
    }

    // 验证分类
    const validCategories = ['technology', 'finance', 'sports'];
    if (!validCategories.includes(category)) {
      throw new Error(`不支持的新闻分类: ${category}。支持的分类: ${validCategories.join(', ')}`);
    }
    
    // 验证RSS源（仅当使用RSS数据源时）
    if (dataSource === 'rss') {
      const rssModule = dataSourceRegistry.get('rss');
      if (rssModule) {
        const rssSourceParam = rssModule.getSupportedParams().find(p => p.name === 'source');
        if (rssSourceParam?.choices && !rssSourceParam.choices.includes(rssSource)) {
          throw new Error(`不支持的RSS源: ${rssSource}。支持的RSS源: ${rssSourceParam.choices.join(', ')}`);
        }
      }
    }

    console.log(`📋 模块化参数解析: category=${category}, dataSource=${dataSource}, processor=${processor}, renderer=${renderer}, index=${index}, rssSource=${rssSource}, force=${force}`);

    return {
      params: { 
        category, 
        dataSource,
        processor,
        renderer,
        index: isNaN(index) ? 0 : index,
        rssSource,
        force 
      },
      config: {
        border: '0',
        width: EINK_DEVICE_WIDTH,
        height: EINK_DEVICE_HEIGHT
      }
    };
  }

  /**
   * 获取使用帮助
   */
  getUsageHelp(): string {
    return `🧩 模块化新闻组件使用说明

🚀 用法: npm run widget:modular-news [分类] [数据源] [处理器] [索引] [渲染器] [RSS源] [选项]

📝 参数说明:
  分类: technology, finance, sports (默认: technology)
  数据源: ${dataSourceRegistry.getAvailable().join(', ')} (默认: mock)
  处理器: ${processingRegistry.getAvailable().join(', ')} (默认: passthrough)
  索引: 新闻条目索引，从0开始 (默认: 0)
  渲染器: ${renderingRegistry.getAvailable().join(', ')} (默认: news)
  RSS源: 当数据源为rss时的RSS订阅源选择 (默认: solidot)
         可用RSS源: ${(() => {
           const rssModule = dataSourceRegistry.get('rss');
           const sourceParam = rssModule?.getSupportedParams().find(p => p.name === 'source');
           return sourceParam?.choices?.join(', ') || 'solidot, sspai, cnbeta, 36kr, pingwest, techcrunch, arstechnica, reuters-tech, designer-news, github-trending, dev-to';
         })()}
  
🔧 选项:
  --force  强制刷新，跳过缓存

🏗️ 模块详情:

📡 数据源模块:
${dataSourceRegistry.getAvailable().map(name => {
  const module = dataSourceRegistry.get(name);
  return `  • ${name.padEnd(12)} - ${module?.description || '未知'}`;
}).join('\\n')}

🤖 处理器模块:
${processingRegistry.getAvailable().map(name => {
  const module = processingRegistry.get(name);
  return `  • ${name.padEnd(12)} - ${module?.description || '未知'}`;
}).join('\\n')}

🎨 渲染器模块:
${renderingRegistry.getAvailable().map(name => {
  const module = renderingRegistry.get(name);
  return `  • ${name.padEnd(12)} - ${module?.description || '未知'}`;
}).join('\\n')}

💡 示例命令:
${this.getExampleCommands().map(cmd => `  ${cmd}`).join('\\n')}

🔬 特性:
  ✅ 完全模块化架构，支持任意组合
  ✅ 工作流引擎自动串联模块
  ✅ 每个模块独立可替换
  ✅ 详细的执行指标和日志
  ✅ 支持健康检查和状态监控
  ✅ 灵活的参数配置和验证`;
  }

  /**
   * 获取示例命令
   */
  getExampleCommands(): string[] {
    return [
      'npm run widget:modular-news',
      'npm run widget:modular-news technology mock passthrough 0 json',
      'npm run widget:modular-news technology rss passthrough 0 device',
      'npm run widget:modular-news technology rss ax-optimized 7 device sspai',
      'npm run widget:modular-news finance rss basic-llm 1 device 36kr',
      'npm run widget:modular-news technology mock ax-optimized 0 device solidot --force'
    ];
  }

  /**
   * 获取模块健康状态
   */
  async getModuleHealthStatus(): Promise<{
    dataSources: Record<string, any>;
    processors: Record<string, any>;
    renderers: Record<string, any>;
  }> {
    const [dataSources, processors, renderers] = await Promise.all([
      dataSourceRegistry.getAllModulesStatus(),
      processingRegistry.getAllModulesStatus(),
      renderingRegistry.getAllModulesStatus()
    ]);

    return { dataSources, processors, renderers };
  }
}

// 导出插件实例
export const modularNewsPlugin = new ModularNewsPlugin();