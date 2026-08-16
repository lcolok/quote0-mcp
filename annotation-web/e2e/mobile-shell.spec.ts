import { expect, test, type Page } from '@playwright/test';

const MOCK_HISTORY = {
  success: true,
  data: [
    {
      id: 343565,
      title: 'MCP 新规范取消会话',
      originalTitle: 'MCP 走向无状态，开发者追问：这不就又变回 API 了吗？',
      imagePath: null,
      pushedAt: '2026/08/17 02:30:22',
      pushedAtUtc: '2026-08-16T18:30:22.000Z',
      pushedAtEpoch: 1786905022000,
      category: 'news',
      dataSource: 'MCP官方·InfoQ',
      annotationStatus: 'pending',
      contentOrigin: {
        kind: 'neuromancer',
        signature: '神经漫游者',
        producer: 'external-renderable-agent',
        jobId: 'renderable-intake',
        layer: 'external-renderable',
        contractVersion: 'renderable-news/v1',
      },
    },
  ],
  pagination: { total: 1, limit: 50, offset: 0, hasMore: false, nextCursor: null },
};

const MOCK_DETAIL = {
  success: true,
  data: {
    id: 343565,
    job_id: 'renderable-intake',
    layer: 'external-renderable',
    image_path: null,
    raw_content: {
      title: 'MCP 走向无状态，开发者追问：这不就又变回 API 了吗？',
      content: '点击查看原文>',
      source: 'InfoQ',
      origin: 'renderable-intake',
      provenance: {},
      publishTime: '2026-08-16T08:59:17.000Z',
      link: 'https://www.infoq.cn/article/example',
    },
    processed_content: {
      title: 'MCP 新规范取消会话',
      message: 'MCP 2026-07-28 规范取消协议会话与 initialize 握手；请求须带 Mcp-Method 和 Mcp-Name 标头，网关无需解析正文即可路由、限流。',
      source: 'MCP官方·InfoQ',
      signature: '神经漫游者',
      highlights: ['MCP 2026-07-28', 'Mcp-Method 和 Mcp-Name'],
      metadata: {
        producer: 'external-renderable-agent',
        contractVersion: 'renderable-news/v1',
        provenance: [
          { id: 'mcp-official', url: 'https://blog.modelcontextprotocol.io/posts/2026-07-28', role: 'official' },
          { id: 'infoq-en', url: 'https://www.infoq.com/news/2026/08/mcp-stateless-gateway/', role: 'primary' },
        ],
        researchReceipt: {
          schemaVersion: 'neuromancer-research/v1',
          agent: 'neuromancer',
          threadId: '275f8309-2329-42ac-bb40-9d9b70217600',
          runId: 'ff322a22-eab9-4d30-a985-019e38b31017',
          seed: {
            title: 'MCP 走向无状态，开发者追问：这不就又变回 API 了吗？',
            content: '点击查看原文>',
            source: 'InfoQ',
            link: 'https://www.infoq.cn/article/example',
          },
          sources: [
            { id: 'mcp-official', url: 'https://blog.modelcontextprotocol.io/posts/2026-07-28', title: 'The 2026-07-28 Specification', role: 'official' },
            { id: 'infoq-en', url: 'https://www.infoq.com/news/2026/08/mcp-stateless-gateway/', title: 'MCP Goes Stateless', role: 'primary' },
          ],
          claims: [
            { text: 'MCP 2026-07-28 规范取消协议会话', sourceIds: ['mcp-official', 'infoq-en'], status: 'supported' },
            { text: '请求须带 Mcp-Method 和 Mcp-Name 标头', sourceIds: ['mcp-official', 'infoq-en'], status: 'supported' },
          ],
          retrieval: { status: 'degraded', enginesUsed: ['bing', 'anysearch', 'scrapling'] },
          usage: {
            providerReportedTokens: { status: 'invalid-zero', total: 0 },
            toolCalls: 4,
            searchRequests: 1,
            crawlRequests: 3,
          },
        },
      },
      link: 'https://www.infoq.cn/article/example',
    },
  },
};

const MOCK_STATS = {
  success: true,
  data: {
    progress: {
      total_count: 1,
      pending_count: 1,
      completed_count: 0,
      skipped_count: 0,
      completion_rate: 0,
    },
  },
};

const MOCK_DEVICES = {
  success: true,
  data: [
    {
      id: 'eink-2',
      name: 'S3自制板墨水屏',
      base_url: 'http://192.168.31.130',
      token: '',
      width: 296,
      height: 152,
      enabled: true,
      kind: 'eink-local',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-16T00:00:00Z',
    },
  ],
};

