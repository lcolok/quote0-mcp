/**
 * 数据源模块抽象基类和具体实现
 */

import { 
  DataSourceModule, 
  RawDataItem, 
  DataSourceParams, 
  DataSourceParamDefinition, 
  DataSourceHealthStatus 
} from './modular-architecture.js';

/**
 * 数据源模块抽象基类
 */
export abstract class BaseDataSourceModule implements DataSourceModule {
  abstract name: string;
  abstract version: string;
  abstract description: string;
  
  abstract fetchRawData(params: DataSourceParams): Promise<RawDataItem[]>;
  abstract getSupportedParams(): DataSourceParamDefinition[];
  
  validateParams(params: DataSourceParams): boolean {
    const supportedParams = this.getSupportedParams();
    
    // 检查必需参数
    for (const paramDef of supportedParams) {
      if (paramDef.required && !(paramDef.name in params)) {
        console.error(`缺少必需参数: ${paramDef.name}`);
        return false;
      }
      
      // 检查参数类型和验证
      if (paramDef.name in params) {
        const value = params[paramDef.name];
        
        if (paramDef.validation && !paramDef.validation(value)) {
          console.error(`参数验证失败: ${paramDef.name}`);
          return false;
        }
      }
    }
    
    return true;
  }
  
  async getHealthStatus(): Promise<DataSourceHealthStatus> {
    const startTime = Date.now();
    
    try {
      // 尝试获取少量数据来检查健康状态
      await this.fetchRawData({ count: 1 });
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        message: '数据源正常',
        lastChecked: new Date().toISOString(),
        responseTime,
        dataAvailability: true,
        connectionStatus: 'connected'
      };
    } catch (error) {
      return {
        healthy: false,
        message: `数据源异常: ${error instanceof Error ? error.message : '未知错误'}`,
        lastChecked: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        dataAvailability: false,
        connectionStatus: 'error'
      };
    }
  }
}

/**
 * RSS数据源模块
 */
export class RSSDataSourceModule extends BaseDataSourceModule {
  name = 'RSS数据源';
  version = '1.0.0';
  description = '从RSS订阅获取新闻数据';
  
