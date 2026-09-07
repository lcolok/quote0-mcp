import { expect, test } from '@playwright/test';

const RECORD = {
  id: 77,
  fingerprint: 'scheduler-fingerprint-77',
  title: 'Scheduler URL 深链接新闻',
  originalTitle: 'Original scheduler item',
  summary: '用于验证推送历史页的地址栏状态。',
  imagePath: null,
  publishTime: '2026-08-31T12:00:00.000Z',
  pushedAt: '2026/08/31 20:00:00',
  pushedAtUtc: '2026-08-31T12:00:00.000Z',
  pushedAtEpoch: 1788177600000,
  category: 'news',
  dataSource: 'InfoQ 中文',
  rawContent: { title: 'Original scheduler item', source: 'InfoQ 中文', content: 'raw', link: 'https://example.com/item' },
  processedContent: { title: 'Scheduler URL 深链接新闻', message: '用于验证推送历史页的地址栏状态。', source: 'InfoQ 中文' },
};

test('scheduler selection/search/page state is shareable and reloadable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await page.route('http://localhost:3001/api/scheduler/push-history?**', (route) => route.fulfill({
    json: { success: true, data: [RECORD], pagination: { total: 1, limit: 50, offset: 0, hasMore: false } },
  }));
  await page.route('http://localhost:3001/api/scheduler/push-history/77', (route) => route.fulfill({
    json: {
      success: true,
      data: {
        id: 77,
        fingerprint: RECORD.fingerprint,
        pushed_at: RECORD.pushedAtUtc,
        raw_content: RECORD.rawContent,
        processed_content: RECORD.processedContent,
        image_path: null,
      },
    },
  }));

  await page.goto('/scheduler');
  await page.getByText(RECORD.title).click();
  await expect(page.getByRole('heading', { name: '推送详情' })).toBeVisible();
  await expect.poll(() => {
    const params = new URL(page.url()).searchParams;
    return [params.get('v'), params.get('delivery'), params.get('subject')];
  }).toEqual(['1', '77', RECORD.fingerprint]);

  const shareUrl = page.url();
  await page.goto(shareUrl);
  await expect(page.getByText(RECORD.title).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '推送详情' })).toBeVisible();

  await page.getByPlaceholder('搜索标题或摘要...').fill('NAT');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('NAT');
  expect(new URL(page.url()).searchParams.get('delivery')).toBeNull();
});
