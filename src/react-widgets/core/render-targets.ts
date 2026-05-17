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

export const BUILTIN_TARGETS: RenderTarget[] = [EINK_TARGET, LABEL_T40X20_TARGET];
