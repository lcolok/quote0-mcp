/**
 * Versioned prompt-profile processor.
 *
 * The historical filename and class alias are intentionally retained because
 * persisted scheduler jobs still refer to `ax-optimized`. The runtime does not
 * invoke AX optimizers: it loads a reviewed prompt profile and makes one
 * OpenAI-compatible request per article.
 */

import { Pool } from 'pg';
import { LLMCallCache } from '../core/llm-call-cache.js';

export interface PromptExample {
  input: { newsContent: string };
  output: { optimizedTitle?: string; summary?: string };
  /** Legacy artifacts may contain this unverified field; runtime ignores it. */
  score?: number;
}

export interface PromptProgram {
  instruction: string;
  demos: PromptExample[];
  modelConfig: {
    temperature: number;
    topP?: number;
    maxTokens?: number;
  };
  stats?: {
    /** Legacy metadata only. It is never exposed as measured quality. */
    trained?: boolean;
    version?: string;
    accuracy?: number;
    compliance?: number;
    exampleCount?: number;
    validated?: boolean;
  };
}

export const EVIDENCE_BOUNDED_DIRECT_PROFILE_VERSION = 'evidence-bounded-direct/v1';

const EVIDENCE_BOUNDED_NEWS_CONTRACT = `证据约束（高优先级，覆盖示例中的任何冲突）：\n- 只能使用“输入”中明确出现的事实，不得调用外部知识、记忆或常识补全。\n- 禁止新增输入中没有的日期/年份、金额、百分比、版本号、数量、人物身份、因果关系、预测或结论。\n- 可以压缩、重排和改写措辞，但不得提高事实强度；“称/据报/计划/可能”不能改写成“证实/已完成/必然”。\n- 输入证据不足时宁可更短，不要把标题扩写成看似完整的新闻。\n- 只输出最终标题或摘要本身，不要解释规则。`;

export interface PromptProfileArtifact {
  version: string;
  programs: {
    titleProgram: PromptProgram;
    summaryProgram: PromptProgram;
  };
  metadata?: {
    createdAt?: string;
    trainedAt?: string;
    framework?: string;
    optimizationType?: string;
    profileType?: string;
    source?: string;
    trainingDuration?: number;
    totalExamplesTested?: number;
    finalPerformance?: number;
  };
}

// Compatibility type exports used by older scripts.
export type OptimizedProgram = PromptProgram;
export type OptimizationArtifacts = PromptProfileArtifact;

export interface PromptProfileResult {
  title: string;
  body: string;
  footer: string;
  optimizationUsed: boolean;
  generationProfileVersion: string;
  profileVersion: string;
  /** Mechanical length compliance, not a semantic quality score. */
  constraintCompliance: number;
}

const DEFAULT_TITLE_LIMIT = 20;
const DEFAULT_SUMMARY_LIMIT = 200;

function characterLength(value: string): number {
  return Array.from(value).length;
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1);
  if (!source || !source.includes('{')) return null;

  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Parse a strict JSON response while accepting a labelled-line fallback. */
export function parsePromptProfileResponse(value: string): { title: string; summary: string } {
  const json = extractJsonObject(value);
  const jsonTitle = json?.title;
  const jsonSummary = json?.summary;
  if (typeof jsonTitle === 'string' && jsonTitle.trim() && typeof jsonSummary === 'string' && jsonSummary.trim()) {
    return { title: jsonTitle.trim(), summary: jsonSummary.trim() };
  }

  const title = value.match(/(?:^|\n)\s*(?:标题|title)\s*[:：]\s*(.+)/i)?.[1]?.trim();
  const summary = value.match(/(?:^|\n)\s*(?:摘要|summary)\s*[:：]\s*([\s\S]+)/i)?.[1]?.trim();
  if (title && summary) return { title, summary };

  throw new Error('LLM响应缺少可解析的 title/summary JSON 字段');
}

export class PromptProfileNewsProcessor {
  private promptProfile: PromptProfileArtifact['programs'] | null = null;
  private currentVersion = 'unknown';
  private llmCache: LLMCallCache | null;

  constructor(private options: {
    apiKey: string;
    baseURL: string;
    model: string;
    pool?: Pool;
  }) {
    this.llmCache = options.pool ? new LLMCallCache(options.pool) : null;
  }

