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
  /** 可选：矢量字体 family（须已在 SatoriRenderer.initialize 注册）；缺省走像素字体（FusionPixel 整数倍）。 */
  titleFontFamily?: string;
  bodyFontFamily?: string;
}

function scaledEven(value: number, scale: number, minimum: number): number {
  return Math.max(minimum, Math.round((value * scale) / 2) * 2);
}

/** 把 296x152 基准版式按整数倍放大：像素字体（fusion-pixel 8/10/12px）只有整数倍才锐利。 */
export function scaleNewsLayout(base: NewsLayoutSpec, k: number): NewsLayoutSpec {
  const out = {} as NewsLayoutSpec;
  for (const [key, value] of Object.entries(base)) (out as any)[key] = typeof value === 'number' ? Math.round(value * k) : value;
  return out;
}

/**
 * 大屏专属版式 profile（按几何命中，SSoT 与 296x128/296x152 同源）。
 * 800x480 = 3.97" GDEY0397T81P（≈235ppi）：3× → 正文 36px≈3.9mm、标题 72px，每行 22 汉字、约 8 行。
 * 2026-08-25 用户目视三档预览（1×/2×/3×）后选定 3×。
 */
const LARGE_EINK_LAYOUT_PROFILES: Record<string, () => NewsLayoutSpec> = {
  // 2026-08-25 定型：235ppi 上矢量字体吃到分辨率红利——得意黑标题 72px + 普惠体 Regular 正文 36px（行高 1.3），
  // 用户在真屏上对比像素字体 3× / 普惠 Heavy / 文楷 / Regular 后选定 Regular。
  '800x480': () => ({
    ...scaleNewsLayout(deriveNewsLayout(296, 152), 3),
    titleFontFamily: 'SmileySans',
    bodyFontFamily: 'AlibabaPuHuiTi-Regular',
    titleLineHeightPx: 82,
    bodyLineHeightPx: 46,
    footerFontPx: 28,
    footerLineHeightPx: 34,
    footerHeightPx: 44,
  }),
};

/**
 * 根据物理目标尺寸生成新闻版式，基准是原 C3 的 296x152。
 * - 小于基准：按比例缩小（原逻辑，逐字节不变）；
 * - 命中大屏 profile：用 profile；
 * - 未登记的大屏：按 floor(min(w/296, h/152)) 整数倍放大（≥2 才放大，保守），
 *   历史坑：此前 scale 被 Math.min(1, …) 封顶，800x480 被原样贴上 296x152 版式，下半屏全空。
 */
export function deriveNewsLayout(widthPx: number, heightPx: number): NewsLayoutSpec {
  const profile = LARGE_EINK_LAYOUT_PROFILES[`${widthPx}x${heightPx}`];
  if (profile) return profile();
  const rawScale = Math.min(widthPx / 296, heightPx / 152);
  if (rawScale >= 2) return scaleNewsLayout(deriveNewsLayout(296, 152), Math.floor(rawScale));
  const scale = Math.min(1, rawScale);
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

/** 已知面板的物理参数（按几何命中；未登记的面板沿用默认 dpi 250）。尺寸为标称对角线换算的估值。 */
const EINK_PANEL_PHYSICAL: Record<string, { dpi: number; physical: { widthMm: number; heightMm: number }; fontStack?: string[] }> = {
  '800x480': { dpi: 235, physical: { widthMm: 86.4, heightMm: 51.9 }, fontStack: ['SmileySans', 'AlibabaPuHuiTi-Regular'] },   // 3.97" GDEY0397T81P
};

/** 构造一个可直接用于 Satori 的电子纸 RenderTarget。 */
export function createEinkTarget(widthPx: number, heightPx: number, id = `eink-${widthPx}x${heightPx}`): RenderTarget {
  const panel = EINK_PANEL_PHYSICAL[`${widthPx}x${heightPx}`];
  return {
    id,
    kind: 'eink',
    widthPx,
    heightPx,
    dpi: panel?.dpi ?? 250,
    colorMode: 'mono-1bit',
    ...(panel ? { physical: { ...panel.physical } } : {}),
    defaultFontStack: panel?.fontStack ?? ['fusion-pixel-12'],
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
export const EINK_800X480_TARGET: RenderTarget = createEinkTarget(800, 480, 'eink-800x480');   // 3.97" 3× 版式

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
  EINK_800X480_TARGET,
  LABEL_T40X20_TARGET,
  LABEL_T20X8_TARGET,
];
