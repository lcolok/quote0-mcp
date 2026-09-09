export const CONTENT_QUALITY_SHADOW_VERSION = 'content-quality-shadow-v1' as const;

export type ContentQualityClass =
  | 'reported-news'
  | 'analysis'
  | 'technical-reading'
  | 'product-update'
  | 'community-post'
  | 'promo-event'
  | 'entertainment'
  | 'unknown';

export type ContentQualityRecommendation =
  | 'prefer-news'
  | 'allow-news'
  | 'route-reading'
  | 'route-product-update'
  | 'downrank-news'
  | 'needs-source-expansion';

export type ContentQualityReasonCode =
  | 'editorial-source'
  | 'thin-source-body'
  | 'hn-low-engagement'
  | 'hn-healthy-engagement'
  | 'community-tutorial'
  | 'community-self-promo'
  | 'vendor-product-update'
  | 'event-or-promo'
  | 'entertainment-oriented'
  | 'analysis-oriented';

export interface ContentQualityAssessment {
  version: typeof CONTENT_QUALITY_SHADOW_VERSION;
  mode: 'shadow';
  contentClass: ContentQualityClass;
  recommendation: ContentQualityRecommendation;
  reasons: ContentQualityReasonCode[];
  evidence: {
    inputChars: number;
    ageHours?: number;
    hnPoints?: number;
    hnComments?: number;
    linkHost?: string;
  };
}

export interface ContentQualityInput {
  sourceId?: string;
  title?: string;
  content?: string;
  link?: string;
  publishTime?: string;
  nowMs?: number;
}

const THIN_BODY_MAX_CHARS = 40;
const THIN_BODY_PATTERN = /^(点击查看原文[>》]?|查看全文|read more|continue reading|the post .* appeared first on .*?)\.?$/i;
const EVENT_OR_PROMO_PATTERN = /(AICon|大会|峰会|征文(?:活动)?|获奖(?:结果)?|报名|直播|训练营|课程|发布会|本周看什么|app\+1|线下活动|活动报名|活动获奖|活动结果)/i;
const ENTERTAINMENT_PATTERN = /(star wars|marvel|disney|trailer|movie|film|podcast|音乐|播客|电影|预告|明星|剧集|演唱会)/i;
const TUTORIAL_PATTERN = /(tutorial|guide|how to|one-liner|explained|deep dive|bloom filters?|designing|pattern|教程|指南|原理|入门|实践|详解)/i;
const SELF_PROMO_PATTERN = /(shipping\b|i built|i made|my app|my project|show dev\b|上架|发布我的|我做了|我开发)/i;
const ANALYSIS_PATTERN = /(analysis|why |how |report|research|study|survey|recap|review|分析|研究|调查|报告|复盘)/i;

function normalizeText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function parseAgeHours(publishTime: string | undefined, nowMs: number): number | undefined {
  if (!publishTime) return undefined;
  const published = new Date(publishTime).getTime();
  if (!Number.isFinite(published)) return undefined;
  return Math.max(0, (nowMs - published) / (60 * 60 * 1000));
}

