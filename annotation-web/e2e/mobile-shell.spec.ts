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

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=';
const MOCK_PHYSICAL_PREVIEW = {
  version: 'physical-bitplane-preview/v1',
  encoding: '1-bit-msb-first',
  pointToPoint: true,
  resizeApplied: false,
  sourceSize: { width: 296, height: 152 },
  targetSize: { width: 296, height: 152 },
  planeBytes: 5624,
  planeSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  image: { mimeType: 'image/png', bytes: 1200, base64: ONE_PIXEL_PNG },
};

const MOCK_EXACT_DIFF = {
  version: 'physical-bitplane-diff/v1',
  exact: true,
  changedPixels: 0,
  changedRatio: 0,
  bounds: null,
  regions: {
    title: { changedPixels: 0, changedRatio: 0 },
    body: { changedPixels: 0, changedRatio: 0 },
    footer: { changedPixels: 0, changedRatio: 0 },
  },
  leftPlaneSha256: MOCK_PHYSICAL_PREVIEW.planeSha256,
  rightPlaneSha256: MOCK_PHYSICAL_PREVIEW.planeSha256,
  image: { mimeType: 'image/png', bytes: 1200, base64: ONE_PIXEL_PNG },
};

const MOCK_BROWSER_DIFF = {
  ...MOCK_EXACT_DIFF,
  exact: false,
  changedPixels: 4194,
  changedRatio: 0.0932,
  bounds: { minX: 4, minY: 6, maxX: 290, maxY: 150, width: 287, height: 145 },
  regions: {
    title: { changedPixels: 1028, changedRatio: 0.0571 },
    body: { changedPixels: 2902, changedRatio: 0.1289 },
    footer: { changedPixels: 264, changedRatio: 0.0557 },
  },
  rightPlaneSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
};

const MOCK_RENDERER_TARGETS = {
  success: true,
  data: [
    { id: 'eink-296x152', kind: 'eink', widthPx: 296, heightPx: 152, dpi: 250, physical: null },
    { id: 'eink-296x128', kind: 'eink', widthPx: 296, heightPx: 128, dpi: 250, physical: null },
    { id: 'label-T20x8-160', kind: 'thermal-label', widthPx: 160, heightPx: 64, dpi: 203, physical: { widthMm: 20, heightMm: 8 } },
    { id: 'label-T40x20-320', kind: 'thermal-label', widthPx: 320, heightPx: 160, dpi: 203, physical: { widthMm: 40, heightMm: 20 } },
  ],
};

