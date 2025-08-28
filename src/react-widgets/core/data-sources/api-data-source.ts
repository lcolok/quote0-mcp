/**
 * API数据源模块
 * 从第三方新闻API获取实时新闻
 */

import { BaseDataSourceModule } from './base-data-source.js';
import { 
  RawDataItem, 
  DataSourceParams, 
  DataSourceParamDefinition,
  DataSourceHealthStatus 
} from '../modular-architecture.js';

export class APIDataSourceModule extends BaseDataSourceModule {
  name = 'API数据源';
  version = '1.0.0';
  description = '从第三方新闻API获取实时新闻';
  
  async fetchRawData(params: DataSourceParams): Promise<RawDataItem[]> {
    const count = params.count || 10;
    const startIndex = params.startIndex || 0;
    const category = params.category || 'technology';
    
    console.log(`📡 API数据源获取: category=${category}, count=${count}, startIndex=${startIndex}`);
    
    try {
      // 这里可以实现真实的API调用
      // 目前返回模拟数据作为API响应示例
      await new Promise(resolve => setTimeout(resolve, 200)); // 模拟API延迟
      
      const mockApiResponse = this.generateMockApiData(category, count, startIndex);
      
      console.log(`✅ API数据源获取成功: ${mockApiResponse.length}条数据`);
      return mockApiResponse;
      
    } catch (error) {
      console.error('❌ API数据源获取失败:', error);
      throw new Error(`API数据源获取失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
  
  private generateMockApiData(category: string, count: number, startIndex: number): RawDataItem[] {
    const mockTemplates: Record<string, string[]> = {
      technology: [
        'AI技术在{领域}领域取得突破',
        '新型{技术}处理器发布性能提升{数字}倍',
        '开源项目{项目名}获得重大更新',
        '{公司}推出革命性{产品}产品'
      ],
      finance: [
        '{国家}央行调整货币政策利率',
        '数字货币在{地区}开始试点应用',
        '{公司}完成{金额}亿融资',
        '绿色金融产品发行规模创新高'
      ],
      sports: [
        '{运动员}在{比赛}中创造新记录',
        '全国{运动}联赛季后赛开始',
        '{队伍}签约国际知名教练',
        '体育产业数字化转型加速'
      ]
    };
    
    const templates = mockTemplates[category] || mockTemplates.technology;
    const results: RawDataItem[] = [];
    
    for (let i = 0; i < count; i++) {
      const template = templates[i % templates.length];
      const title = this.fillTemplate(template);
      
      results.push({
        id: `api_${category}_${startIndex + i}_${Date.now()}`,
        title,
        content: `这是来自API的${category}分类新闻内容，索引为${startIndex + i}。内容包含了最新的行业动态和技术发展信息。`,
        source: 'API新闻服务',
        publishTime: new Date(Date.now() - Math.random() * 86400000).toISOString(), // 随机时间
        category,
        link: `https://example.com/news/${startIndex + i}`,
        metadata: {
          apiSource: 'third-party-news-api',
          apiIndex: startIndex + i,
          confidence: Math.round(Math.random() * 30 + 70) // 70-100的置信度
        }
      });
    }
    
    return results;
  }
  
  private fillTemplate(template: string): string {
    const replacements = {
      '{领域}': ['医疗', '教育', '金融', '制造业'],
      '{技术}': ['GPU', 'CPU', '量子', '神经网络'],
      '{数字}': ['2', '3', '5', '10'],
      '{项目名}': ['TensorFlow', 'React', 'Vue', 'PyTorch'],
      '{公司}': ['阿里巴巴', '腾讯', '百度', '字节跳动'],
      '{产品}': ['云计算', '大数据', '区块链', 'IoT'],
      '{国家}': ['中国', '美国', '欧盟', '日本'],
      '{地区}': ['北京', '上海', '深圳', '杭州'],
      '{金额}': ['10', '20', '50', '100'],
      '{运动员}': ['张三', '李四', '王五', '赵六'],
      '{比赛}': ['全运会', '亚运会', '世锦赛', '奥运会'],
      '{队伍}': ['中国男篮', '国家足球队', '排球队', '游泳队'],
      '{运动}': ['篮球', '足球', '排球', '游泳']
    };
    
    let result = template;
    Object.entries(replacements).forEach(([key, values]) => {
      if (result.includes(key)) {
        const randomValue = values[Math.floor(Math.random() * values.length)];
        result = result.replace(key, randomValue);
      }
    });
    
    return result;
  }
  
  getSupportedParams(): DataSourceParamDefinition[] {
    return [
      {
        name: 'count',
        type: 'number',
        required: false,
        defaultValue: 10,
        description: '获取新闻数量',
        validation: (value: number) => value > 0 && value <= 100
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
        description: '新闻分类'
      }
    ];
  }
  
  async getHealthStatus(): Promise<DataSourceHealthStatus> {
    const startTime = Date.now();
    
    try {
      // 模拟API健康检查
      await new Promise(resolve => setTimeout(resolve, 100));
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        message: 'API数据源连接正常',
        lastChecked: new Date().toISOString(),
        responseTime,
        dataQuality: 90,
        additionalInfo: {
          apiEndpoint: 'third-party-news-api',
          rateLimitRemaining: 9000,
          supportedCategories: ['technology', 'finance', 'sports']
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        message: `API数据源异常: ${error instanceof Error ? error.message : '未知错误'}`,
        lastChecked: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        dataQuality: 0
      };
    }
  }
}