/**
 * 新闻组件插件实现
 * 演示框架的通用性和可扩展性
 */

import React from 'react';
import { 
  WidgetPlugin, 
  WidgetDataProvider, 
  CliOption, 
  WidgetConfig, 
  WidgetDataParams 
} from '../core/widget-plugin.js';
import { NewsWidget, NewsData } from '../components/NewsWidget.js';
import Parser from 'rss-parser';
import { CachedLLMService, LLMConfig, ContentProcessingOptions } from '../services/llm-content-processor.js';
import { LLMWorkflowEngine, EnhancedContent } from '../services/llm-workflow-engine.js';
import { AxNewsProcessor } from '../services/ax-news-processor.js';
import { AxInspiredNewsProcessor } from '../services/ax-inspired-processor.js';
import { EnvLoader } from '../../image-sender/adapters/environments/env-loader.js';
import { getActiveLLMConfig, getFallbackLLMConfig } from '../core/llm-config.js';
import { getPostgresDatabase } from '../core/postgres-database.js';
import { stagedCacheManager } from '../core/staged-cache-manager.js';
import { dataSourceRegistry } from '../core/data-source-modules.js';

/**
 * 新闻数据参数接口
 */
interface NewsDataParams extends WidgetDataParams {
  query?: string;
  category?: string;
  source?: string;
  count?: number;
  index?: number; // RSS新闻索引
  force?: boolean; // 强制刷新，跳过缓存
}

/**
 * 新闻组件配置接口
 */
interface NewsConfig extends WidgetConfig {
  border?: '0' | '1';
}

/**
 * 模拟新闻数据
 */
const mockNewsData: Record<string, NewsData> = {
  technology: {
    title: '3D打印树脂有毒性风险',
    message: '光敏树脂加热与固化会释放挥发性有机物和刺激性气体，部分材料有皮肤刺激甚至致敏可能，建议佩戴手套、加强通风打印后彻底固化和清洗成品可降低健康风险',
    signature: '合理防护可大幅降低危害',
    source: '3D打印安全研究',
    publishTime: new Date().toISOString(),
    category: '科技'
  },
  finance: {
    title: '央行数字货币全国试点',
    message: '人民银行宣布数字人民币试点范围从26个城市扩展至全国所有地级市，支持线上线下全场景支付，与支付宝微信并存互补，推动金融基础设施现代化建设',
    signature: '数字化支付新时代到来',
    source: '中国人民银行',
    publishTime: new Date().toISOString(),
    category: '财经'
  },
  sports: {
    title: '中国男篮战胜澳大利亚',
    message: '中国男篮在世界杯亚太区预选赛中以87-81战胜强敌澳大利亚队，这场胜利让中国队在积分榜上占据有利位置，有望直接晋级2024年巴黎奥运会篮球比赛',
    signature: '团结拼搏铸就辉煌',
    source: '中国篮协',
    publishTime: new Date().toISOString(),
    category: '体育'
  }
};

/**
 * 新闻数据提供者实现
 */
class NewsDataProvider implements WidgetDataProvider<NewsData> {
  private llmService: CachedLLMService;
  private workflowEngine: LLMWorkflowEngine;

  constructor() {
    // 确保环境变量已加载
    EnvLoader.load();
    
    // 从环境变量读取LLM配置（同步 fallback）
    const fallback = getFallbackLLMConfig();
    const llmConfig: LLMConfig = {
      provider: (process.env.LLM_PROVIDER as any) || 'mock',
      apiKey: fallback.apiKey,
      baseURL: fallback.baseUrl,
      model: fallback.model,
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '1000'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7')
    };
    
    console.log(`🔧 LLM配置: ${llmConfig.provider}/${llmConfig.model} @ ${llmConfig.baseURL}`);
    this.llmService = new CachedLLMService(llmConfig);
    this.workflowEngine = new LLMWorkflowEngine();
    
  }

  getSources(): string[] {
    return ['mock', 'rss', 'rss-llm', 'rss-enhanced', 'rss-ax', 'rss-ax-inspired', 'ax-optimized', 'api'];
  }

