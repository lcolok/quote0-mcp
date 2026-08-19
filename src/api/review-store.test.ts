import { describe, expect, it } from 'bun:test';
import {
  decodeReviewCursor,
  encodeReviewCursor,
  listReviewSubjects,
  type ReviewQueryable,
} from './review-store.js';

describe('review-store cursor', () => {
  it('round-trips an opaque stable-subject cursor', () => {
    const cursor = { pushedAt: '2026-08-12T01:02:03.000Z', fingerprint: 'abc123' };
    expect(decodeReviewCursor(encodeReviewCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed cursors', () => {
    expect(decodeReviewCursor('not-a-cursor')).toBeNull();
  });
});

describe('listReviewSubjects', () => {
  it('queries the stable stats table and omits payload JSON by default', async () => {
    const calls: Array<{ sql: string; values?: any[] }> = [];
    const client: ReviewQueryable = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return {
          rows: [{
            id: 7,
            fingerprint: 'fp-7',
            title: '标题',
            original_title: '原标题',
            link: null,
            source: 'rss',
            category: 'technology',
            push_count: 3,
            image_path: null,
            pushed_at: new Date('2026-08-12T01:02:03.000Z'),
            pushed_at_utc: new Date('2026-08-12T01:02:03.000Z'),
            cursor_pushed_at: '2026-08-12T01:02:03.000000',
            job_id: 'job',
            annotation_status: 'pending',
            annotation_id: null,
            overall_score: null,
          }],
        } as any;
      },
    };

    const result = await listReviewSubjects(client, { limit: 50 });
    expect(result.rows).toHaveLength(1);
    expect(calls[0].sql).toContain('FROM news_push_stats AS s');
    expect(calls[0].sql).not.toContain('latest_log.raw_content');
    expect(calls[0].sql).not.toContain('latest_log.processed_content');
  });

  it('uses limit + 1 and emits a next cursor without a COUNT query', async () => {
    const calls: string[] = [];
    const client: ReviewQueryable = {
      query: async (sql) => {
        calls.push(sql);
        return {
          rows: [1, 2, 3].map((id) => ({
            id,
            fingerprint: `fp-${id}`,
            pushed_at: new Date(`2026-08-12T00:00:0${id}.000Z`),
            cursor_pushed_at: `2026-08-12T00:00:0${id}.000000`,
          })),
        } as any;
      },
    };
    const result = await listReviewSubjects(client, { limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
    expect(calls).toHaveLength(1);
  });
});