  async loadPromptProfile(filename: string): Promise<boolean> {
    const fs = await import('fs/promises');
    const path = `${process.cwd()}/${filename}`;

    try {
      const data = await fs.readFile(path, 'utf-8');
      const artifact = JSON.parse(data) as PromptProfileArtifact;
      return this.loadFromModelData(artifact);
    } catch (error) {
      console.error(`❌ 加载提示配置失败: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  /** @deprecated Use loadPromptProfile. */
  async loadOptimizationArtifacts(filename: string): Promise<boolean> {
    return this.loadPromptProfile(filename);
  }

  loadFromModelData(artifact: PromptProfileArtifact): boolean {
    try {
      if (!artifact?.programs?.titleProgram?.instruction || !artifact?.programs?.summaryProgram?.instruction) {
        throw new Error('提示配置缺少 titleProgram 或 summaryProgram');
      }
      this.promptProfile = artifact.programs;
      this.currentVersion = artifact.version || 'unknown';
      const exampleCount = artifact.programs.titleProgram.demos.length + artifact.programs.summaryProgram.demos.length;
      console.log(`✅ 已加载提示配置 ${this.currentVersion}（${exampleCount} 个示例；未声明质量分）`);
      return true;
    } catch (error) {
      console.error(`❌ 加载提示配置失败: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  getCurrentVersion(): string {
    return this.currentVersion;
  }

  async processNewsWithPromptProfile(newsContent: string): Promise<PromptProfileResult> {
    if (!this.promptProfile) throw new Error('请先加载提示配置');

    const titleProgram = this.promptProfile.titleProgram;
    const summaryProgram = this.promptProfile.summaryProgram;
    const prompt = this.buildCombinedPrompt(titleProgram, summaryProgram, newsContent);
    const temperature = Math.min(titleProgram.modelConfig.temperature, summaryProgram.modelConfig.temperature);
    const maxTokens = Math.max(
      titleProgram.modelConfig.maxTokens ?? 100,
      summaryProgram.modelConfig.maxTokens ?? 512,
    );

    try {
      const cacheKey = { prompt, model: this.options.model, temperature };
      const cached = this.llmCache ? await this.llmCache.get(cacheKey) : null;
      let responseText: string;

      if (cached) {
        console.log('💾 提示配置缓存命中');
        responseText = cached.response;
      } else {
        const { OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey: this.options.apiKey, baseURL: this.options.baseURL });
        const response = await client.chat.completions.create({
          model: this.options.model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          top_p: Math.min(titleProgram.modelConfig.topP ?? 0.9, summaryProgram.modelConfig.topP ?? 0.9),
          max_tokens: maxTokens,
        });
        responseText = response.choices[0]?.message?.content?.trim() || '';
        if (!responseText) throw new Error('LLM未返回内容处理结果');
      }

      const parsed = parsePromptProfileResponse(responseText);
      // Only cache structurally valid output; malformed JSON must not poison
      // every future request for the same article/profile/model tuple.
      if (!cached && this.llmCache) await this.llmCache.set(cacheKey, responseText);
      const constraintCompliance = (
        Number(characterLength(parsed.title) <= DEFAULT_TITLE_LIMIT)
        + Number(characterLength(parsed.summary) <= DEFAULT_SUMMARY_LIMIT)
      ) / 2;

      console.log(`✅ 提示配置处理完成: 标题 ${characterLength(parsed.title)} 字，摘要 ${characterLength(parsed.summary)} 字`);
      return {
        title: parsed.title,
        body: parsed.summary,
        footer: '提示配置处理',
        optimizationUsed: true,
        generationProfileVersion: EVIDENCE_BOUNDED_DIRECT_PROFILE_VERSION,
        profileVersion: this.currentVersion,
        constraintCompliance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      if (message.includes('401') || message.includes('Unauthorized')) {
        throw new Error(`LLM API认证失败: ${message} (请检查API密钥是否正确)`);
      }
      if (message.includes('404') || message.includes('Not Found')) {
        throw new Error(`LLM服务未找到: ${message} (请检查baseURL和模型名称)`);
      }
      if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
        throw new Error(`LLM服务超时: ${message} (请检查网络连接和服务状态)`);
      }
      if (message.includes('rate limit') || message.includes('429')) {
        throw new Error(`LLM API调用频率限制: ${message} (请稍后重试)`);
      }
      if (message.includes('ECONNREFUSED') || message.includes('Connection error') || message.includes('UND_ERR_SOCKET')) {
        throw new Error(`无法连接LLM服务: ${message} (请检查baseURL: ${this.options.baseURL})`);
      }
      throw new Error(`LLM提示配置处理失败: ${message} (端点: ${this.options.baseURL})`);
    }
  }

  /**
   * @deprecated Use processNewsWithPromptProfile.
   */
  async processNewsWithOptimizedProgram(newsContent: string): Promise<PromptProfileResult> {
    return this.processNewsWithPromptProfile(newsContent);
  }

  createProfileFromExamples(trainingData: Array<{
    newsContent: string;
    expectedTitle: string;
    expectedSummary: string;
  }>): { success: true; titleExamples: number; summaryExamples: number } {
    const titleDemos = trainingData.slice(0, 5).map((item) => ({
      input: { newsContent: item.newsContent },
      output: { optimizedTitle: item.expectedTitle },
    }));
    const summaryDemos = trainingData.slice(0, 3).map((item) => ({
      input: { newsContent: item.newsContent },
      output: { summary: item.expectedSummary },
    }));

    this.promptProfile = {
      titleProgram: {
        instruction: '将新闻内容改写为准确、简洁的标题，严格控制在20字符以内，不得补充输入中没有的事实',
        demos: titleDemos,
        modelConfig: { temperature: 0.3, topP: 0.9, maxTokens: 100 },
        stats: { trained: false, version: 'profile-v1', exampleCount: titleDemos.length, validated: false },
      },
      summaryProgram: {
        instruction: '将新闻内容提炼为200字符以内的摘要，只保留输入中明确出现的事实',
        demos: summaryDemos,
        modelConfig: { temperature: 0.3, topP: 0.9, maxTokens: 512 },
        stats: { trained: false, version: 'profile-v1', exampleCount: summaryDemos.length, validated: false },
      },
    };
    this.currentVersion = 'profile-v1';
    return { success: true, titleExamples: titleDemos.length, summaryExamples: summaryDemos.length };
  }

  /** @deprecated This creates a prompt profile; it does not train a model. */
  async quickTrain(trainingData: Array<{
    newsContent: string;
    expectedTitle: string;
    expectedSummary: string;
  }>) {
    console.warn('⚠️ quickTrain 已弃用：当前操作仅创建 few-shot 提示配置，不产生准确率指标');
    return this.createProfileFromExamples(trainingData);
  }

  private buildCombinedPrompt(titleProgram: PromptProgram, summaryProgram: PromptProgram, newsContent: string): string {
    const renderExamples = (examples: PromptExample[], field: 'optimizedTitle' | 'summary') => examples
      .map((demo, index) => {
        const output = demo.output[field];
        return output ? `示例${index + 1}\n输入：${demo.input.newsContent}\n输出：${output}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    return [
      EVIDENCE_BOUNDED_NEWS_CONTRACT,
      '你是新闻内容编辑。一次完成标题与摘要，禁止引入输入中没有的实体、数字或事件。',
      `标题规则：${titleProgram.instruction}`,
      `摘要规则：${summaryProgram.instruction}`,
      titleProgram.demos.length ? `标题示例：\n${renderExamples(titleProgram.demos.slice(0, 3), 'optimizedTitle')}` : '',
      summaryProgram.demos.length ? `摘要示例：\n${renderExamples(summaryProgram.demos.slice(0, 2), 'summary')}` : '',
      `待处理内容：\n${newsContent}`,
      '仅返回一个 JSON 对象，不要 Markdown：{"title":"...","summary":"..."}',
    ].filter(Boolean).join('\n\n');
  }
}

/**
 * @deprecated Compatibility alias. The implementation is a prompt profile,
 * not an AX optimization/training runtime.
 */
export class AxOptimizedNewsProcessorSimplified extends PromptProfileNewsProcessor {}
