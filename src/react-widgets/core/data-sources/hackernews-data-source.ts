/**
 * Hacker News数据源模块
 * 从Hacker News API获取热门科技文章和讨论
 */

import { BaseDataSourceModule } from './base-data-source.js';
import { 
  RawDataItem, 
  DataSourceParams, 
  DataSourceParamDefinition,
  DataSourceHealthStatus 
} from '../modular-architecture.js';

export class HackerNewsDataSourceModule extends BaseDataSourceModule {
  name = 'Hacker News数据源';
  version = '1.0.0';
  description = '从Hacker News API获取热门科技新闻和讨论';
  
  async fetchRawData(params: DataSourceParams): Promise<RawDataItem[]> {
    const count = Math.min(params.count || 10, 50);
    const startIndex = params.startIndex || 0;
    
    console.log(`📡 Hacker News数据源获取: (从${startIndex}开始，获取${count}条)`);
    
    try {
      const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
      if (!response.ok) {
        throw new Error(`Hacker News API请求失败: ${response.status}`);
      }
      
      const storyIds: number[] = await response.json();
      const targetIds = storyIds.slice(startIndex, startIndex + count);
      
      const stories = await Promise.all(
        targetIds.map(async (id) => {
          try {
            const storyResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
            if (!storyResponse.ok) return null;
            return await storyResponse.json();
          } catch {
            return null;
          }
        })
      );
      
      const validStories = stories.filter(story => 
        story && story.type === 'story' && story.title && !story.deleted && !story.dead
      );
      
      const rawDataItems: RawDataItem[] = validStories.map(story => ({
        id: `hn_${story.id}`,
        title: story.title,
        content: this.generateContent(story),
        source: 'Hacker News',
        publishTime: new Date(story.time * 1000).toISOString(),
        category: this.categorizeStory(story.title, story.url),
        link: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
        metadata: {
          score: story.score,
          comments: story.descendants || 0,
          author: story.by,
          hnId: story.id,
          hnUrl: `https://news.ycombinator.com/item?id=${story.id}`
        }
      }));
      
      console.log(`✅ Hacker News数据源获取成功: ${rawDataItems.length}条数据`);
      return rawDataItems;
      
    } catch (error) {
      console.error('❌ Hacker News数据源获取失败:', error);
      throw new Error(`Hacker News数据源获取失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
  
  private generateContent(story: any): string {
    const parts: string[] = [];
    
    if (story.score) parts.push(`👍 ${story.score}分`);
    if (story.descendants) parts.push(`💬 ${story.descendants}条评论`);
    if (story.by) parts.push(`📝 作者：${story.by}`);
    
    if (story.url) {
      try {
        const domain = new URL(story.url).hostname.replace('www.', '');
        parts.push(`🔗 来源：${domain}`);
      } catch {}
    }
    
    const publishDate = new Date(story.time * 1000);
    const hoursAgo = Math.round((Date.now() - publishDate.getTime()) / (1000 * 60 * 60));
    if (hoursAgo < 24) {
      parts.push(`⏰ ${hoursAgo}小时前`);
    } else {
      parts.push(`📅 ${Math.round(hoursAgo / 24)}天前`);
    }
    
    return parts.join(' • ');
  }
  
  private categorizeStory(title: string, url?: string): string {
    const lowerTitle = title.toLowerCase();
    const lowerUrl = url?.toLowerCase() || '';
    
    if (lowerTitle.includes('ai') || lowerTitle.includes('gpt') || lowerTitle.includes('llm')) return 'ai';
    if (lowerTitle.includes('python') || lowerTitle.includes('javascript') || lowerTitle.includes('programming')) return 'programming';
    if (lowerTitle.includes('startup') || lowerTitle.includes('funding')) return 'business';
    if (lowerTitle.includes('security') || lowerTitle.includes('hack')) return 'security';
    if (lowerUrl.includes('github.com')) return 'programming';
    
    return 'technology';
  }
  
  getSupportedParams(): DataSourceParamDefinition[] {
    return [
      {
        name: 'count',
        type: 'number',
        required: false,
        defaultValue: 10,
        description: '获取文章数量 (1-50)',
        validation: (value: number) => value >= 1 && value <= 50
      },
      {
        name: 'startIndex',
        type: 'number',
        required: false,
        defaultValue: 0,
        description: '起始索引位置',
        validation: (value: number) => value >= 0
      }
    ];
  }
  
  async getHealthStatus(): Promise<DataSourceHealthStatus> {
    const startTime = Date.now();
    
    try {
      const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
      const responseTime = Date.now() - startTime;
      
      if (!response.ok) {
        return {
          healthy: false,
          message: `Hacker News API不可用 (${response.status})`,
          lastChecked: new Date().toISOString(),
          responseTime,
          dataQuality: 0
        };
      }
      
      const storyIds = await response.json();
      
      return {
        healthy: true,
        message: `Hacker News API正常 (${storyIds.length}条热门文章)`,
        lastChecked: new Date().toISOString(),
        responseTime,
        dataQuality: storyIds.length > 100 ? 100 : 80,
        additionalInfo: {
          availableStories: storyIds.length,
          apiEndpoint: 'hacker-news.firebaseio.com'
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        message: `Hacker News API异常: ${error instanceof Error ? error.message : '未知错误'}`,
        lastChecked: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        dataQuality: 0
      };
    }
  }
}