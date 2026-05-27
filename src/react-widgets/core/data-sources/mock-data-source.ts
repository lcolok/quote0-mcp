/**
 * Mock数据源模块
 * 用于测试和演示的模拟新闻数据
 */

import { BaseDataSourceModule } from './base-data-source.js';
import { 
  RawDataItem, 
  DataSourceParams, 
  DataSourceParamDefinition 
} from '../modular-architecture.js';

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
      },
      {
        id: 'mock_tech_3',
        title: 'AI芯片新架构设计突破',
        content: '新型神经网络处理器采用仿生设计，功耗降低60%的同时性能提升3倍，为边缘计算和移动AI应用带来革命性改进，预计明年上半年量产。',
        source: 'AI芯片研发中心',
        publishTime: new Date(Date.now() - 7200000).toISOString(),
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
      },
      {
        id: 'mock_finance_2',
        title: '绿色债券发行规模创新高',
        content: '今年绿色债券发行总额突破1万亿人民币，同比增长45%，资金主要流向清洁能源、绿色交通和节能减排项目，助力碳达峰碳中和目标实现。',
        source: '绿色金融研究院',
        publishTime: new Date(Date.now() - 1800000).toISOString(),
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
      },
      {
        id: 'mock_sports_2',
        title: '全国马拉松赛事恢复增长',
        content: '今年全国马拉松及路跑赛事数量恢复至疫情前水平，预计全年举办赛事超过300场，参赛人数将突破500万人次，带动体育旅游消费快速增长。',
        source: '中国田径协会',
        publishTime: new Date(Date.now() - 3600000).toISOString(),
        category: 'sports',
        metadata: { mockCategory: 'sports' }
      }
    ]
  };
  
  async fetchRawData(params: DataSourceParams): Promise<RawDataItem[]> {
    // 检查是否有请求级别的mock数据（避免全局状态污染）
    const playgroundData = params.mockData;
    if (playgroundData) {
      console.log('🎮 使用 Playground 注入的测试数据');

      return [{
        id: `playground_${Date.now()}`,
        title: playgroundData.title,
        content: playgroundData.content,
        source: playgroundData.source,
        publishTime: new Date().toISOString(),
        category: params.category || 'technology',
        metadata: {
          isPlayground: true,
          link: playgroundData.link
        }
      }];
    }

    const category = params.category || 'technology';
    const count = params.count || 1;
    const startIndex = params.startIndex || 0;

    console.log(`📝 Mock数据源获取: category=${category}, count=${count}, startIndex=${startIndex}`);

    const categoryData = this.mockData[category] || this.mockData.technology;
    const endIndex = Math.min(startIndex + count, categoryData.length);
    const selectedData = categoryData.slice(startIndex, endIndex);

    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log(`✅ Mock数据源获取成功: ${selectedData.length}条数据`);
    return selectedData.map(item => ({
      ...item,
      // 每次获取时更新时间戳以便测试
      id: `${item.id}_${Date.now()}`
    }));
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
}