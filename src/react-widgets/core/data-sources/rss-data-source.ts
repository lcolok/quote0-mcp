/**
 * RSS数据源模块
 * 支持多个预设RSS订阅源的管理和获取
 */

import { BaseDataSourceModule } from './base-data-source.js';
import { 
  RawDataItem, 
  DataSourceParams, 
  DataSourceParamDefinition,
  DataSourceHealthStatus 
} from '../modular-architecture.js';
import {
  getRssSourceRegistry,
  type RSSSourceDefinition,
} from './rss-source-registry.js';

const MAX_FUTURE_PUBLISH_SKEW_MS = 5 * 60 * 1000;

export function normalizeRssPublishTime(raw: string | undefined, nowMs = Date.now()): {
  publishTime: string;
  rawPublishTime?: string;
  futureClamped: boolean;
} {
  if (!raw) return { publishTime: new Date(nowMs).toISOString(), futureClamped: false };
  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) {
    return { publishTime: new Date(nowMs).toISOString(), rawPublishTime: raw, futureClamped: false };
  }
  if (parsed > nowMs + MAX_FUTURE_PUBLISH_SKEW_MS) {
    return { publishTime: new Date(nowMs).toISOString(), rawPublishTime: raw, futureClamped: true };
  }
  return { publishTime: new Date(parsed).toISOString(), rawPublishTime: raw, futureClamped: false };
}

export class RSSDataSourceModule extends BaseDataSourceModule {
  name = 'RSS数据源';
  version = '1.0.0';
  description = '从多个RSS订阅源获取新闻数据';
  
  // 每个实例持有可变副本，避免 addFeed() 污染全局 registry。
  private rssFeeds: Record<string, RSSSourceDefinition> = getRssSourceRegistry();
  
  async fetchRawData(params: DataSourceParams): Promise<RawDataItem[]> {
    const Parser = (await import('rss-parser')).default;
    
    // 支持通过source参数选择预设订阅源，或直接指定url
    let rssUrl: string;
    let sourceName: string;
    let defaultCategory: string;
    let sourceTimeoutMs: number | undefined;
    
    if (params.source && this.rssFeeds[params.source]) {
      const feed = this.rssFeeds[params.source];
      rssUrl = feed.url;
      sourceName = feed.name;
      defaultCategory = feed.category;
      sourceTimeoutMs = feed.timeoutMs;
    } else {
      rssUrl = params.url || this.rssFeeds.solidot.url;
      sourceName = 'RSS源';
      defaultCategory = '新闻';
    }

    const defaultTimeoutMs = Math.max(1000, Number(process.env.RSS_FETCH_TIMEOUT_MS ?? '8000'));
    const parser = new Parser({
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ModularNewsWidget/1.0)'
      },
      // 默认 fail-fast；对已实测存在长尾的源允许 registry 做局部放宽。
      timeout: Math.max(1000, sourceTimeoutMs ?? defaultTimeoutMs),
    });
    
    const count = params.count || 10;
    const startIndex = params.startIndex || 0;
    const category = params.category || defaultCategory;
    
    console.log(`📡 RSS数据源获取: ${sourceName} (${rssUrl}) 从${startIndex}开始，获取${count}条`);
    
    try {
      const feed = await parser.parseURL(rssUrl);
      
      if (!feed.items || feed.items.length === 0) {
        throw new Error(`RSS源 ${sourceName} 没有找到新闻条目`);
      }
      
      const endIndex = Math.min(startIndex + count, feed.items.length);
      const selectedItems = feed.items.slice(startIndex, endIndex);
      
      const nowMs = Date.now();
      const rawDataItems: RawDataItem[] = selectedItems.map((item, index) => {
        const normalizedTime = normalizeRssPublishTime(item.pubDate, nowMs);
        return {
          id: `rss_${params.source || 'custom'}_${startIndex + index}_${nowMs}`,
          title: item.title || '无标题',
          content: this.cleanContent(item.contentSnippet || item.content || item.description || ''),
          source: feed.title || sourceName,
          publishTime: normalizedTime.publishTime,
          link: item.link,
          category,
          metadata: {
            rssUrl,
            rssSource: params.source || 'custom',
            originalIndex: startIndex + index,
            guid: item.guid,
            rawPublishTime: normalizedTime.rawPublishTime,
            publishTimeFutureClamped: normalizedTime.futureClamped,
          }
        };
      });
      
      console.log(`✅ RSS数据源获取成功: ${rawDataItems.length}条数据 来自 ${sourceName}`);
      return rawDataItems;
      
    } catch (error) {
      console.error(`RSS数据源获取失败 (${sourceName}):`, error);
      throw new Error(`RSS数据获取失败 (${sourceName}): ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
  
  getSupportedParams(): DataSourceParamDefinition[] {
    return [
      {
        name: 'source',
        type: 'string',
        required: false,
        description: '预设RSS订阅源',
        choices: Object.keys(this.rssFeeds),
        defaultValue: 'solidot'
      },
      {
        name: 'url',
        type: 'string',
        required: false,
        description: '自定义RSS订阅地址（不使用预设源时）'
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
        description: '覆盖默认新闻分类'
      }
    ];
  }
  
  private cleanContent(content: string): string {
    // 清理HTML标签和多余空白
    return content
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  /**
   * 获取所有预设RSS订阅源信息
   */
  getAvailableFeeds(): Record<string, RSSSourceDefinition> {
    return { ...this.rssFeeds };
  }
  
  /**
   * 添加新的RSS订阅源
   */
  addFeed(key: string, source: RSSSourceDefinition): void {
    this.rssFeeds[key] = source;
  }
  
  async getHealthStatus(): Promise<DataSourceHealthStatus> {
    const startTime = Date.now();
    const feedKey = 'solidot';
    const testFeed = this.rssFeeds[feedKey];
    const timeoutMs = Math.min(Number(process.env.MODULE_HEALTH_TIMEOUT_MS ?? '5000'), 4000);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(testFeed.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'ModularNewsWidget/1.0 (+https://quote0.local/rss-health)'
        },
        signal: controller.signal
      });

      const responseTime = Date.now() - startTime;
      const bodySnippet = await response.text().then((content) => content.slice(0, 512)).catch(() => '');
      const hasItems = bodySnippet.includes('<item') || bodySnippet.includes('<entry');

      if (!response.ok) {
        return {
          healthy: false,
          message: `RSS源响应异常 (${response.status})`,
          lastChecked: new Date().toISOString(),
          responseTime,
          dataQuality: 0,
          connectionStatus: 'error',
          additionalInfo: {
            statusCode: response.status,
            feedKey,
            url: testFeed.url
          }
        };
      }

      return {
        healthy: true,
        message: `RSS源可访问 (${Object.keys(this.rssFeeds).length}个预设源)`,
        lastChecked: new Date().toISOString(),
        responseTime,
        dataQuality: hasItems ? 100 : 60,
        connectionStatus: 'connected',
        additionalInfo: {
          availableFeeds: Object.keys(this.rssFeeds).length,
          presetSources: Object.keys(this.rssFeeds),
          testSource: feedKey,
          statusCode: response.status,
          bodyPreview: bodySnippet
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = timedOut
        ? `RSS源在 ${timeoutMs}ms 内未响应`
        : `RSS数据源异常: ${error instanceof Error ? error.message : '未知错误'}`;
      return {
        healthy: false,
        message,
        lastChecked: new Date().toISOString(),
        responseTime: duration,
        dataQuality: 0,
        connectionStatus: 'error',
        additionalInfo: {
          feedKey,
          url: testFeed.url,
          timedOut
        }
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

