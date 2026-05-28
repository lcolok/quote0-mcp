/**
 * 已下线 / 失效的 RSS 源清单（单一事实来源）
 *
 * 当某个 RSS 源服务器侧永久失效时，把它的 id 加到这里。
 * - postgres-database.ts 的 seed runner 会在每次启动时把这些 id 从所有
 *   news_scheduler_jobs.rss_sources 里幂等剔除（Layer A 根治存量）。
 * - startup-assertions.ts 会断言没有任何 enabled job 仍引用这些源（Layer C 护栏）。
 *
 * 注意：把源从这里登记，比仅在 news-api-server.ts 的 RSS_SOURCES 注册表里注释更彻底，
 * 因为注释只防新建 job，不动 DB 已存在 job 的持久化字段。
 */
export const DECOMMISSIONED_RSS_SOURCES: readonly string[] = [
  'pingwest', // 2026-05 失效：返回伪 200 真 404（<title>404-页面不存在</title>）
];
