import { describe, expect, it } from 'bun:test';
import { BUILTIN_TARGETS, EINK_800X480_TARGET, EINK_TARGET, createEinkTarget, deriveNewsLayout } from './render-targets.js';

const BASE = {
  titleFontPx: 24, titleLineHeightPx: 26, titlePaddingXPx: 6, titlePaddingTopPx: 4, titlePaddingBottomPx: 4,
  bodyFontPx: 12, bodyLineHeightPx: 14, bodyPaddingXPx: 4, bodyPaddingTopPx: 2,
  footerHeightPx: 16, footerFontPx: 12, footerLineHeightPx: 14,
};

describe('deriveNewsLayout', () => {
  it('keeps the 296x152 / 296x128 legacy layouts byte-identical', () => {
    expect(deriveNewsLayout(296, 152)).toEqual(BASE);
    expect(deriveNewsLayout(296, 128)).toEqual({
      ...BASE, titleFontPx: 20, titleLineHeightPx: 22, titlePaddingXPx: 5, titlePaddingTopPx: 3, titlePaddingBottomPx: 3,
      bodyFontPx: 10, bodyLineHeightPx: 12, bodyPaddingXPx: 3, bodyPaddingTopPx: 2, footerHeightPx: 13, footerFontPx: 10, footerLineHeightPx: 12,
    });
    // 略大于基准但不足 2× 的目标仍按 1×（保守，不出现非整数倍像素字）
    expect(deriveNewsLayout(400, 200)).toEqual(BASE);
  });

  it('uses the 3x profile for the 3.97" 800x480 panel', () => {
    const l = deriveNewsLayout(800, 480);
    expect(l.titleFontPx).toBe(72);
    expect(l.bodyFontPx).toBe(36);
    expect(l.bodyLineHeightPx).toBe(46);
    expect(l.footerHeightPx).toBe(44);
    expect(l.footerFontPx).toBe(28);
    expect(l.bodyLineHeightPx).toBe(46);
    expect(l.titleFontFamily).toBe('SmileySans');
    expect(l.bodyFontFamily).toBe('AlibabaPuHuiTi-Regular');
    expect(deriveNewsLayout(296, 152).bodyFontFamily).toBeUndefined();   // 小屏仍像素字体
    expect(deriveNewsLayout(600, 320).bodyFontFamily).toBeUndefined();   // 未登记大屏：像素字体整数倍
  });

  it('scales unknown large targets by an integer factor (pixel-font crisp)', () => {
    const l = deriveNewsLayout(600, 320);   // min(2.03, 2.11) → 2×
    expect(l.titleFontPx).toBe(48);
    expect(l.bodyFontPx).toBe(24);
    expect(deriveNewsLayout(1200, 480).bodyFontPx).toBe(36);   // min(4.05, 3.16) → 3×
  });
});

describe('createEinkTarget', () => {
  it('attaches physical panel data for known geometries only', () => {
    expect(EINK_800X480_TARGET.dpi).toBe(235);
    expect(EINK_800X480_TARGET.physical?.widthMm).toBeCloseTo(86.4);
    expect(EINK_800X480_TARGET.newsLayout?.bodyFontPx).toBe(36);
    expect(EINK_800X480_TARGET.defaultFontStack).toEqual(['SmileySans', 'AlibabaPuHuiTi-Regular']);
    expect(createEinkTarget(800, 480).newsLayout).toEqual(EINK_800X480_TARGET.newsLayout);
    expect(EINK_TARGET.dpi).toBe(250);
    expect(EINK_TARGET.physical).toBeUndefined();
    expect(BUILTIN_TARGETS.map((t) => t.id)).toContain('eink-800x480');
  });
});
