import { describe, expect, it } from 'bun:test';
import {
  decodeReviewCursor,
  encodeReviewCursor,
  getStableReviewStatistics,
  listReviewSubjectSummaries,
} from './review-subject-store.js';

function mockClient(responses: Array<{ rows: any[] }>) {
  const calls: Array<{ sql: string; values: any[] }> = [];
  return {
    calls,
    client: {
      async query(sql: string, values: any[] = []) {
        calls.push({ sql, values });
        return responses.shift() || { rows: [] };
      },
    },
  };
}

describe('review subject cursor', () => {
  it('round trips a stable timestamp/fingerprint cursor', () => {
    const encoded = encodeReviewCursor({
      pushedAt: '2026-08-16T10:00:00.123456',
      fingerprint: 'abc123',
    });
    expect(decodeReviewCursor(encoded)).toEqual({
      pushedAt: '2026-08-16T10:00:00.123456',
      fingerprint: 'abc123',
    });
  });

  it('fails closed for malformed cursors', () => {
    expect(decodeReviewCursor('not-a-cursor')).toBeNull();
  });
});

describe('listReviewSubjectSummaries', () => {
  it('pages news_push_stats before doing latest-delivery lookups', async () => {
    const { client, calls } = mockClient([
      {
        rows: [
          {
            id: 10,
            fingerprint: 'fp-10',
            title: 'A',
            cursor_pushed_at: '2026-08-16T10:00:00.000000',
          },
          {
            id: 9,
            fingerprint: 'fp-09',
            title: 'B',
            cursor_pushed_at: '2026-08-16T09:00:00.000000',
          },
          {
            id: 8,
            fingerprint: 'fp-08',
            title: 'C',
            cursor_pushed_at: '2026-08-16T08:00:00.000000',
          },
        ],
      },
      { rows: [{ count: '9697' }] },
    ]);

    const result = await listReviewSubjectSummaries(client, { limit: 2, includeTotal: true });

    expect(result.rows).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(9697);
    expect(result.nextCursor).not.toBeNull();
    expect(calls[0].sql).toContain('WITH subjects AS MATERIALIZED');
    expect(calls[0].sql.indexOf('LIMIT')).toBeLessThan(calls[0].sql.indexOf('JOIN LATERAL'));
    expect(calls[0].sql).toContain("processed_content->>'signature'");
    expect(calls[0].sql).toContain("processed_content->'metadata'->>'producer'");
    expect(calls[0].sql).not.toContain(', raw_content,');
    expect(calls[0].sql).not.toContain(', processed_content,');
    expect(calls[0].values).toEqual([3]);
    expect(calls[1].sql).toContain('FROM news_push_stats');
  });

  it('uses keyset pagination and server-side subject search', async () => {
    const cursor = encodeReviewCursor({
      pushedAt: '2026-08-16T10:00:00.000000',
      fingerprint: 'fp-10',
    });
    const { client, calls } = mockClient([{ rows: [] }]);

    await listReviewSubjectSummaries(client, { limit: 50, cursor, search: 'MCP' });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('s.title ILIKE');
    expect(calls[0].sql).toContain('s.last_pushed_at <');
    expect(calls[0].values).toEqual(['%MCP%', '2026-08-16T10:00:00.000000', 'fp-10', 51]);
  });
});

describe('getStableReviewStatistics', () => {
  it('counts stable subjects instead of scanning delivery JSON', async () => {
    const { client, calls } = mockClient([
      {
        rows: [{
          total_count: 9697,
          pending_count: 9675,
          completed_count: 22,
          skipped_count: 0,
          completion_rate: 0.2,
        }],
      },
      { rows: [{ quality_level: 'high', count: 10 }] },
    ]);

    const result = await getStableReviewStatistics(client);

    expect(result.progress.total_count).toBe(9697);
    expect(result.progress.completed_count).toBe(22);
    expect(calls[0].sql).toContain('FROM news_push_stats AS s');
    expect(calls[0].sql).toContain('JOIN news_push_log AS npl ON npl.id = qa.news_id');
    expect(calls[0].sql).not.toContain("raw_content->>'title'");
  });
});
