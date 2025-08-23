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
import { NewsWidget, NewsData, NewsItem } from '../components/NewsWidget.js';

/**
 * 新闻数据参数接口
 */
interface NewsDataParams extends WidgetDataParams {
  query?: string;
  category?: string;
  source?: string;
  count?: number;
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
  getSources(): string[] {
    return ['mock', 'rss', 'api'];
  }

  getDefaultSource(): string {
    return 'mock';
  }

  getSourceDescription(source: string): string {
    const descriptions: Record<string, string> = {
      mock: '📝 模拟数据 - 用于测试和演示的示例新闻',
      rss: '📡 RSS源 - 从RSS订阅获取新闻内容',
      api: '🌐 新闻API - 从第三方新闻服务获取实时新闻'
    };
    return descriptions[source] || '未知数据源';
  }

  async getData(source: string, params: NewsDataParams): Promise<NewsData> {
    switch (source) {
      case 'mock':
        return this.getMockData(params);
      
      case 'rss':
        return await this.getRSSData(params);
      
      case 'api':
        return await this.getAPIData(params);
      
      default:
        throw new Error(`不支持的数据源: ${source}`);
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
    // TODO: 实现RSS数据获取
    throw new Error('RSS数据源暂未实现，请使用mock数据源进行测试');
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
    const category = args[0] || 'technology';
    const border = args[1] || '0';
    const source = args[2] || this.dataProvider.getDefaultSource();

    // 验证分类
    const validCategories = ['technology', 'finance', 'sports'];
    if (!validCategories.includes(category)) {
      throw new Error(`不支持的新闻分类: ${category}。支持的分类: ${validCategories.join(', ')}`);
    }

    return {
      params: { category, source },
      config: { border: border as '0' | '1' }
    };
  }

  getUsageHelp(): string {
    return `📰 新闻组件使用说明

🚀 用法: npm run widget:news [分类] [边框] [数据源]

📝 参数说明:
  分类: technology, finance, sports (默认: technology)
  边框: 0=白色, 1=黑色 (默认: 0)  
  数据源: ${this.dataProvider.getSources().join(', ')} (默认: ${this.dataProvider.getDefaultSource()})

🏆 数据源详情:
${this.dataProvider.getSources().map(source => 
  `  • ${source.padEnd(8)} - ${this.dataProvider.getSourceDescription(source)}`
).join('\n')}

💡 示例命令:
${this.getExampleCommands().map(cmd => `  ${cmd}`).join('\n')}

🔬 特性:
  ✅ 支持多种新闻分类
  ✅ 紧凑的文字布局设计
  ✅ 水墨屏显示优化
  ✅ 可扩展的数据源系统`;
  }

  getExampleCommands(): string[] {
    return [
      'npm run widget:news',
      'npm run widget:news technology',
      'npm run widget:news finance 0 mock',
      'npm run widget:news sports 1',
      'npm run widget:news technology 0 mock'
    ];
  }
}

// 导出插件实例
export const newsPlugin = new NewsPlugin();