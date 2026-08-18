import { describe, expect, test } from 'bun:test';
import {
  TRMNL_FRAMEWORK_CSS_URL,
  TRMNL_FRAMEWORK_JS_URL,
  TRMNL_FRAMEWORK_VERSION,
  TRMNL_NEWS_RECIPE_VERSION,
  buildTrmnlAdaptiveHtml,
  deriveTrmnlTargetProfile,
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
    expect(profiles.map(({ profile }) => profile.composition)).toEqual(['standard', 'standard', 'micro', 'standard']);
    expect(profiles.map(({ profile }) => profile.textScale)).toEqual(['large', 'large', 'regular', 'large']);
    for (const { profile } of profiles) {
      expect(profile.size).toBe('sm');
      expect(profile.colorDepth).toBe(1);
      expect(profile.densityTier).toBe('1x');
      expect(profile.screenClasses).toContain('screen--byod_custom');
      expect(profile.screenClasses).toContain('screen--no-bleed');
      expect(profile.screenClasses).toContain(`screen--text-scale-${profile.textScale}`);
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
      composition: 'standard',
      textScale: 'regular',
      colorDepth: 1,
    });
  });
});

describe('TRMNL adaptive HTML', () => {
  test('pins framework assets to 3.2.0 instead of rolling latest', () => {
    expect(TRMNL_FRAMEWORK_VERSION).toBe('3.2.0');
    expect(TRMNL_NEWS_RECIPE_VERSION).toBe('quote0-news-recipe/v1');
    expect(TRMNL_FRAMEWORK_CSS_URL).toContain('/css/3.2.0/');
    expect(TRMNL_FRAMEWORK_JS_URL).toContain('/js/3.2.0/');
    expect(TRMNL_FRAMEWORK_CSS_URL).not.toContain('latest');
    expect(TRMNL_FRAMEWORK_JS_URL).not.toContain('latest');
  });

  test('can point the same pinned recipe at a loopback Framework origin', () => {
    const html = buildTrmnlAdaptiveHtml(
      { title: 'local assets', body: 'warm page' },
      EINK_TARGET,
      FONT_DATA_URI,
      'http://127.0.0.1:39123',
    );
    expect(html).toContain('http://127.0.0.1:39123/css/3.2.0/plugins.min.css');
    expect(html).toContain('http://127.0.0.1:39123/js/3.2.0/plugins.min.js');
    expect(html).not.toContain('https://trmnl.com/css/3.2.0/plugins.min.css');
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
      expect(html).toContain('screen--no-bleed');
      expect(html).toContain('layout--top');
      expect(html).toContain('layout--stretch');
      expect(html).toContain('gap--none');
      expect(html).toContain('flex flex--col gap--none quote0-news-stack');
      expect(html).toContain('inverse flex flex--col shrink-0 quote0-title-region');
      expect(html).toContain('content grow quote0-body-region');
      expect(html).toContain('flex flex--center flex-none quote0-footer-region');
      expect(html).toContain('text--xlarge quote0-title');
      expect(html).toContain('data-content-limiter="true"');
      expect(html).toContain('data-clamp="2"');
      expect(html).toContain('Quote0 Fusion Pixel');
      expect(html).toContain(content.title);
      expect(html).toContain(content.body);
    }
    expect(small).toContain('--screen-w:160px');
    expect(small).toContain('--screen-h:64px');
    expect(small).toContain('quote0-screen--micro');
    expect(small).toContain('screen--text-scale-regular');
    expect(small).toContain('text--base quote0-body-text');
    expect(small).toContain('data-clamp="3"');
    expect(small).toContain('quote0-footer-region" hidden');
    expect(large).toContain('--screen-w:320px');
    expect(large).toContain('--screen-h:160px');
    expect(large).toContain('screen--text-scale-large');
    expect(large).toContain('text--small quote0-body-text');
    expect(large).toContain('data-clamp="6"');
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