function parseHackerNewsEngagement(content: string): { points?: number; comments?: number } {
  const points = content.match(/Points:\s*(\d+)/i);
  const comments = content.match(/#\s*Comments:\s*(\d+)/i);
  return {
    points: points ? Number(points[1]) : undefined,
    comments: comments ? Number(comments[1]) : undefined,
  };
}

function getLinkHost(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isThinSourceBody(content: string): boolean {
  if (!content) return true;
  if (THIN_BODY_PATTERN.test(content)) return true;
  return content.length <= THIN_BODY_MAX_CHARS;
}

export function assessContentQuality(input: ContentQualityInput): ContentQualityAssessment {
  const nowMs = input.nowMs ?? Date.now();
  const sourceId = (input.sourceId || '').toLowerCase();
  const title = normalizeText(input.title);
  const content = normalizeText(input.content);
  const combined = `${title} ${content}`.trim();
  // 自荐信号只看标题与开头导语。长文正文里出现“shipping / I built”等普通叙述，
  // 不能据此把整篇误判为项目宣传。
  const selfPromoProbe = `${title} ${content.slice(0, 320)}`.trim();
  const reasons: ContentQualityReasonCode[] = [];
  const ageHours = parseAgeHours(input.publishTime, nowMs);
  const evidence: ContentQualityAssessment['evidence'] = {
    inputChars: content.length,
    ageHours,
    linkHost: getLinkHost(input.link),
  };

  let contentClass: ContentQualityClass = 'unknown';
  let recommendation: ContentQualityRecommendation = 'allow-news';

  if (sourceId === 'hackernews') {
    const engagement = parseHackerNewsEngagement(content);
    evidence.hnPoints = engagement.points;
    evidence.hnComments = engagement.comments;

    const lowEngagement =
      ageHours !== undefined && ageHours >= 1 &&
      engagement.points !== undefined && engagement.comments !== undefined &&
      engagement.points < 10 && engagement.comments < 3;

    const looksLikeProject = Boolean(evidence.linkHost && (
      evidence.linkHost === 'github.com' ||
      evidence.linkHost.endsWith('.vercel.app') ||
      evidence.linkHost.endsWith('.netlify.app')
    ));

    if (lowEngagement) {
      reasons.push('hn-low-engagement');
      recommendation = 'downrank-news';
      contentClass = looksLikeProject ? 'community-post' : 'reported-news';
    } else {
      reasons.push('hn-healthy-engagement');
      contentClass = looksLikeProject ? 'community-post' : 'reported-news';
      recommendation = looksLikeProject ? 'route-reading' : 'prefer-news';
    }
  } else if (sourceId === 'dev-to') {
    if (SELF_PROMO_PATTERN.test(selfPromoProbe)) {
      contentClass = 'community-post';
      recommendation = 'downrank-news';
      reasons.push('community-self-promo');
    } else {
      contentClass = 'technical-reading';
      recommendation = 'route-reading';
      if (TUTORIAL_PATTERN.test(combined)) reasons.push('community-tutorial');
    }
  } else if (sourceId === 'github-changelog' || sourceId === 'cloudflare-blog') {
    contentClass = 'product-update';
    recommendation = 'route-product-update';
    reasons.push('vendor-product-update');
  } else if (sourceId === 'sspai') {
    contentClass = ANALYSIS_PATTERN.test(combined) ? 'analysis' : 'reported-news';
    recommendation = 'route-reading';
    if (EVENT_OR_PROMO_PATTERN.test(combined)) {
      contentClass = 'promo-event';
      recommendation = 'downrank-news';
      reasons.push('event-or-promo');
    } else if (ENTERTAINMENT_PATTERN.test(combined)) {
      contentClass = 'entertainment';
      recommendation = 'downrank-news';
      reasons.push('entertainment-oriented');
    } else if (contentClass === 'analysis') {
      reasons.push('analysis-oriented');
    }
  } else if (sourceId === 'solidot' || sourceId === 'arstechnica' || sourceId === 'infoq-cn') {
    contentClass = ANALYSIS_PATTERN.test(combined) ? 'analysis' : 'reported-news';
    recommendation = 'prefer-news';
    reasons.push('editorial-source');
    if (EVENT_OR_PROMO_PATTERN.test(combined)) {
      contentClass = 'promo-event';
      recommendation = 'downrank-news';
      reasons.push('event-or-promo');
    } else if (contentClass === 'analysis') {
      reasons.push('analysis-oriented');
    }
  } else if (EVENT_OR_PROMO_PATTERN.test(combined)) {
    contentClass = 'promo-event';
    recommendation = 'downrank-news';
    reasons.push('event-or-promo');
  } else if (ENTERTAINMENT_PATTERN.test(combined)) {
    contentClass = 'entertainment';
    recommendation = 'downrank-news';
    reasons.push('entertainment-oriented');
  } else if (TUTORIAL_PATTERN.test(combined)) {
    contentClass = 'technical-reading';
    recommendation = 'route-reading';
    reasons.push('community-tutorial');
  } else if (ANALYSIS_PATTERN.test(combined)) {
    contentClass = 'analysis';
    recommendation = 'allow-news';
    reasons.push('analysis-oriented');
  }

  if (isThinSourceBody(content)) {
    reasons.push('thin-source-body');
    recommendation = 'needs-source-expansion';
  }

  return {
    version: CONTENT_QUALITY_SHADOW_VERSION,
    mode: 'shadow',
    contentClass,
    recommendation,
    reasons: Array.from(new Set(reasons)),
    evidence,
  };
}
