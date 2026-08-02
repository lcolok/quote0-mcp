import { describe, expect, it } from 'bun:test';
import {
  EINK_296X128_TARGET,
  EINK_TARGET,
  createEinkTarget,
  targetFromRenderConfig,
} from './render-targets.js';

describe('RenderTarget SSoT', () => {
  it('preserves the original C3 296x152 layout', () => {
    expect(EINK_TARGET.widthPx).toBe(296);
    expect(EINK_TARGET.heightPx).toBe(152);
    expect(EINK_TARGET.newsLayout?.titleFontPx).toBe(24);
    expect(EINK_TARGET.newsLayout?.bodyFontPx).toBe(12);
    expect(EINK_TARGET.newsLayout?.footerHeightPx).toBe(16);
  });

  it('derives a compact point-to-point layout for S3 296x128', () => {
    expect(EINK_296X128_TARGET.widthPx).toBe(296);
    expect(EINK_296X128_TARGET.heightPx).toBe(128);
    expect(EINK_296X128_TARGET.newsLayout?.titleFontPx).toBe(20);
    expect(EINK_296X128_TARGET.newsLayout?.bodyFontPx).toBe(10);
    expect(EINK_296X128_TARGET.newsLayout?.footerFontPx).toBe(10);
  });

  it('uses an explicit target as the single source of dimensions', () => {
    const target = createEinkTarget(200, 100);
    expect(targetFromRenderConfig({ target, width: 999, height: 999 })).toBe(target);
  });
});
