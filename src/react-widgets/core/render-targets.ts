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
  /** 新闻组件的目标版式；尺寸变化时由同一个 target 一并携带。 */
  newsLayout?: NewsLayoutSpec;
}

/**
 * 新闻组件的像素级版式参数。
 * 这是渲染 SSoT 的一部分：组件不再把 24/12/16 等尺寸散落在 JSX 里，
 * 而是由 RenderTarget 决定。这样 296x128 和 296x152 可以拥有各自的
 * 版式，同时仍然共用同一个数据模型和渲染流程。
 */
export interface NewsLayoutSpec {
  titleFontPx: number;
  titleLineHeightPx: number;
  titlePaddingXPx: number;
  titlePaddingTopPx: number;
  titlePaddingBottomPx: number;
  bodyFontPx: number;
  bodyLineHeightPx: number;
  bodyPaddingXPx: number;
  bodyPaddingTopPx: number;
  footerHeightPx: number;
  footerFontPx: number;
  footerLineHeightPx: number;
}

function scaledEven(value: number, scale: number, minimum: number): number {
  return Math.max(minimum, Math.round((value * scale) / 2) * 2);
}

/** 根据物理目标尺寸生成新闻版式，基准是原 C3 的 296x152。 */
export function deriveNewsLayout(widthPx: number, heightPx: number): NewsLayoutSpec {
  const scale = Math.min(1, widthPx / 296, heightPx / 152);
  const titleFontPx = scaledEven(24, scale, 12);
  const bodyFontPx = Math.max(8, Math.round(12 * scale));
  const footerFontPx = Math.max(8, Math.round(12 * scale));

  return {
    titleFontPx,
    titleLineHeightPx: titleFontPx + 2,
    titlePaddingXPx: Math.max(3, Math.round(6 * scale)),
    titlePaddingTopPx: Math.max(2, Math.round(4 * scale)),
    titlePaddingBottomPx: Math.max(2, Math.round(4 * scale)),
    bodyFontPx,
    bodyLineHeightPx: bodyFontPx + 2,
    bodyPaddingXPx: Math.max(2, Math.round(4 * scale)),
    bodyPaddingTopPx: Math.max(1, Math.round(2 * scale)),
    footerHeightPx: Math.max(12, Math.round(16 * scale)),
    footerFontPx,
    footerLineHeightPx: footerFontPx + 2,
  };
}

/** 构造一个可直接用于 Satori 的电子纸 RenderTarget。 */
export function createEinkTarget(widthPx: number, heightPx: number, id = `eink-${widthPx}x${heightPx}`): RenderTarget {
  return {
    id,
    kind: 'eink',
    widthPx,
    heightPx,
    dpi: 250,
    colorMode: 'mono-1bit',
    defaultFontStack: ['fusion-pixel-12'],
    newsLayout: deriveNewsLayout(widthPx, heightPx),
  };
}

/** 从渲染配置解析目标；target 优先，width/height 只作为兼容旧调用的入口。 */
export function targetFromRenderConfig(
  config: { target?: RenderTarget; width?: number; height?: number } = {},
  fallback: RenderTarget = EINK_TARGET,
): RenderTarget {
  if (config.target) return config.target;

  const widthPx = config.width ?? fallback.widthPx;
  const heightPx = config.height ?? fallback.heightPx;
  if (widthPx === fallback.widthPx && heightPx === fallback.heightPx) return fallback;
  return fallback.kind === 'eink'
    ? createEinkTarget(widthPx, heightPx)
    : { ...fallback, widthPx, heightPx };
}

export const EINK_TARGET: RenderTarget = createEinkTarget(296, 152, 'eink-296x152');
export const EINK_296X128_TARGET: RenderTarget = createEinkTarget(296, 128, 'eink-296x128');

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
  EINK_296X128_TARGET,
  LABEL_T40X20_TARGET,
  LABEL_T20X8_TARGET,
];