async function installApiMocks(page: Page) {
  await page.route('http://localhost:3001/api/review/statistics*', (route) => route.fulfill({ json: MOCK_STATS }));
  await page.route('http://localhost:3001/api/review/subjects*', (route) => route.fulfill({ json: MOCK_HISTORY }));
  await page.route('http://localhost:3001/api/scheduler/push-history/343565', (route) => route.fulfill({ json: MOCK_DETAIL }));
  await page.route('http://localhost:3001/api/devices*', (route) => route.fulfill({ json: MOCK_DEVICES }));
}

async function expectNoDocumentOverflow(page: Page, maxWidth: number) {
  const metrics = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(metrics.viewport).toBe(maxWidth);
  expect(metrics.doc).toBeLessThanOrEqual(maxWidth);
  expect(metrics.body).toBeLessThanOrEqual(maxWidth);
}

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('mobile shell uses an off-canvas drawer and single-pane review flow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-webkit');
  const requestedUrls: string[] = [];
  page.on('request', (request) => requestedUrls.push(request.url()));
  await page.goto('/annotate');
  await expect(page.getByRole('heading', { name: '开始标注' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();

  // 默认 system 模式必须实时跟随系统，不依赖刷新页面。
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  const sidebar = page.locator('aside');
  const closedBox = await sidebar.boundingBox();
  expect(closedBox).not.toBeNull();
  expect((closedBox?.x ?? 0) + (closedBox?.width ?? 0)).toBeLessThanOrEqual(2);
  await expectNoDocumentOverflow(page, 390);

  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByText('Quote0 内容工作台')).toBeVisible();
  await expect.poll(async () => {
    const openedBox = await sidebar.boundingBox();
    return Math.abs(openedBox?.x ?? 99);
  }, { timeout: 2_000 }).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '关闭导航', exact: true }).click();

  await expect(page.getByRole('button', { name: '列表' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('MCP 新规范取消会话').first().click();
  await expect(page.getByRole('button', { name: '预览' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('新闻预览')).toBeVisible();
  await expect(page.getByText('Neuromancer 研究增强成品').first()).toBeVisible();
  await expect(page.getByText('点击查看原文>')).toBeVisible();
  await expect(page.getByText('Neuromancer Research Receipt')).toBeVisible();
  await expect(page.getByText('The 2026-07-28 Specification')).toBeVisible();
  await expect(page.getByText('最终主张 → 证据')).toBeVisible();
  await expect(page.getByText('工具调用 4')).toBeVisible();
  await expect(page.getByText('研究来源明细尚未持久化')).toHaveCount(0);
  await expect(page.getByText('AX优化后的数据')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '高质量' })).toBeVisible();
  await expect(page.getByRole('button', { name: '低质量' })).toBeVisible();
  expect(requestedUrls.some((url) => url.includes('/api/review/subjects'))).toBe(true);
  expect(requestedUrls.some((url) => url.includes('/api/annotation/statistics'))).toBe(false);

  await page.getByRole('button', { name: '操作', exact: true }).click();
  await expect(page.getByText('怎么开始推送')).toBeVisible();
  await expect(page.getByRole('button', { name: /立即推送这条新闻/ })).toBeVisible();
  await expectNoDocumentOverflow(page, 390);

  await page.screenshot({ path: 'test-results/annotation-mobile-light.png', fullPage: true });

  const themeButton = page.getByRole('button', { name: /主题：/ });
  await themeButton.click(); // system -> light
  await themeButton.click(); // light -> dark
  await expect(page.locator('html')).toHaveClass(/dark/);
  const bodyBackground = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(bodyBackground).not.toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-results/annotation-mobile-dark.png', fullPage: true });
});

test('desktop keeps the three-column review workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await page.goto('/annotate');
  await expect(page.getByRole('button', { name: '打开导航' })).toBeHidden();
  await expect(page.getByText('新闻预览')).toBeVisible();
  await expect(page.getByText('怎么开始推送')).toBeVisible();
  await expect(page.getByText('MCP 新规范取消会话').first()).toBeVisible();
  await expect(page.locator('[class*="cursor-col-resize"]')).toHaveCount(2);
  await expectNoDocumentOverflow(page, 1440);
  await page.screenshot({ path: 'test-results/annotation-desktop-light.png', fullPage: true });
});
