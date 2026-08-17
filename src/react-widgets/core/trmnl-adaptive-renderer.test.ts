import { describe, expect, test } from 'bun:test';
import {
  TRMNL_FRAMEWORK_CSS_URL,
  TRMNL_FRAMEWORK_JS_URL,
  TRMNL_FRAMEWORK_VERSION,
  buildTrmnlAdaptiveHtml,
  deriveTrmnlTargetProfile,
  isTrmnlFrameworkAssetUrl,
} from './trmnl-adaptive-renderer.js';
import {
  EINK_296X128_TARGET,
  EINK_TARGET,
  LABEL_T20X8_TARGET,
  LABEL_T40X20_TARGET,
  type RenderTarget,
} from './render-targets.js';

const FONT_DATA_URI = 'data:font/woff2;base64,ZmFrZQ==';

describe('TRMNL adaptive target profile', () => {
  test('uses one continuous scale rule across e-ink and thermal targets', () => {
    const profiles = [
      EINK_296X128_TARGET,
      EINK_TARGET,
      LABEL_T20X8_TARGET,
      LABEL_T40X20_TARGET,
    ].map((target) => ({ target, profile: deriveTrmnlTargetProfile(target) }));

    expect(profiles.map(({ profile }) => profile.uiScale)).toEqual([0.64, 0.74, 0.5, 0.8]);
    for (const { profile } of profiles) {
      expect(profile.size).toBe('sm');
      expect(profile.colorDepth).toBe(1);
      expect(profile.densityTier).toBe('1x');
      expect(profile.screenClasses).toContain('screen--byod_custom');
      expect(profile.screenClasses).toContain('screen--sm');
      expect(profile.screenClasses).toContain('screen--1bit');
    }
  });

  test('supports runtime-discovered thermal dimensions without adding a named template', () => {
    const dynamicThermal: RenderTarget = {
      id: 'thermal-runtime-50x30',
      kind: 'thermal-label',
      widthPx: 400,
      heightPx: 240,
      dpi: 203,
      colorMode: 'mono-1bit',
      physical: { widthMm: 50, heightMm: 30 },
      defaultFontStack: ['smiley-sans'],
    };

    expect(deriveTrmnlTargetProfile(dynamicThermal)).toMatchObject({
      size: 'sm',
      uiScale: 1,
      gapScale: 1,
      colorDepth: 1,
    });
  });
});

describe('TRMNL adaptive HTML', () => {
  test('pins framework assets to 3.2.0 instead of rolling latest', () => {
    expect(TRMNL_FRAMEWORK_VERSION).toBe('3.2.0');
    expect(TRMNL_FRAMEWORK_CSS_URL).toContain('/css/3.2.0/');
    expect(TRMNL_FRAMEWORK_JS_URL).toContain('/js/3.2.0/');
    expect(TRMNL_FRAMEWORK_CSS_URL).not.toContain('latest');
    expect(TRMNL_FRAMEWORK_JS_URL).not.toContain('latest');
    expect(isTrmnlFrameworkAssetUrl(TRMNL_FRAMEWORK_CSS_URL)).toBe(true);
    expect(isTrmnlFrameworkAssetUrl(TRMNL_FRAMEWORK_JS_URL)).toBe(true);
    expect(isTrmnlFrameworkAssetUrl('https://trmnl.com/fonts/TRMNL16-Regular.woff2')).toBe(true);
    expect(isTrmnlFrameworkAssetUrl('https://example.com/untrusted.css')).toBe(false);
  });

  test('keeps the exact same markup contract while geometry comes from RenderTarget', () => {
    const content = {
      eyebrow: 'Quote0 Research',
      title: '同一份内容，自适应不同纸张与墨水屏',
      body: 'TRMNL Runtime 负责测量空间、限制正文和处理换行；Quote0 只提供内容与目标尺寸。',
      footer: 'TRMNL 3.2 · 1-bit',
    };
    const small = buildTrmnlAdaptiveHtml(content, LABEL_T20X8_TARGET, FONT_DATA_URI);
    const large = buildTrmnlAdaptiveHtml(content, LABEL_T40X20_TARGET, FONT_DATA_URI);

    for (const html of [small, large]) {
      expect(html).toContain('screen--byod_custom');
      expect(html).toContain('data-content-limiter="true"');
      expect(html).toContain('data-clamp="2"');
      expect(html).toContain('data-clamp="4"');
      expect(html).toContain('Quote0 Fusion Pixel');
      expect(html).toContain(content.title);
      expect(html).toContain(content.body);
    }
    expect(small).toContain('--screen-w:160px');
    expect(small).toContain('--screen-h:64px');
    expect(large).toContain('--screen-w:320px');
    expect(large).toContain('--screen-h:160px');
  });

  test('escapes untrusted content before putting it into browser markup', () => {
    const html = buildTrmnlAdaptiveHtml(
      { title: '<script>alert("x")</script>', body: 'A & B' },
      EINK_TARGET,
      FONT_DATA_URI,
    );
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('A &amp; B');
  });
});
