import { NewsScheduler, buildSchedulerFromDatabase } from './news-scheduler.js';

let schedulerPromise: Promise<NewsScheduler | null> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function ensureSchedulerStarted(): Promise<NewsScheduler | null> {
  if (!schedulerPromise) {
    // 清理旧的 retry timer，避免重复触发
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    schedulerPromise = buildSchedulerFromDatabase().catch((error) => {
      console.error('❌ 启动新闻调度器失败:', error);
      // 清空缓存以便后续请求可重新尝试启动
      schedulerPromise = null;
      const retryDelayMs = 5000;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        ensureSchedulerStarted().catch((retryError) => {
          console.error('❌ 调度器重试启动失败:', retryError);
        });
      }, retryDelayMs);
      if (typeof (retryTimer as any)?.unref === 'function') {
        (retryTimer as any).unref();
      }
      console.info(`⏳ 将在 ${(retryDelayMs / 1000).toFixed(0)} 秒后重试启动调度器`);
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
