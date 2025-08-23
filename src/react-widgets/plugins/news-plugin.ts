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
    title: 'AI技术在各行业加速应用',
    summary: '人工智能技术在医疗、教育、金融等领域的应用越来越广泛，为各行业带来变革。',
    source: '科技日报',
    publishTime: new Date().toISOString(),
    category: '科技',
    items: [
      { title: 'ChatGPT用户突破1亿', source: 'TechCrunch', time: '10:30' },
      { title: '苹果发布新款MacBook Pro', source: 'Apple', time: '09:15' },
      { title: 'Meta推出VR新产品线', source: 'Meta', time: '08:45' },
      { title: '特斯拉自动驾驶技术升级', source: 'Tesla', time: '07:30' },
      { title: '微软AI助手集成Office套件', source: 'Microsoft', time: '06:20' },
      { title: '谷歌量子计算取得突破', source: 'Google', time: '05:15' }
    ]
  },
  finance: {
    title: '全球股市波动加剧',
    summary: '受地缘政治影响，全球主要股指出现较大波动，投资者情绪谨慎。',
    source: '财经网',
    publishTime: new Date().toISOString(),
    category: '财经',
    items: [
      { title: '沪深300指数收涨1.2%', source: '上交所', time: '15:30' },
      { title: '美联储加息预期升温', source: 'Fed', time: '14:15' },
      { title: '比特币价格回调至4万美元', source: 'CoinDesk', time: '13:45' },
      { title: '黄金价格创年内新高', source: 'COMEX', time: '12:30' },
      { title: '原油期货价格上涨2%', source: 'WTI', time: '11:20' }
    ]
  },
  sports: {
    title: 'NBA季后赛激战正酣',
    summary: '各支球队为争夺总冠军展开激烈角逐，精彩比赛连连。',
    source: 'ESPN中文',
    publishTime: new Date().toISOString(),
    category: '体育',
    items: [
      { title: '湖人队击败勇士队进入下一轮', source: 'NBA', time: '11:30' },
      { title: '詹姆斯创季后赛得分纪录', source: 'ESPN', time: '10:15' },
      { title: '凯尔特人横扫对手晋级', source: 'NBA', time: '09:45' },
      { title: '中国女排备战世锦赛', source: '中国排协', time: '08:30' },
      { title: '北京冬奥会筹备进展顺利', source: 'IOC', time: '07:20' }
    ]
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