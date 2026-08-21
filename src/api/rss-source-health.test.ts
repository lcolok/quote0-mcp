import { describe, expect, it, mock } from 'bun:test';
import {
  formatRssSourceHealthAlert,
  listRssSourceHealth,
  recordRssSourceFailure,
  recordRssSourceSuccess,
  sendBarkRssSourceAlert,
  type QueryExecutor,
  type RssSourceHealthAlertRow,
} from './rss-source-health.js';

function fakeExecutor(result: { rowCount?: number; rows?: any[] } = {}): QueryExecutor & { calls: Array<{ sql: string; params?: any[] }> } {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  return {
    calls,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      return { rowCount: result.rowCount ?? 0, rows: result.rows ?? [] };
    },
  };
}

function sourceAlert(overrides: Partial<RssSourceHealthAlertRow> = {}): RssSourceHealthAlertRow {
  return {
    id: '1',
    source_id: 'solidot',
    from_health: 'healthy',
    to_health: 'degraded',
    alert_kind: 'outage',
    level: 'critical',
    consecutive_failures: 3,
    reason: 'Request timed out after 8000ms',
    outage_started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    state: 'pending',
    attempts: 1,
    max_attempts: 5,
    ...overrides,
  };
}

describe('RSS source health transitions', () => {
  it('formats a core source outage as a high-signal alert and recovery separately', () => {
    const outage = formatRssSourceHealthAlert(sourceAlert());
    expect(outage.title).toContain('核心 RSS 源失联');
    expect(outage.level).toBe('critical');
    expect(outage.body).toContain('source=Solidot');
    expect(outage.body).toContain('failures=3');
    expect(outage.body).toContain('Request timed out');

    const recovery = formatRssSourceHealthAlert(sourceAlert({
      from_health: 'degraded',
      to_health: 'healthy',
      alert_kind: 'recovery',
      level: 'info',
      consecutive_failures: 0,
      reason: null,
    }));
    expect(recovery.title).toContain('RSS 源恢复');
    expect(recovery.level).toBe('info');
    expect(recovery.body).toContain('degraded→healthy');
  });

  it('uses the scheduler failure threshold instead of alerting on one transient fetch error', async () => {
    const executor = fakeExecutor({ rowCount: 0 });
    const inserted = await recordRssSourceFailure(executor, {
      sourceId: 'solidot',
      consecutiveFailures: 1,
      threshold: 3,
      reason: 'timeout',
      observedAt: new Date('2026-08-21T09:00:00Z'),
    }, { BARK_DEVICE_KEY: '<set-via-lazycat-console>' });

    expect(inserted).toBe(false);
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].sql).toContain("to_health = 'degraded'");
    expect(executor.calls[0].params?.slice(0, 3)).toEqual(['solidot', 1, 3]);
  });

  it('persists outage/recovery transitions even when Bark is disabled', async () => {
    const outageExecutor = fakeExecutor({ rowCount: 1 });
    expect(await recordRssSourceFailure(outageExecutor, {
      sourceId: 'solidot',
      consecutiveFailures: 3,
      threshold: 3,
      reason: 'timeout',
    }, { BARK_DEVICE_KEY: '<set-via-lazycat-console>' })).toBe(true);
    expect(outageExecutor.calls[0].params).toContain('skipped');

    const recoveryExecutor = fakeExecutor({ rowCount: 1 });
    expect(await recordRssSourceSuccess(
      recoveryExecutor,
      'solidot',
      new Date('2026-08-21T10:00:00Z'),
      { BARK_DEVICE_KEY: '<set-via-lazycat-console>' },
    )).toBe(true);
    expect(recoveryExecutor.calls[0].sql).toContain("from_health = 'degraded'");
  });

  it('projects runtime state for every registry source, leaving unseen sources unknown', async () => {
    const executor = fakeExecutor({
      rows: [{
        source_id: 'solidot',
        health: 'degraded',
        last_success_at: '2026-08-20T08:12:00Z',
        last_failure_at: '2026-08-21T09:00:00Z',
        consecutive_failures: 3,
        last_error: 'timeout',
        outage_started_at: '2026-08-21T09:00:00Z',
      }],
    });
    const summary = await listRssSourceHealth(executor);
    const solidot = summary.find((item) => item.sourceId === 'solidot');
    const hackernews = summary.find((item) => item.sourceId === 'hackernews');
    expect(solidot).toMatchObject({ health: 'degraded', consecutiveFailures: 3, alertable: true });
    expect(hackernews).toMatchObject({ health: 'unknown', consecutiveFailures: 0, alertable: true });
  });
});

describe('RSS source Bark sender', () => {
  it('uses a separate quote0-rss group while sharing the existing Bark transport', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ code: 200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await sendBarkRssSourceAlert(sourceAlert(), {
      env: {
        BARK_ALERTS_ENABLED: 'true',
        BARK_DEVICE_KEY: 'test-key',
        BARK_BASE: 'https://bark.example.test',
        BARK_GROUP: 'quote0-eink',
        BARK_SOURCE_GROUP: 'quote0-rss-test',
      },
      fetchFn,
    });

    expect(calls).toHaveLength(1);
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('group')).toBe('quote0-rss-test');
    expect(form.get('level')).toBe('critical');
    expect(form.get('volume')).toBe('5');
    expect(form.get('body')).toContain('source=Solidot');
  });
});
