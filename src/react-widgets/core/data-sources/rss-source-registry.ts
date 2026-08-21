export type RSSSourceProfile = 'core' | 'extended' | 'legacy';

export interface RSSSourceDefinition {
  id: string;
  name: string;
  url: string;
  category: string;
  description: string;
  profile: RSSSourceProfile;
  /** Optional source-specific fetch timeout; default comes from RSS_FETCH_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Optional runtime URL override. Useful for moving a relay without rebuilding Quote0. */
  urlEnvVar?: string;
}

/**
 * RSS source single source of truth.
 *
 * `profile` is a product/default-pool classification, not a permanent health
 * promise. Runtime failures are handled by the scheduler source cooldown.
 */
export const RSS_SOURCE_REGISTRY: Record<string, RSSSourceDefinition> = {
  // Balanced core pool: Chinese + global + developer/product updates.
  solidot: {
    id: 'solidot',
    name: 'Solidot',
    url: 'http://100.94.204.103:8899/solidot.rss',
    category: 'technology',
    description: '奇客的资讯，重要的东西',
    profile: 'core',
    urlEnvVar: 'SOLIDOT_RSS_URL',
  },
  sspai: {
    id: 'sspai',
    name: '少数派',
    url: 'https://sspai.com/feed',
    category: 'technology',
    description: '高效工作，品质生活',
    profile: 'core',
  },
  hackernews: {
    id: 'hackernews',
    name: 'Hacker News',
    url: 'https://hnrss.org/frontpage',
    category: 'technology',
    description: 'Hacker News 首页热门文章',
    profile: 'core',
    timeoutMs: 12_000,
  },
  arstechnica: {
    id: 'arstechnica',
    name: 'Ars Technica',
    url: 'http://feeds.arstechnica.com/arstechnica/index',
    category: 'technology',
    description: '深度科技分析',
    profile: 'core',
  },
  'infoq-cn': {
    id: 'infoq-cn',
    name: 'InfoQ 中文',
    url: 'https://www.infoq.cn/feed',
    category: 'technology',
    description: '软件、AI、云与架构技术资讯',
    profile: 'core',
  },
  'the-verge': {
    id: 'the-verge',
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'technology',
    description: '消费科技、AI 与互联网产品资讯',
    profile: 'extended',
  },
  'dev-to': {
    id: 'dev-to',
    name: 'DEV Community',
    url: 'https://dev.to/feed',
    category: 'programming',
    description: '开发者技术分享',
    profile: 'core',
  },
  'github-changelog': {
    id: 'github-changelog',
    name: 'GitHub Changelog',
    url: 'https://github.blog/changelog/feed/',
    category: 'programming',
    description: 'GitHub 与 Copilot 产品更新',
    profile: 'core',
  },

  // Extended sources: healthy/useful but intentionally not in the balanced
  // default pool to avoid over-weighting a single vendor or low-frequency feed.
  'cloudflare-blog': {
    id: 'cloudflare-blog',
    name: 'Cloudflare Blog',
    url: 'https://blog.cloudflare.com/rss/',
    category: 'technology',
    description: '网络、安全、基础设施与 AI 工程',
    profile: 'core',
  },
  'openai-news': {
    id: 'openai-news',
    name: 'OpenAI News',
    url: 'https://openai.com/news/rss.xml',
    category: 'technology',
    description: 'OpenAI 产品、研究与公司动态',
    profile: 'extended',
  },
  ruanyifeng: {
    id: 'ruanyifeng',
    name: '科技爱好者周刊',
    url: 'https://www.ruanyifeng.com/blog/atom.xml',
    category: 'programming',
    description: '阮一峰科技爱好者周刊',
    profile: 'extended',
  },

  // Legacy sources stay addressable for existing DB configs, but are not part
  // of the recommended pool. Their runtime availability can change.
  cnbeta: {
    id: 'cnbeta',
    name: 'cnBeta',
    url: 'https://www.cnbeta.com/backend.php',
    category: 'technology',
    description: '中文业界资讯站',
    profile: 'legacy',
  },
  techcrunch: {
    id: 'techcrunch',
    name: 'TechCrunch',
    url: 'https://feeds.feedburner.com/TechCrunch',
    category: 'technology',
    description: '全球科技创业资讯',
    profile: 'legacy',
  },
  '36kr': {
    id: '36kr',
    name: '36氪',
    url: 'https://36kr.com/feed',
    category: 'business',
    description: '创投媒体平台',
    profile: 'legacy',
  },
  'reuters-tech': {
    id: 'reuters-tech',
    name: 'Reuters Tech',
    url: 'https://feeds.reuters.com/reuters/technologyNews',
    category: 'business',
    description: '路透社科技新闻',
    profile: 'legacy',
  },
  'designer-news': {
    id: 'designer-news',
    name: 'Designer News',
    url: 'https://www.designernews.co/feeds/stories',
    category: 'design',
    description: '设计师资讯平台',
    profile: 'legacy',
  },
  'github-trending': {
    id: 'github-trending',
    name: 'GitHub Trending',
    url: 'https://rsshub.app/github/trending/daily',
    category: 'programming',
    description: 'GitHub 热门项目（公共 RSSHub）',
    profile: 'legacy',
  },
};

export const RECOMMENDED_RSS_SOURCE_IDS = Object.values(RSS_SOURCE_REGISTRY)
  .filter((source) => source.profile === 'core')
  .map((source) => source.id);

function resolveRuntimeSource(
  source: RSSSourceDefinition,
  env: Record<string, string | undefined> = process.env,
): RSSSourceDefinition {
  const override = source.urlEnvVar ? env[source.urlEnvVar]?.trim() : '';
  if (!override) return { ...source };
  try {
    const parsed = new URL(override);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ...source };
    return { ...source, url: parsed.toString() };
  } catch {
    return { ...source };
  }
}

export function getRssSourceDefinition(
  id: string,
  env: Record<string, string | undefined> = process.env,
): RSSSourceDefinition | undefined {
  const source = RSS_SOURCE_REGISTRY[id];
  return source ? resolveRuntimeSource(source, env) : undefined;
}

export function getRssSourceRegistry(
  env: Record<string, string | undefined> = process.env,
): Record<string, RSSSourceDefinition> {
  return Object.fromEntries(
    Object.entries(RSS_SOURCE_REGISTRY).map(([id, source]) => [id, resolveRuntimeSource(source, env)]),
  );
}