  getDefaultSource(): string {
    return 'mock';
  }

  getSourceDescription(source: string): string {
    const descriptions: Record<string, string> = {
      mock: '📝 模拟数据 - 用于测试和演示的示例新闻',
      rss: '📡 RSS源 - 从RSS订阅获取新闻内容',
      'rss-llm': '🤖 AI优化RSS - 使用LLM智能处理和优化RSS新闻内容',
      'rss-enhanced': '✨ 增强工作流RSS - 多步骤AI处理，支持关键词高亮和严格约束',
      'rss-ax': '🔥 AX框架RSS - 基于AX框架的智能内容生成，支持XML结构化和迭代优化',
      'rss-ax-inspired': '⚡ AX风格RSS - 声明式工作流，智能迭代优化，支持自定义API',
      'ax-optimized': '🧠 AX完整优化 - 自动学习训练，few-shot优化，中间产物生成，生产级部署',
      api: '🌐 新闻API - 从第三方新闻服务获取实时新闻'
    };
    return descriptions[source] || '未知数据源';
  }

  async getData(source: string, params: NewsDataParams): Promise<NewsData> {
    // 检查是否是RSS源的直接名称（如sspai、solidot等）
    const rssModule = dataSourceRegistry.get('rss');
    if (rssModule) {
      const rssSourceParam = rssModule.getSupportedParams().find(p => p.name === 'source');
      console.log(`🔍 RSS支持的源:`, rssSourceParam?.choices);
      console.log(`🔍 请求的源: ${source}`);
      if (rssSourceParam?.choices?.includes(source)) {
        console.log(`✅ 使用RSS预设源: ${source}`);
        // 如果source是RSS预设源名称，使用RSS数据源处理
        return await this.getRSSData({ ...params, source });
      }
    }
    
    // 传统的数据源处理方式
    switch (source) {
      case 'mock':
        return this.getMockData(params);
      
      case 'rss':
        return await this.getRSSData(params);
      
      case 'rss-llm':
        return await this.getLLMProcessedRSSData(params);
      
      case 'rss-enhanced':
        return await this.getEnhancedRSSData(params);
      
      case 'rss-ax':
        return await this.getAxProcessedRSSData(params);
      
      case 'rss-ax-inspired':
        return await this.getAxInspiredRSSData(params);
      
      case 'ax-optimized':
        return await this.getAxOptimizedData(params);
      
      case 'api':
        return await this.getAPIData(params);
      
      default:
        const supportedSources = ['mock', 'rss', 'rss-llm', 'rss-enhanced', 'rss-ax', 'rss-ax-inspired', 'ax-optimized', 'api'];
        if (rssModule) {
          const rssSourceParam = rssModule.getSupportedParams().find(p => p.name === 'source');
          if (rssSourceParam?.choices) {
            supportedSources.push(...rssSourceParam.choices);
          }
        }
        throw new Error(`不支持的数据源: ${source}。支持的数据源: ${supportedSources.join(', ')}`);
    }
  }

  validateParams(params: NewsDataParams): boolean {
    // 新闻组件参数都是可选的
    return true;
  }

  private getMockData(params: NewsDataParams): NewsData {
    const { category = 'technology' } = params;
    
    const data = mockNewsData[category];
    if (!data) {
      // 如果没有找到指定分类，返回技术新闻
      return mockNewsData.technology;
    }
    
    return data;
  }

