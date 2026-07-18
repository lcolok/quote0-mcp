export interface RenderTarget {
  id: string;                                 // 'eink-296x152' / 'label-T40x20-320'
  kind: 'eink' | 'thermal-label';
  widthPx: number;
  heightPx: number;
  dpi: number;
  colorMode: 'mono-1bit' | '3-color';         // Phase A 仅 mono-1bit
  physical?: { widthMm: number; heightMm: number };
  defaultFontStack: string[];                 // family 名按 unicode fallback 优先级排
  pushEndpoint?: string;                      // 仅 thermal-label，Phase A 占位 undefined
}

export const EINK_TARGET: RenderTarget = {
  id: 'eink-296x152',
  kind: 'eink',
  widthPx: 296,
  heightPx: 152,
  dpi: 250,
  colorMode: 'mono-1bit',
  defaultFontStack: ['fusion-pixel-12'],
};

export const LABEL_T40X20_TARGET: RenderTarget = {
  id: 'label-T40x20-320',
  kind: 'thermal-label',
  widthPx: 320,
  heightPx: 160,
  dpi: 203,
  colorMode: 'mono-1bit',
  physical: { widthMm: 40, heightMm: 20 },
  defaultFontStack: ['smiley-sans'],                // Phase B: 得意黑已下载并加载
};

// 商品型号 T20x8（型号后缀 590 为卷装数量，非像素值）。基准 203dpi，B1 Pro 等其他 DPI
// 由 deriveTargetForDevice() 按 physical(mm) 动态重算，无需在此列出多个 DPI 变体。
export const LABEL_T20X8_TARGET: RenderTarget = {
  id: 'label-T20x8-160',
  kind: 'thermal-label',
  widthPx: 160,
  heightPx: 64,
  dpi: 203,
  colorMode: 'mono-1bit',
  physical: { widthMm: 20, heightMm: 8 },
  defaultFontStack: ['smiley-sans'],
};

export const BUILTIN_TARGETS: RenderTarget[] = [
  EINK_TARGET,
  LABEL_T40X20_TARGET,
  LABEL_T20X8_TARGET,
];
