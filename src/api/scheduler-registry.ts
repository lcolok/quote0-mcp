import { NewsScheduler, buildSchedulerFromDatabase } from './news-scheduler.js';

let schedulerPromise: Promise<NewsScheduler | null> | null = null;

export function ensureSchedulerStarted(): Promise<NewsScheduler | null> {
  if (!schedulerPromise) {
    schedulerPromise = buildSchedulerFromDatabase().catch((error) => {
      console.error('❌ 启动新闻调度器失败:', error);
      return null;
    });
  }
  return schedulerPromise;
}

export async function getSchedulerInstance(): Promise<NewsScheduler | null> {
  return schedulerPromise ?? null;
}

export function resetSchedulerForTests() {
  schedulerPromise = null;
}