  private async getRSSData(params: NewsDataParams): Promise<NewsData> {
    try {
      // 使用模块化RSS数据源
      const rssModule = dataSourceRegistry.get('rss');
      if (!rssModule) {
        throw new Error('RSS数据源模块未找到');
      }

      // 获取RSS数据
      const rawDataItems = await rssModule.fetchRawData({
        source: params.source || 'solidot', // 默认使用solidot
        count: 1,
        startIndex: params.index || 0,
        category: params.category || 'technology'
      });

      if (!rawDataItems || rawDataItems.length === 0) {
        throw new Error('RSS数据源没有返回数据');
      }

      const item = rawDataItems[0];
      console.log(`📰 选择RSS新闻: ${item.title} (来源: ${item.source})`);
      
      // 限制标题长度为10个字符
      let title = item.title || '无标题';
      if (title.length > 10) {
        title = title.substring(0, 10);
      }
      
      if (item.link) {
        console.log(`🔗 原始新闻链接: ${item.link}`);
      }

      return {
        title: title,
        message: item.content || '暂无内容',
        signature: `来自${item.source}`,
        source: item.source,
        publishTime: item.publishTime,
        category: item.category || 'technology',
        link: item.link || undefined
      };
      
    } catch (error) {
      console.error('RSS数据获取失败:', error);
      throw new Error(`RSS数据获取失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private async getLLMProcessedRSSData(params: NewsDataParams): Promise<NewsData> {
    const parser = new Parser({
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsWidget/1.0)'
      }
    });

    try {
      // 获取RSS源数据
      const feed = await parser.parseURL('https://www.solidot.org/index.rss');
      
      if (!feed.items || feed.items.length === 0) {
        throw new Error('RSS源没有找到新闻条目');
      }

      // 选择新闻条目 - 支持指定索引，默认选择第一条
      let index = params.index !== undefined ? params.index : 0;
      // 确保索引在有效范围内
      index = Math.max(0, Math.min(index, feed.items.length - 1));
      
      const item = feed.items[index];
      console.log(`📰 选择第${index + 1}条新闻进行LLM处理: ${item.title}`);

      // 获取原始内容
      const originalTitle = item.title || '无标题';
      const originalContent = item.contentSnippet || item.content || item.description || '';

      // 通过LLM处理内容
      console.log(`🤖 开始LLM内容处理...`);
      const processingOptions: ContentProcessingOptions = {
        maxLength: 120,           // 适合水墨屏的长度
        style: 'concise',         // 简洁风格
        focus: 'summary',         // 重点摘要
        targetDevice: 'eink'      // 水墨屏设备
      };

      const processedContent = await this.llmService.processContent(
        originalTitle,
        originalContent,
        processingOptions
      );

      console.log(`✅ LLM处理完成: ${processedContent.title}`);

      return {
        title: processedContent.title,
        message: processedContent.summary,
        signature: `AI优化 · ${processedContent.model}`,
        source: 'Solidot AI',
        publishTime: item.pubDate || new Date().toISOString(),
        category: '科技',
        link: item.link || undefined
      };

    } catch (error) {
      console.error('LLM处理RSS失败:', error);
      throw new Error(`LLM处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private async getEnhancedRSSData(params: NewsDataParams): Promise<NewsData> {
    const parser = new Parser({
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsWidget/1.0)'
      }
    });

    try {
      console.log('🚀 启动增强工作流处理...');
      
      // 获取RSS源数据
      const feed = await parser.parseURL('https://www.solidot.org/index.rss');
      
      if (!feed.items || feed.items.length === 0) {
        throw new Error('RSS源没有找到新闻条目');
      }

      // 选择新闻条目 - 支持指定索引，默认选择第一条
      let index = params.index !== undefined ? params.index : 0;
      // 确保索引在有效范围内
      index = Math.max(0, Math.min(index, feed.items.length - 1));
      
      const item = feed.items[index];
      console.log(`📰 选择第${index + 1}条新闻进行增强工作流处理: ${item.title}`);

      // 获取原始内容
      const originalTitle = item.title || '无标题';
      const originalContent = item.contentSnippet || item.content || item.description || '';

      // 使用工作流引擎处理内容
      const processor = this.llmService.processor;
      const enhancedContent: EnhancedContent = await this.workflowEngine.executeWorkflow(
        processor,
        originalTitle,
        originalContent,
        {
          titleMaxLength: 20,    // 两行显示，支持更完整的标题
          contentMaxLength: 140, // 严格控制内容长度
          enableHighlights: true,
          highlightMaxCount: 3,
          enableValidation: true,
          maxRetries: 2,
          outputFormat: 'enhanced'
        }
      );

      console.log(`✅ 增强工作流完成: "${enhancedContent.title}" (质量分: ${enhancedContent.qualityScore})`);
      console.log(`📊 摘要内容: "${enhancedContent.summary}"`);
      console.log(`🏷️ 高亮词汇: ${JSON.stringify(enhancedContent.highlights)}`);

      return {
        title: enhancedContent.title,
        message: enhancedContent.summary,
        signature: `增强AI · Q${enhancedContent.qualityScore}`,
        source: 'Solidot Enhanced',
        publishTime: item.pubDate || new Date().toISOString(),
        category: '科技',
        link: item.link || undefined,
        highlights: enhancedContent.highlights
      };

    } catch (error) {
      console.error('增强工作流处理失败:', error);
      throw new Error(`增强工作流失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 使用AX框架处理RSS数据
   * 提供XML结构化输出和迭代优化
   */
  private async getAxProcessedRSSData(params: NewsDataParams): Promise<NewsData> {
    console.log('🚀 启动AX框架处理RSS数据...');
    
    try {
      // 1. 获取RSS数据
      const parser = new Parser();
      const feed = await parser.parseURL('https://www.solidot.org/index.rss');
      
      if (!feed.items || feed.items.length === 0) {
        throw new Error('RSS源无数据');
      }

      // 2. 选择指定的新闻（或默认第一条）
      const targetIndex = params.index !== undefined ? 
        Math.max(0, Math.min(params.index, feed.items.length - 1)) : 0;
      
      const item = feed.items[targetIndex];
      console.log(`📰 选择第${targetIndex + 1}条新闻进行AX处理: ${item.title}`);

      // 3. 初始化AX处理器（使用最新配置）
      let activeCfg = getFallbackLLMConfig();
      try {
        activeCfg = await getActiveLLMConfig(getPostgresDatabase());
      } catch (e) { /* use fallback */ }
      const axProcessor = new AxNewsProcessor({
        apiKey: activeCfg.apiKey,
        baseURL: activeCfg.baseUrl,
        strongModel: activeCfg.model,
        fastModel: activeCfg.model
      });

      // 4. 准备原始新闻内容
      const originalContent = `标题: ${item.title}\n内容: ${item.content || item.summary || '无内容'}`;
      
      // 5. 使用AX框架处理内容
      const processedContent = await axProcessor.processNews(originalContent);

      // 6. 转换为NewsData格式
      return {
        title: processedContent.title,
        message: processedContent.body,
        signature: `AX智能·${processedContent.footer}`,
        source: 'Solidot AX Enhanced',
        publishTime: item.pubDate || new Date().toISOString(),
        category: '科技',
        link: item.link || undefined
        // 注意：AX版本暂时不支持highlights，未来可以扩展
      };

    } catch (error) {
      console.error('AX框架处理失败:', error);
      throw new Error(`AX处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 使用AX完整优化处理器处理RSS数据
   * 包含自动学习训练、few-shot优化、中间产物生成
   */
  private async getAxOptimizedData(params: NewsDataParams): Promise<NewsData> {
    console.log('🧠 启动AX完整优化处理器...');
    
    try {
      // 1. 动态导入简化版AxOptimizedNewsProcessor
      const { AxOptimizedNewsProcessorSimplified } = await import('../services/ax-optimized-news-processor-simplified.js');
      
      // 2. 初始化AX优化处理器（使用最新配置）
      let activeCfg2 = getFallbackLLMConfig();
      try {
        activeCfg2 = await getActiveLLMConfig(getPostgresDatabase());
      } catch (e) { /* use fallback */ }
      const processor = new AxOptimizedNewsProcessorSimplified({
        apiKey: activeCfg2.apiKey,
        baseURL: activeCfg2.baseUrl,
        model: activeCfg2.model
      });
      
      // 3. 尝试加载预训练的优化产物
      console.log('📚 尝试加载预训练模型...');
      const loadSuccess = await processor.loadOptimizationArtifacts('ax-framework/models/production/latest.json');
      
      if (!loadSuccess) {
        // 如果没有预训练模型，使用基础训练数据进行快速训练
        console.log('⚡ 预训练模型未找到，使用基础数据进行训练...');
        
        // 导入基础训练数据
        const { trainingData } = await import('../../../ax-framework/compiled/ax-training-data.js');
        const sampleData = trainingData.slice(0, 3); // 使用前3个样本进行快速训练
        
        console.log(`🔄 开始快速训练 (${sampleData.length} 个样本)...`);
        await processor.quickTrain(sampleData);
        console.log('✅ 快速训练完成');
      } else {
        console.log('✅ 预训练模型加载成功');
      }
      
      // 4. 获取RSS数据并处理
      const parser = new Parser();
      const feed = await parser.parseURL('https://www.solidot.org/index.rss');
      
      if (!feed.items || feed.items.length === 0) {
        throw new Error('RSS源无数据');
      }

      // 5. 选择目标新闻
      const targetIndex = params.index !== undefined ? 
        Math.max(0, Math.min(params.index, feed.items.length - 1)) : 0;
      
      const item = feed.items[targetIndex];
      console.log(`📰 选择第${targetIndex + 1}条新闻进行AX优化处理: ${item.title}`);

      // 6. 准备新闻内容
      const originalContent = `标题: ${item.title}\n内容: ${item.content || item.summary || '无内容'}`;
      
      // 7. 使用优化后的程序处理内容
      const processedContent = await processor.processNewsWithOptimizedProgram(originalContent);

      // 8. 转换为NewsData格式
      return {
        title: processedContent.title,
        message: processedContent.body,
        signature: `AI训练·${processedContent.footer}`,
        source: 'Solidot AX Optimized',
        publishTime: item.pubDate || new Date().toISOString(),
        category: '科技',
        link: item.link || undefined
        // AX优化版支持完整功能，未来可扩展highlights
      };

    } catch (error) {
      console.error('❌ AX优化处理失败:', error);
      throw new Error(`AX优化处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 使用AX风格处理器处理RSS数据  
   * 声明式工作流，支持自定义API
   */
  private async getAxInspiredRSSData(params: NewsDataParams): Promise<NewsData> {
    console.log('⚡ 启动AX风格处理器处理RSS数据...');
    
    try {
      // 1. 获取RSS数据
      const parser = new Parser();
      const feed = await parser.parseURL('https://www.solidot.org/index.rss');
      
      if (!feed.items || feed.items.length === 0) {
        throw new Error('RSS源无数据');
      }

      // 2. 选择指定的新闻（或默认第一条）
      const targetIndex = params.index !== undefined ? 
        Math.max(0, Math.min(params.index, feed.items.length - 1)) : 0;
      
      const item = feed.items[targetIndex];
      console.log(`📰 选择第${targetIndex + 1}条新闻进行AX风格处理: ${item.title}`);

      // 3. 初始化AX风格处理器（使用最新配置）
      let activeCfg3 = getFallbackLLMConfig();
      try {
        activeCfg3 = await getActiveLLMConfig(getPostgresDatabase());
      } catch (e) { /* use fallback */ }
      const axProcessor = new AxInspiredNewsProcessor({
        llmService: this.llmService,
        strongModel: activeCfg3.model,
        fastModel: activeCfg3.model
      });

      // 4. 准备原始新闻内容
      const originalContent = `标题: ${item.title}\n内容: ${item.content || item.summary || '无内容'}`;
      
      // 5. 使用AX风格处理器处理内容
      const processedContent = await axProcessor.processNews(originalContent);

      // 6. 转换为NewsData格式
      return {
        title: processedContent.title,
        message: processedContent.body,
        signature: `AX风格·${processedContent.footer}`,
        source: 'Solidot AX Inspired',
        publishTime: item.pubDate || new Date().toISOString(),
        category: '科技',
        link: item.link || undefined
        // 注意：暂时不支持highlights，但可以在后续版本中扩展
      };

    } catch (error) {
      console.error('AX风格处理器失败:', error);
      throw new Error(`AX风格处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private async getAPIData(params: NewsDataParams): Promise<NewsData> {
    // TODO: 实现新闻API数据获取
    throw new Error('新闻API数据源暂未实现，请使用mock数据源进行测试');
  }
}

/**
 * 新闻组件插件实现
 */
export class NewsPlugin implements WidgetPlugin<NewsData, NewsConfig> {
  meta = {
    type: 'news',
    name: '文字新闻组件',
    description: '显示文字新闻内容，支持多种新闻源',
    version: '1.0.0',
    author: 'MindReset Team',
    homepage: 'https://github.com/anthropics/claude-code'
  };

  dataProvider = new NewsDataProvider();

  component = NewsWidget;

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
        name: 'border',
        description: '边框颜色: 0=白色, 1=黑色',
        required: false,
        defaultValue: '0',
        choices: ['0', '1']
      },
      {
        name: 'source',
        description: '数据源',
        required: false,
        defaultValue: 'mock',
        choices: this.dataProvider.getSources()
      }
    ];
  }

  validateConfig(config: NewsConfig): boolean {
    if (config.border && !['0', '1'].includes(config.border)) {
      return false;
    }
    return true;
  }

  parseCliArgs(args: string[]): { params: NewsDataParams; config: NewsConfig } {
    // 处理特殊参数
    const force = args.includes('--force');
    const filteredArgs = args.filter(arg => arg !== '--force');

    const category = filteredArgs[0] || 'technology';
    const sourceArg = filteredArgs[1] || this.dataProvider.getDefaultSource();
    const indexArg = filteredArgs[2];
    
    // 新格式: category source [index] [--force]
    let source = sourceArg;
    let index: number | undefined;
    let border: '0' | '1' = '0';
    
    // 解析第三个参数（索引）
    if (indexArg !== undefined) {
      const parsed = parseInt(indexArg, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        index = parsed;
      } else if (['0', '1'].includes(indexArg)) {
        // 如果是边框参数，保留为边框设置
        border = indexArg as '0' | '1';
      }
      // 如果不是数字也不是边框参数，忽略
    }

    // 验证分类
    const validCategories = ['technology', 'finance', 'sports'];
    if (!validCategories.includes(category)) {
      throw new Error(`不支持的新闻分类: ${category}。支持的分类: ${validCategories.join(', ')}`);
    }

    // 验证数据源
    const validSources = this.dataProvider.getSources();
    if (!validSources.includes(source)) {
      throw new Error(`不支持的数据源: ${source}。支持的数据源: ${validSources.join(', ')}`);
    }

    console.log(`📋 解析参数: category=${category}, source=${source}, index=${index}, force=${force}, border=${border}`);

    return {
      params: { 
        category, 
        dataSource: source, 
        index: index,
        force: force 
      },
      config: { border }
    };
  }

  getUsageHelp(): string {
    return `📰 新闻组件使用说明

🚀 用法: npm run widget:news [分类] [数据源] [索引] [选项]

📝 参数说明:
  分类: technology, finance, sports (默认: technology)
  数据源: ${this.dataProvider.getSources().join(', ')} (默认: ${this.dataProvider.getDefaultSource()})
  索引: 新闻条目索引，从0开始 (默认: 0，选择第一条)
  
🔧 选项:
  --force  强制刷新，跳过缓存

🏆 数据源详情:
${this.dataProvider.getSources().map(source => 
  `  • ${source.padEnd(12)} - ${this.dataProvider.getSourceDescription(source)}`
).join('\n')}

💡 示例命令:
${this.getExampleCommands().map(cmd => `  ${cmd}`).join('\n')}

🔬 特性:
  ✅ 支持多种新闻分类
  ✅ 按顺序处理新闻条目，不再随机
  ✅ 智能缓存系统，相同请求立即返回
  ✅ 支持强制刷新绕过缓存
  ✅ 紧凑的文字布局设计
  ✅ 水墨屏显示优化
  ✅ 可扩展的数据源系统`;
  }

  getExampleCommands(): string[] {
    return [
      'npm run widget:news',
      'npm run widget:news technology mock',
      'npm run widget:news technology ax-optimized 0', 
      'npm run widget:news finance rss 0',
      'npm run widget:news technology ax-optimized 5 --force',
      'npm run widget:news sports mock 2'
    ];
  }
}

// 导出插件实例
export const newsPlugin = new NewsPlugin();