  async fetchRawData(params: DataSourceParams): Promise<RawDataItem[]> {
    const Parser = (await import('rss-parser')).default;
    const parser = new Parser({
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ModularNewsWidget/1.0)'
      }
    });
    
    const rssUrl = params.url || 'https://www.solidot.org/index.rss';
    const count = params.count || 10;
    const startIndex = params.startIndex || 0;
    
    console.log(`📡 RSS数据源获取: ${rssUrl} (从${startIndex}开始，获取${count}条)`);
    
    try {
      const feed = await parser.parseURL(rssUrl);
      
      if (!feed.items || feed.items.length === 0) {
        throw new Error('RSS源没有找到新闻条目');
      }
      
      const endIndex = Math.min(startIndex + count, feed.items.length);
      const selectedItems = feed.items.slice(startIndex, endIndex);
      
      const rawDataItems: RawDataItem[] = selectedItems.map((item, index) => ({
        id: `rss_${startIndex + index}_${Date.now()}`,
        title: item.title || '无标题',
        content: this.cleanContent(item.contentSnippet || item.content || item.description || ''),
        source: feed.title || 'RSS源',
        publishTime: item.pubDate || new Date().toISOString(),
        link: item.link,
        category: params.category || '新闻',
        metadata: {
          rssUrl,
          originalIndex: startIndex + index,
          guid: item.guid
        }
      }));
      
      console.log(`✅ RSS数据源获取成功: ${rawDataItems.length}条数据`);
      return rawDataItems;
      
    } catch (error) {
      console.error('RSS数据源获取失败:', error);
      throw new Error(`RSS数据获取失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
  
  getSupportedParams(): DataSourceParamDefinition[] {
    return [
      {
        name: 'url',
        type: 'string',
        required: false,
        defaultValue: 'https://www.solidot.org/index.rss',
        description: 'RSS订阅地址'
      },
      {
        name: 'count',
        type: 'number',
        required: false,
        defaultValue: 10,
        description: '获取条目数量',
        validation: (value: number) => value > 0 && value <= 50
      },
      {
        name: 'startIndex',
        type: 'number',
        required: false,
        defaultValue: 0,
        description: '开始索引',
        validation: (value: number) => value >= 0
      },
      {
        name: 'category',
        type: 'string',
        required: false,
        defaultValue: '新闻',
        description: '新闻分类'
      }
    ];
  }
  
  private cleanContent(content: string): string {
    // 清理HTML标签和多余空白
    return content
      .replace(/<[^>]*>/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
  }
}

/**
 * Mock数据源模块
 */
export class MockDataSourceModule extends BaseDataSourceModule {
  name = 'Mock数据源';
  version = '1.0.0';
  description = '用于测试和演示的模拟新闻数据';
  
  private mockData: Record<string, RawDataItem[]> = {
    technology: [
      {
        id: 'mock_tech_1',
        title: '3D打印树脂有毒性风险研究发布',
        content: '最新研究表明光敏树脂加热与固化会释放挥发性有机物和刺激性气体，部分材料有皮肤刺激甚至致敏可能。专家建议佩戴手套、加强通风，打印后彻底固化和清洗成品可降低健康风险。',
        source: '3D打印安全研究院',
        publishTime: new Date().toISOString(),
        category: 'technology',
        metadata: { mockCategory: 'technology' }
      },
      {
        id: 'mock_tech_2',
        title: '量子计算突破性进展',
        content: '研究团队成功实现了室温下稳定的量子比特操作，为量子计算机的实用化迈出重要一步。这项技术有望在密码学、药物发现和人工智能领域产生革命性影响。',
        source: '量子科技前沿',
        publishTime: new Date(Date.now() - 3600000).toISOString(),
        category: 'technology',
        metadata: { mockCategory: 'technology' }
      }
    ],
    finance: [
      {
        id: 'mock_finance_1',
        title: '央行数字货币全国试点扩展',
        content: '人民银行宣布数字人民币试点范围从26个城市扩展至全国所有地级市，支持线上线下全场景支付，与支付宝微信并存互补，推动金融基础设施现代化建设进程加速。',
        source: '中国人民银行',
        publishTime: new Date().toISOString(),
        category: 'finance',
        metadata: { mockCategory: 'finance' }
      }
    ],
    sports: [
      {
        id: 'mock_sports_1',
        title: '中国男篮世界杯预选赛获胜',
        content: '中国男篮在世界杯亚太区预选赛中以87-81战胜强敌澳大利亚队，这场胜利让中国队在积分榜上占据有利位置，有望直接晋级2024年巴黎奥运会篮球比赛。',
        source: '中国篮协',
        publishTime: new Date().toISOString(),
        category: 'sports',
        metadata: { mockCategory: 'sports' }
      }
    ]
  };
  
  async fetchRawData(params: DataSourceParams): Promise<RawDataItem[]> {
    const category = params.category || 'technology';
    const count = params.count || 1;
    const startIndex = params.startIndex || 0;
    
    console.log(`📝 Mock数据源获取: category=${category}, count=${count}, startIndex=${startIndex}`);
    
    const categoryData = this.mockData[category];
    if (!categoryData) {
      throw new Error(`不支持的Mock数据分类: ${category}`);
    }
    
    const endIndex = Math.min(startIndex + count, categoryData.length);
    const selectedData = categoryData.slice(startIndex, endIndex);
    
    // 模拟异步延迟
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log(`✅ Mock数据源获取成功: ${selectedData.length}条数据`);
    return selectedData;
  }
  
  getSupportedParams(): DataSourceParamDefinition[] {
    return [
      {
        name: 'category',
        type: 'string',
        required: false,
        defaultValue: 'technology',
        description: '新闻分类',
        choices: ['technology', 'finance', 'sports']
      },
      {
        name: 'count',
        type: 'number',
        required: false,
        defaultValue: 1,
        description: '获取条目数量',
        validation: (value: number) => value > 0 && value <= 10
      },
      {
        name: 'startIndex',
        type: 'number',
        required: false,
        defaultValue: 0,
        description: '开始索引',
        validation: (value: number) => value >= 0
      }
    ];
  }
  
  async getHealthStatus(): Promise<DataSourceHealthStatus> {
    return {
      healthy: true,
      message: 'Mock数据源始终可用',
      lastChecked: new Date().toISOString(),
      responseTime: 10,
      dataAvailability: true,
      connectionStatus: 'connected',
      additionalInfo: {
        availableCategories: Object.keys(this.mockData),
        totalMockItems: Object.values(this.mockData).reduce((sum, items) => sum + items.length, 0)
      }
    };
  }
}

/**
 * API数据源模块
 */
export class APIDataSourceModule extends BaseDataSourceModule {
  name = 'API数据源';
  version = '1.0.0';
  description = '从第三方新闻API获取实时新闻';
  
  async fetchRawData(params: DataSourceParams): Promise<RawDataItem[]> {
    // TODO: 实现API数据获取逻辑
    throw new Error('API数据源暂未实现，请使用其他数据源进行测试');
  }
  
  getSupportedParams(): DataSourceParamDefinition[] {
    return [
      {
        name: 'apiKey',
        type: 'string',
        required: true,
        description: 'API访问密钥'
      },
      {
        name: 'endpoint',
        type: 'string',
        required: false,
        defaultValue: 'https://api.example.com/news',
        description: 'API端点地址'
      },
      {
        name: 'category',
        type: 'string',
        required: false,
        description: '新闻分类'
      }
    ];
  }
}

/**
 * 数据源模块注册表
 */
export class DataSourceRegistry {
  private modules: Map<string, DataSourceModule> = new Map();
  
  constructor() {
    // 注册默认数据源模块
    this.register('rss', new RSSDataSourceModule());
    this.register('mock', new MockDataSourceModule());
    this.register('api', new APIDataSourceModule());
  }
  
  register(name: string, module: DataSourceModule): void {
    this.modules.set(name, module);
    console.log(`✅ 数据源模块已注册: ${name} (${module.name} v${module.version})`);
  }
  
  get(name: string): DataSourceModule | undefined {
    return this.modules.get(name);
  }
  
  getAvailable(): string[] {
    return Array.from(this.modules.keys());
  }
  
  async getModuleStatus(name: string): Promise<DataSourceHealthStatus | null> {
    const module = this.modules.get(name);
    if (!module) {
      return null;
    }
    
    return await module.getHealthStatus();
  }
  
  async getAllModulesStatus(): Promise<Record<string, DataSourceHealthStatus | null>> {
    const status: Record<string, DataSourceHealthStatus | null> = {};
    
    for (const [name, module] of this.modules) {
      try {
        status[name] = await module.getHealthStatus();
      } catch (error) {
        status[name] = null;
      }
    }
    
    return status;
  }
}

// 导出默认注册表实例
export const dataSourceRegistry = new DataSourceRegistry();