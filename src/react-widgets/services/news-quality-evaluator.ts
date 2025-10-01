/**
 * 新闻内容质量评估器
 * 使用LLM深度评估新闻的信息价值，过滤低质量内容
 */

export interface QualityEvaluation {
  score: number;           // 0-100 综合评分
  category: 'high' | 'medium' | 'low';  // 质量分类
  shouldFilter: boolean;   // 是否应该过滤
  reason: string;          // 评估理由
  dimensions: {            // 各维度评分
    newsValue: number;     // 新闻性 (0-100)
    practicality: number;  // 实用性 (0-100)
    density: number;       // 信息密度 (0-100)
    timeliness: number;    // 时效性 (0-100)
    universality: number;  // 普适性 (0-100)
  };
  tags: string[];          // 内容标签
}

interface NewsInput {
  title: string;
  description?: string;
  source: string;
  link?: string;
}

export class NewsQualityEvaluator {
  private options: {
    apiKey: string;
    baseURL: string;
    model: string;
    scoreThreshold: number;  // 过滤阈值，低于此分数将被过滤
  };

  constructor(options: {
    apiKey: string;
    baseURL: string;
    model: string;
    scoreThreshold?: number;
  }) {
    this.options = {
      ...options,
      scoreThreshold: options.scoreThreshold ?? 60  // 默认60分以下过滤
    };
  }

  /**
   * 评估新闻质量
   */
  async evaluate(news: NewsInput): Promise<QualityEvaluation> {
    console.log(`🔍 开始评估: ${news.title.substring(0, 50)}...`);

    try {
      const { OpenAI } = await import('openai');

      const client = new OpenAI({
        apiKey: this.options.apiKey,
        baseURL: this.options.baseURL
      });

      const prompt = this.buildEvaluationPrompt(news);

      const response = await client.chat.completions.create({
        model: this.options.model,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的新闻质量评估专家，擅长客观评估新闻的信息价值。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,  // 降低随机性，保证评估稳定
        max_tokens: 500,
        response_format: { type: 'json_object' }  // 要求返回JSON格式
      });

      if (!response.choices || response.choices.length === 0) {
        throw new Error('LLM未返回评估结果');
      }

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('LLM返回内容为空');
      }

      const result = JSON.parse(content);
      const evaluation = this.parseEvaluationResult(result);

      console.log(`✅ 评估完成: ${evaluation.score}分 (${evaluation.category}) - ${evaluation.shouldFilter ? '过滤' : '保留'}`);

      return evaluation;

    } catch (error: any) {
      console.error(`❌ 质量评估失败: ${error.message}`);

      // 失败时使用保守策略：基于规则的快速判断
      return this.fallbackEvaluation(news);
    }
  }

  /**
   * 构建评估提示词
   */
  private buildEvaluationPrompt(news: NewsInput): string {
    return `请评估以下新闻的信息价值，从多个维度打分（0-100分），并给出综合评分和过滤建议。

【新闻信息】
标题: ${news.title}
${news.description ? `摘要: ${news.description}` : ''}
来源: ${news.source}

【评估维度说明】
1. 新闻性 (0-100):
   - 高分：重要事件、行业动态、科技突破、商业新闻
   - 低分：个人博客、学习日志、内部社区通知、征稿启事、个人周报

2. 实用性 (0-100):
   - 高分：对读者有实际参考价值、技术深度、产业洞察
   - 低分：娱乐八卦、生活技巧、电影推荐、购物指南、鸡汤文

3. 信息密度 (0-100):
   - 高分：包含实质性内容、数据、分析
   - 低分：空洞、琐碎、PR稿、销量快讯、区域性数据

4. 时效性 (0-100):
   - 高分：最新事件、时事新闻、突发消息
   - 低分：旧闻、教程、资源汇总、历史回顾

5. 普适性 (0-100):
   - 高分：广泛受众感兴趣的话题
   - 低分：小众话题、区域性新闻、特定公司PR

【低价值内容特征（应该过滤）】
- 个人学习日志 (如: "My Journey Learning...")
- 个人周报 (如: "Weekly Update #XX")
- 内部社区通知 (如: "社区速递"、"征稿启事")
- 个人恩怨/诽谤 (如: "XXX诈骗"、"XXX destroyed it")
- 娱乐推荐 (如: "电影片单"、"这份清单")
- 购物导向 (如: "选购指南"、"值得关注的App")
- 公司PR稿 (如: "XX汽车销量创新高"、"XX融资")
- 琐碎数据 (如: "最忙服务区"、"城市房产数据")

【请返回以下JSON格式】
{
  "score": 综合评分(0-100),
  "category": "high" | "medium" | "low",
  "shouldFilter": true/false (建议60分以下过滤),
  "reason": "简要说明评分理由（50字内）",
  "dimensions": {
    "newsValue": 新闻性评分,
    "practicality": 实用性评分,
    "density": 信息密度评分,
    "timeliness": 时效性评分,
    "universality": 普适性评分
  },
  "tags": ["标签1", "标签2"] (如: ["技术新闻", "深度分析"] 或 ["个人博客", "低价值"])
}`;
  }

  /**
   * 解析评估结果
   */
  private parseEvaluationResult(result: any): QualityEvaluation {
    const score = Math.max(0, Math.min(100, result.score || 0));

    return {
      score,
      category: result.category || (score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'),
      shouldFilter: score < this.options.scoreThreshold,
      reason: result.reason || '无评估理由',
      dimensions: {
        newsValue: result.dimensions?.newsValue || 0,
        practicality: result.dimensions?.practicality || 0,
        density: result.dimensions?.density || 0,
        timeliness: result.dimensions?.timeliness || 0,
        universality: result.dimensions?.universality || 0
      },
      tags: Array.isArray(result.tags) ? result.tags : []
    };
  }

  /**
   * 备用评估（基于规则的快速判断）
   */
  private fallbackEvaluation(news: NewsInput): QualityEvaluation {
    console.log('⚠️ 使用备用规则评估');

    const title = news.title.toLowerCase();

    // 黑名单关键词
    const blacklistPatterns = [
      /社区速递|征稿|周报|剁手清单|派评/,
      /my.*journey|weekly update|learning.*log/i,
      /选购指南|值得关注|推荐清单/,
      /defraud|conspirator|destroyed/i,
      /销量.*新高|融资.*美元/,
    ];

    const isBlacklisted = blacklistPatterns.some(pattern => pattern.test(title));

    if (isBlacklisted) {
      return {
        score: 20,
        category: 'low',
        shouldFilter: true,
        reason: '命中黑名单规则',
        dimensions: {
          newsValue: 20,
          practicality: 20,
          density: 20,
          timeliness: 20,
          universality: 20
        },
        tags: ['低价值', '规则过滤']
      };
    }

    // 默认通过（保守策略）
    return {
      score: 65,
      category: 'medium',
      shouldFilter: false,
      reason: '备用规则：默认通过',
      dimensions: {
        newsValue: 65,
        practicality: 65,
        density: 65,
        timeliness: 65,
        universality: 65
      },
      tags: ['待评估']
    };
  }

  /**
   * 批量评估
   */
  async evaluateBatch(newsList: NewsInput[]): Promise<QualityEvaluation[]> {
    console.log(`📊 批量评估: ${newsList.length}条新闻`);

    const results = await Promise.all(
      newsList.map(news => this.evaluate(news))
    );

    const filtered = results.filter(r => r.shouldFilter).length;
    console.log(`✅ 批量评估完成: ${filtered}/${newsList.length} 条被过滤`);

    return results;
  }
}
