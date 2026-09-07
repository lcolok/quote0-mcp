import { describe, expect, it } from 'bun:test';
import { parseHistoryUrlState, parseReviewUrlState, patchReviewUrlParams } from './review-url-state';

describe('review URL state contract', () => {
  it('round-trips a shareable content-review identity without volatile payloads', () => {
    const params = patchReviewUrlParams(new URLSearchParams(), {
      view: 'content',
      subject: 'abc123',
      delivery: 343565,
      mode: 'renderers',
      target: 'eink-296x152',
      pane: 'preview',
      query: 'MCP',
      deviceIds: ['eink-2', 'eink-4', 'eink-2'],
    });
    expect(params.toString()).toContain('v=1');
    expect(params.getAll('device')).toEqual(['eink-2', 'eink-4']);
    expect(parseReviewUrlState(params)).toEqual({
      version: '1',
      view: 'content',
      subject: 'abc123',
      delivery: 343565,
      mode: 'renderers',
      target: 'eink-296x152',
      pane: 'preview',
      query: 'MCP',
      deviceIds: ['eink-2', 'eink-4'],
      runId: undefined,
      inventoryId: undefined,
    });
  });

  it('encodes the exact Neuromancer run and inventory identity', () => {
    const params = patchReviewUrlParams(new URLSearchParams('view=content&delivery=9'), {
      view: 'neuromancer',
      runId: '82306199-5030-47db-a3f8-e3046cbc8d96',
      inventoryId: 18246,
      delivery: null,
      subject: null,
    });
    const parsed = parseReviewUrlState(params);
    expect(parsed.view).toBe('neuromancer');
    expect(parsed.runId).toBe('82306199-5030-47db-a3f8-e3046cbc8d96');
    expect(parsed.inventoryId).toBe(18246);
    expect(parsed.delivery).toBeUndefined();
  });

  it('keeps scheduler history selection/search/page reproducible', () => {
    const params = patchReviewUrlParams(new URLSearchParams(), {
      delivery: 77,
      subject: 'fp77',
      query: 'Sail Research',
      page: 3,
    });
    expect(parseHistoryUrlState(params)).toEqual({
      delivery: 77,
      query: 'Sail Research',
      page: 3,
    });
  });
});