const MOCK_RENDERER_COMPARISON = {
  success: true,
  data: {
    version: 'renderer-review/v5',
    governanceVersion: 'renderer-governance/v3',
    target: { id: 'eink-296x152', kind: 'eink', widthPx: 296, heightPx: 152, dpi: 250, physical: null },
    governance: {
      tracks: [
        { id: 'current-satori', renderer: 'current-satori-news/v1', lifecycle: 'authoritative', summary: 'Current production' },
        {
          id: 'trmnl-framework',
          renderer: 'trmnl-layout-satori-pixel/v2',
          layoutEngine: 'trmnl-framework-browser/v3.2.0+quote0-news-v2',
          diagnosticRenderer: 'trmnl-framework-browser/v3.2.0+quote0-news-v2',
          lifecycle: 'canary',
          summary: 'TRMNL layout plus Fusion Pixel physical candidate',
        },
        { id: 'adaptive-v2-reference', renderer: 'adaptive-satori/v2', lifecycle: 'reference', frozen: true, summary: 'Frozen reference' },
      ],
      promotionGate: { minHumanReviews: 30, requiresBitplaneSelfCheck: true },
    },
    primary: {
      renderer: 'current-satori-news/v1', lifecycle: 'authoritative', baselineRole: 'authoritative-current',
      image: { mimeType: 'image/png', bytes: 4800, base64: ONE_PIXEL_PNG },
      renderMetrics: { totalMs: 7.6 }, bitmapMetrics: { burnRatio: 0.2478, burnBits: 11147 },
      physicalPreview: MOCK_PHYSICAL_PREVIEW,
    },
    candidate: {
      renderer: 'trmnl-layout-satori-pixel/v2', lifecycle: 'canary',
      layoutEngine: 'trmnl-framework-browser/v3.2.0+quote0-news-v2',
      browserProbeRenderer: 'trmnl-framework-browser/v3.2.0+quote0-news-v2',
      sharesLayoutWithBrowserProbe: true,
      image: { mimeType: 'image/png', bytes: 4000, base64: ONE_PIXEL_PNG },
      renderMetrics: {
        totalMs: 3238,
        layoutMeasureMs: 3200,
        rasterMs: 38,
        overflow: { horizontal: false, vertical: false },
        assetSource: 'local-pinned',
        pixelSnapPlan: {
          composition: 'standard',
          regions: {
            title: { x: 0, y: 0, width: 296, height: 60 },
            body: { x: 0, y: 60, width: 296, height: 76 },
            footer: { x: 0, y: 136, width: 296, height: 16 },
          },
          typography: {
            title: { fontPx: 24 },
            body: { fontPx: 12 },
            footer: { fontPx: 12 },
          },
          quantization: { maxRegionSnapErrorPx: 0.031, maxFontSnapErrorPx: 0.9 },
        },
      },
      bitmapMetrics: { burnRatio: 0.2478, burnBits: 11147 },
      physicalPreview: MOCK_PHYSICAL_PREVIEW,
    },
    browserProbe: {
      renderer: 'trmnl-framework-browser/v3.2.0+quote0-news-v2', lifecycle: 'canary', diagnosticOnly: true, layoutAuthorityForCandidate: true,
      image: { mimeType: 'image/png', bytes: 4200, base64: ONE_PIXEL_PNG },
      renderMetrics: {
        totalMs: 3200,
        recipeVersion: 'quote0-news-recipe/v2',
        overflow: { horizontal: false, vertical: false },
        assetSource: 'local-pinned',
        typography: { titleFontPx: 24.05, bodyFontPx: 11.1, footerFontPx: 11.1 },
        regions: {
          title: { x: 0, y: 0, width: 296, height: 59.9375 },
          body: { x: 0, y: 59.9375, width: 296, height: 76.0625 },
          footer: { x: 0, y: 136, width: 296, height: 16 },
        },
      },
      bitmapMetrics: { burnRatio: 0.2319, burnBits: 10400 },
      physicalPreview: { ...MOCK_PHYSICAL_PREVIEW, planeSha256: MOCK_BROWSER_DIFF.rightPlaneSha256 },
    },
    pixelBridge: {
      renderer: 'trmnl-layout-satori-pixel/v2', lifecycle: 'canary',
      image: { mimeType: 'image/png', bytes: 4000, base64: ONE_PIXEL_PNG },
      renderMetrics: { totalMs: 3238, layoutMeasureMs: 3200, rasterMs: 38 },
      bitmapMetrics: { burnRatio: 0.2478, burnBits: 11147 },
      physicalPreview: MOCK_PHYSICAL_PREVIEW,
    },
    reference: {
      renderer: 'adaptive-satori/v2', lifecycle: 'reference', frozen: true,
      image: { mimeType: 'image/png', bytes: 3900, base64: ONE_PIXEL_PNG },
      renderMetrics: { totalMs: 4.7 }, bitmapMetrics: { burnRatio: 0.2478, burnBits: 11147 },
      physicalPreview: MOCK_PHYSICAL_PREVIEW,
    },
    comparison: {
      renderMsDelta: 3230.4,
      blackRatioDelta: 0,
      exactPlaneEqual: true,
      changedPixels: 0,
      changedRatio: 0,
      browserChangedPixelsVsCandidate: 4194,
      browserChangedRatioVsCandidate: 0.0932,
      pixelBridgeBlackRatioDelta: 0,
      pixelBridgeRasterMs: 38,
    },
    diffs: {
      candidateVsPrimary: MOCK_EXACT_DIFF,
      browserVsCandidate: MOCK_BROWSER_DIFF,
      browserVsPrimary: MOCK_BROWSER_DIFF,
    },
    selfCheck: {
      version: 'renderer-self-check/v2',
      physicalCandidate: {
        status: 'pass', pointToPoint: true, resizeApplied: false, criticalOverflow: false,
        exactVsPrimary: true, changedPixels: 0, changedRatio: 0,
        titleBar: {
          status: 'pass', titleHeight: 60, requiredHeight: 60,
          occupiedTitleLines: 2, maxTitleLines: 2, excessRows: 0,
          clippedRows: 0, allowedExcessRows: 4,
          reason: 'title region matches the occupied physical pixel lines',
        },
        reasons: ['final physical plane is byte-for-byte identical to Current/Satori'],
      },
      browserProbe: {
        status: 'rejected', pointToPoint: true, resizeApplied: false,
        exactVsPhysicalCandidate: false, changedPixels: 4194, changedRatio: 0.0932,
        reason: 'Browser raster is diagnostic only',
      },
    },
    review: null,
    authoritativeOutput: 'primary',
    changesPhysicalDelivery: false,
  },
};

