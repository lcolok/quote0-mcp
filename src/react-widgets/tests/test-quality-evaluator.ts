/**
 * 测试新闻质量评估器
 */

import { NewsQualityEvaluator } from '../services/news-quality-evaluator.js';
import { getFallbackLLMConfig } from '../core/llm-config.js';

async function testQualityEvaluator() {
  console.log('========================================');
  console.log('🧪 新闻质量评估器测试');
  console.log('========================================\n');

  // 获取环境变量
  const fallback = getFallbackLLMConfig();
  const apiKey = fallback.apiKey;
  const baseURL = fallback.baseUrl;
  const model = fallback.model;

  if (!apiKey || !baseURL) {
    console.error('❌ 请设置环境变量: LLM_API_KEY, LLM_BASE_URL');
    process.exit(1);
  }

  const evaluator = new NewsQualityEvaluator({
    apiKey,
    baseURL,
    model,
    scoreThreshold: 60
  });

  // 测试用例：高价值新闻
  const highValueNews = [
    {
      title: 'F-Droid 发表声明反对 Google 验证应用开发者身份的要求',
      source: '奇客Solidot',
      description: 'F-Droid发表声明反对Google的新政策'
    },
    {
      title: 'SpaceX has a few tricks up its sleeve for the last Starship flight of the year',
      source: 'Ars Technica',
      description: 'SpaceX plans to reuse Super Heavy booster with 24 Raptor engines'
    },
    {
      title: 'Why LLMs Fail Without Human-Crafted Context',
      source: 'DEV Community',
      description: 'Analysis of why LLMs need proper context to succeed'
    }
  ];

  // 测试用例：低价值内容
  const lowValueNews = [
    {
      title: '社区速递 112 | 量大管饱的派友八月剁手清单、一周热评和最新文章',
      source: '少数派',
      description: '社区内部速递'
    },
    {
      title: 'My Java Full Stack Journey Learning (RealDOM & React DOM) in React JS',
      source: 'DEV Community',
      description: 'Personal learning blog'
    },
    {
      title: '智己汽车：9月销量11107台，环比增长81.8%，创品牌历史新高',
      source: '36氪',
      description: '公司销量快讯'
    },
    {
      title: 'Tyler Davis and Joshua Lintz worked hand in hand to defraud the founder',
      source: 'DEV Community',
      description: 'Personal accusation'
    },
    {
      title: '你的大脑已上线：让这份「欺诈智斗」片单点燃你的智商',
      source: '少数派',
      description: '电影推荐列表'
    },
    {
      title: '三款机型齐更新，各种需求都好挑：新款 Apple Watch 选购指南',
      source: '少数派',
      description: '购物选购指南'
    }
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━');
  console.log('【测试1: 高价值新闻】');
  console.log('━━━━━━━━━━━━━━━━━━━━\n');

  for (const news of highValueNews) {
    const result = await evaluator.evaluate(news);
    console.log(`标题: ${news.title}`);
    console.log(`评分: ${result.score}/100 (${result.category})`);
    console.log(`过滤: ${result.shouldFilter ? '❌ 是' : '✅ 否'}`);
    console.log(`理由: ${result.reason}`);
    console.log(`标签: ${result.tags.join(', ')}`);
    console.log(`维度: 新闻性${result.dimensions.newsValue} 实用性${result.dimensions.practicality} 密度${result.dimensions.density}`);
    console.log('');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━');
  console.log('【测试2: 低价值内容】');
  console.log('━━━━━━━━━━━━━━━━━━━━\n');

  for (const news of lowValueNews) {
    const result = await evaluator.evaluate(news);
    console.log(`标题: ${news.title.substring(0, 50)}...`);
    console.log(`评分: ${result.score}/100 (${result.category})`);
    console.log(`过滤: ${result.shouldFilter ? '✅ 是' : '❌ 否'}`);
    console.log(`理由: ${result.reason}`);
    console.log(`标签: ${result.tags.join(', ')}`);
    console.log('');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━');
  console.log('【测试3: 批量评估性能】');
  console.log('━━━━━━━━━━━━━━━━━━━━\n');

  const allNews = [...highValueNews, ...lowValueNews];
  const startTime = Date.now();

  const batchResults = await evaluator.evaluateBatch(allNews);

  const endTime = Date.now();
  const duration = endTime - startTime;

  const highValueCount = batchResults.filter(r => r.category === 'high').length;
  const mediumValueCount = batchResults.filter(r => r.category === 'medium').length;
  const lowValueCount = batchResults.filter(r => r.category === 'low').length;
  const filteredCount = batchResults.filter(r => r.shouldFilter).length;

  console.log(`批量评估: ${allNews.length}条`);
  console.log(`耗时: ${duration}ms (平均${(duration / allNews.length).toFixed(0)}ms/条)`);
  console.log('');
  console.log(`结果分布:`);
  console.log(`  高价值: ${highValueCount}条`);
  console.log(`  中等: ${mediumValueCount}条`);
  console.log(`  低价值: ${lowValueCount}条`);
  console.log(`  被过滤: ${filteredCount}条 (${(filteredCount * 100 / allNews.length).toFixed(1)}%)`);

  console.log('\n========================================');
  console.log('✅ 测试完成');
  console.log('========================================');
}

// 运行测试
testQualityEvaluator().catch(console.error);
