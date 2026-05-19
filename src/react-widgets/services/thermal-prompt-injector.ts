/**
 * 热敏标签 prompt 注入器：在用户 prompt 后追加设计约束，让 BizyAir image model
 * 输出适合 1-bit 黑白热敏打印的图像。
 *
 * 设计哲学：
 * - 文本约束（英文，图像模型训练数据英文最丰富）而非结构化参数适配
 * - 短而精炼，不淹没用户原意
 * - 用户 prompt 在前主导，约束在后做"风格 hint"
 */

export interface ThermalLabelContext {
  widthMm?: number;
  heightMm?: number;
  widthPx?: number;
  heightPx?: number;
}

export function buildThermalLabelPrompt(
  userPrompt: string,
  context?: ThermalLabelContext | null
): string {
  const sizeDesc =
    context?.widthMm && context.heightMm
      ? `${context.widthMm}×${context.heightMm}mm`
      : 'small horizontal';

  const pxDesc =
    context?.widthPx && context.heightPx
      ? ` (${context.widthPx}×${context.heightPx} pixels)`
      : '';

  const aspect =
    context?.widthPx && context.heightPx
      ? context.widthPx / context.heightPx
      : null;

  const layoutHint = !aspect
    ? 'horizontal wide banner layout'
    : aspect >= 1.7
      ? 'horizontal wide banner layout (approximately 2:1 aspect ratio)'
      : aspect >= 1.2
        ? 'horizontal landscape layout'
        : aspect >= 0.8
          ? 'roughly square layout'
          : 'vertical portrait layout';

  const constraints = [
    `Output style: Designed for thermal label printer, label size ${sizeDesc}${pxDesc}.`,
    `Composition: ${layoutHint}, with sufficient white margin around all edges for printer alignment.`,
    'Colors: Pure black and white only — no grayscale, no gradients, no shadows, no anti-aliasing, no semi-transparent regions.',
    'Strokes: Use thick bold lines and large solid black or white shapes, optimized for clean 1-bit dithering at small print sizes.',
    'Aesthetic: Minimal flat illustration / sticker / icon / decorative print, high visual clarity.',
  ].join(' ');

  return `${userPrompt}\n\n${constraints}`;
}