async function installApiMocks(page: Page) {
  await page.route('http://localhost:3001/api/review/statistics*', (route) => route.fulfill({ json: MOCK_STATS }));
  await page.route('http://localhost:3001/api/review/subjects*', (route) => route.fulfill({ json: MOCK_HISTORY }));
  await page.route('http://localhost:3001/api/scheduler/push-history/343565', (route) => route.fulfill({ json: MOCK_DETAIL }));
  await page.route('http://localhost:3001/api/devices*', (route) => route.fulfill({ json: MOCK_DEVICES }));
  await page.route('http://localhost:3001/api/review/renderers/targets*', (route) => route.fulfill({ json: MOCK_RENDERER_TARGETS }));
  await page.route('http://localhost:3001/api/review/renderers/343565*', async (route) => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({ json: { success: true, data: { choice: 'candidate', updated_at: '2026-08-18T04:30:00Z' } } });
    }
    return route.fulfill({ json: MOCK_RENDERER_COMPARISON });
  });
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
  await expect(page.getByRole('link', { name: /神经漫游者 A\/B/ })).toBeVisible();

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

  await page.getByRole('button', { name: 'Renderer A/B' }).click();
  await expect(page.getByText('Renderer 物理 A/B')).toBeVisible();
  await expect(page.getByText('物理候选自检：PASS')).toBeVisible();
  await expect(page.getByText('标题黑条：PASS', { exact: false })).toBeVisible();
  await expect(page.getByText('A · Current / Satori').first()).toBeVisible();
  await expect(page.getByText('B · TRMNL Pixel Bridge').first()).toBeVisible();
  await expect(page.getByText('TRMNL Browser Raster · 诊断探针')).toBeVisible();
  await expect(page.getByText(/Browser 原始栅格已被自检拒绝/)).toBeVisible();
  await expect(page.getByText('Physical 1-bit · POINT-TO-POINT · 1× source pixels').first()).toBeVisible();
  const mobilePixelPreview = page.getByAltText('B · TRMNL Pixel Bridge physical 1-bit preview');
  await expect(mobilePixelPreview).toHaveAttribute('data-native-pixel-preview', 'true');
  const mobilePreviewSize = await mobilePixelPreview.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    cssWidth: getComputedStyle(element).width,
    cssHeight: getComputedStyle(element).height,
  }));
  expect(mobilePreviewSize).toEqual({ width: 296, height: 152, cssWidth: '296px', cssHeight: '152px' });
  await expect(page.getByText('不改变真实推屏')).toBeVisible();
  await expectNoDocumentOverflow(page, 390);

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
  await expect(page.getByRole('link', { name: /神经漫游者 A\/B/ })).toBeVisible();
  await expect(page.locator('[class*="cursor-col-resize"]')).toHaveCount(2);
  await expectNoDocumentOverflow(page, 1440);

  await page.getByRole('button', { name: 'Renderer A/B' }).click();
  await expect(page.getByText('Renderer 物理 A/B')).toBeVisible();
  await expect(page.getByText('current-satori-news/v1').first()).toBeVisible();
  await expect(page.getByText('trmnl-framework-browser/v3.2.0+quote0-news-v2').first()).toBeVisible();
  await expect(page.getByText('trmnl-layout-satori-pixel/v2').first()).toBeVisible();
  await expect(page.getByText('Physical 1-bit · POINT-TO-POINT · 1× source pixels').first()).toBeVisible();
  const desktopPixelPreview = page.getByAltText('B · TRMNL Pixel Bridge physical 1-bit preview');
  const desktopPreviewSize = await desktopPixelPreview.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  }));
  expect(desktopPreviewSize).toEqual({ width: 296, height: 152 });
  await expect(page.getByText('Adaptive v2 reference（冻结，不参与主 A/B）')).toBeVisible();
  await expect(page.getByText('Renderer A/B 评审')).toBeVisible();
  await page.getByRole('button', { name: 'B · TRMNL Pixel Bridge' }).click();
  const reviewRequest = page.waitForRequest((request) =>
    request.method() === 'PUT' && request.url().includes('/api/review/renderers/343565/review')
  );
  await page.getByRole('button', { name: '保存 Renderer 评审' }).click();
  const savedReviewRequest = await reviewRequest;
  expect(savedReviewRequest.postDataJSON()).toMatchObject({
    targetId: 'eink-296x152',
    choice: 'candidate',
  });
  await expectNoDocumentOverflow(page, 1440);
  await page.screenshot({ path: 'test-results/annotation-desktop-renderers.png', fullPage: true });

  // 回归用户截图：暗色模式的当前项不能泄漏浅色 primary-50/primary-900。
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  const currentItem = page
    .getByRole('heading', { name: 'MCP 新规范取消会话' })
    .first()
    .locator('xpath=ancestor::div[contains(@class, "cursor-pointer")][1]');
  await currentItem.click();
  await page.mouse.move(1200, 48);
  await expect.poll(
    () => currentItem.evaluate((element) => getComputedStyle(element).backgroundColor),
    { timeout: 1_000 },
  ).toBe('rgb(27, 33, 48)');
  const selectedStyle = await currentItem.evaluate((element) => {
    const title = element.querySelector('h3');
    const style = getComputedStyle(element);
    return {
      borderLeftColor: style.borderLeftColor,
      titleColor: title ? getComputedStyle(title).color : '',
    };
  });
  expect(['rgb(145, 167, 242)', 'rgba(145, 167, 242, 1)']).toContain(selectedStyle.borderLeftColor);
  expect(selectedStyle.titleColor).toBe('rgb(240, 242, 245)');
});
