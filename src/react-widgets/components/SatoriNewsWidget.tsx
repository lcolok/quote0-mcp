/**
 * Satori 兼容的新闻组件
 * 针对 Satori 渲染器优化，遵循 Satori 的限制：
 * - 所有 div 必须显式设置 display: flex
 * - 不支持 grid 布局
 * - 不支持 z-index
 * - 不支持 calc()
 * 
 * 像素字体处理：
 * - 使用原生字体尺寸 (8px, 10px, 12px)
 * - 对于大标题，使用 12px 字体 + 整数倍缩放
 */

import React from 'react';
import { WidgetProps } from '../core/widget-plugin.js';
import { HighlightedWord } from '../services/llm-workflow-engine.js';
import { EINK_TARGET, RenderTarget, deriveNewsLayout } from '../core/render-targets.js';
import { selectOptimalFont } from '../smart-font-selector.js';

export interface NewsData {
  title: string;
  message: string;
  signature: string;
  source?: string;
  publishTime?: string;
  category?: string;
  link?: string;
  highlights?: HighlightedWord[];
  metadata?: Record<string, any>;
}

interface SatoriNewsWidgetProps extends WidgetProps<NewsData> {
  target?: RenderTarget;
}

/**
 * Keep the Satori path aligned with the historical smartFont() path.
 *
 * Satori registers the native 8/10/12px pixel fonts under size-specific
 * families. Using the generic FusionPixelFont family silently falls back to
 * the 12px font for every CSS size, which breaks the old pixel-font mapping
 * for 10px/20px/24px text.
 */
function pixelFontStyle(targetSize: number): {
  fontFamily: string;
  fontSize: string;
} {
  const selection = selectOptimalFont(targetSize);
  return {
    fontFamily: `FusionPixelFont-${selection.baseFontSize}px`,
    fontSize: `${selection.actualSize}px`,
  };
}

function footerTextUnits(value: string): number {
  let units = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Fusion Pixel monospaced-zh_hans uses half-width advances for ASCII (6px at
    // the 12px base) and full-width advances for non-ASCII glyphs (12px).
    // In particular U+00B7 MIDDLE DOT is 12px, so treating only CJK ranges as
    // double-width underestimates real Satori width and can force a 16px footer
    // into two lines. Stay conservative for all non-ASCII glyphs.
    units += code <= 0x7f ? 1 : 2;
  }
  return units;
}

function truncateFooterToUnits(value: string, maxUnits: number): string {
  if (footerTextUnits(value) <= maxUnits) return value;
  const ellipsis = '…';
  const ellipsisUnits = footerTextUnits(ellipsis);
  const budget = Math.max(0, maxUnits - ellipsisUnits);
  let units = 0;
  let output = '';
  for (const char of value) {
    const charUnits = footerTextUnits(char);
    if (units + charUnits > budget) break;
    output += char;
    units += charUnits;
  }
  return `${output.trimEnd()}${ellipsis}`;
}

function cleanFooterLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function compactDiscoveryLabel(value: string): string {
  const known: Record<string, string> = {
    'Hacker News': 'HN',
    'GitHub Changelog': 'GitHub',
    'Cloudflare Blog': 'Cloudflare',
    'DEV Community': 'DEV',
    'InfoQ 中文': 'InfoQ',
  };
  return known[value] || value;
}

export function buildNewsFooterText(data: NewsData, maxUnits = 48): string {
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata
    : {};
  const provenance = metadata.displayProvenance && typeof metadata.displayProvenance === 'object' && !Array.isArray(metadata.displayProvenance)
    ? metadata.displayProvenance as Record<string, any>
    : {};
  const publisher = cleanFooterLabel(provenance.publisher?.label) || cleanFooterLabel(data.source) || '未知';
  const discovery = cleanFooterLabel(provenance.discovery?.label);
  const receipt = metadata.researchReceipt && typeof metadata.researchReceipt === 'object' && !Array.isArray(metadata.researchReceipt)
    ? metadata.researchReceipt as Record<string, any>
    : {};
  const research = provenance.research && typeof provenance.research === 'object' && !Array.isArray(provenance.research)
    ? provenance.research as Record<string, any>
    : {};
  const isNeuromancer = cleanFooterLabel(research.agent).toLowerCase() === 'neuromancer'
    || cleanFooterLabel(receipt.agent).toLowerCase() === 'neuromancer'
    || data.signature === '神经漫游者';
  const evidenceCountRaw = Number(research.evidenceSourceCount ?? (Array.isArray(receipt.sources) ? receipt.sources.length : 0));
  const evidenceCount = Number.isFinite(evidenceCountRaw) && evidenceCountRaw > 0 ? Math.floor(evidenceCountRaw) : 0;
  const viaPart = discovery && discovery !== publisher ? ` · via ${discovery}` : '';
  const researchPart = isNeuromancer
    ? ` · Neuromancer研究${evidenceCount ? `·${evidenceCount}证据源` : ''}`
    : '';
  const compactViaPart = discovery && discovery !== publisher ? ` · via ${compactDiscoveryLabel(discovery)}` : '';
  const compactResearchPart = isNeuromancer
    ? ` · Neuromancer${evidenceCount ? `·${evidenceCount}证据源` : ''}`
    : '';
  const candidates = [
    `来源: ${publisher}${viaPart}${researchPart}`,
    `来源: ${publisher}${compactViaPart}${compactResearchPart}`,
    `来源: ${publisher}${researchPart}`,
    `来源: ${publisher}${compactResearchPart}`,
    isNeuromancer ? `${publisher} · Neuromancer研究` : `来源: ${publisher}`,
    `来源: ${publisher}`,
    publisher,
  ];
  const fitted = candidates.find((candidate) => footerTextUnits(candidate) <= maxUnits);
  return fitted || truncateFooterToUnits(`来源: ${publisher}`, maxUnits);
}

export const SatoriNewsWidget: React.FC<SatoriNewsWidgetProps> = ({ data, target = EINK_TARGET }) => {
  const { title, message, highlights } = data;
  const layout = target.newsLayout ?? deriveNewsLayout(target.widthPx, target.heightPx);
  // 大屏 target 的版式可指定矢量字体（family 已在 SatoriRenderer 注册）；未指定走像素字体整数倍。
  const vectorFont = (family: string | undefined, px: number) =>
    family ? { fontFamily: family, fontSize: `${px}px` } : null;
  const bodyFont = vectorFont(layout.bodyFontFamily, layout.bodyFontPx) ?? pixelFontStyle(layout.bodyFontPx);
  const titleFont = vectorFont(layout.titleFontFamily, layout.titleFontPx) ?? pixelFontStyle(layout.titleFontPx);
  const footerFont = vectorFont(layout.bodyFontFamily, layout.footerFontPx) ?? pixelFontStyle(layout.footerFontPx);
  const footerMaxUnits = Math.max(24, Math.floor((target.widthPx - 8) / Math.max(4, layout.footerFontPx / 2)));
  const footerText = buildNewsFooterText(data, footerMaxUnits);
  
  // 渲染带高亮的文本
  const renderHighlightedText = (text: string, highlights: HighlightedWord[] = []) => {
    if (!highlights || highlights.length === 0) {
      return <span>{text}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    const sortedHighlights = [...highlights].sort((a, b) => a.startIndex - b.startIndex);

    for (const highlight of sortedHighlights) {
      if (highlight.startIndex > lastIndex) {
        elements.push(
          <span key={`text-${lastIndex}`}>
            {text.substring(lastIndex, highlight.startIndex)}
          </span>
        );
      }

      elements.push(
        <span
          key={`highlight-${highlight.startIndex}`}
          style={{
            // Keep emphasis geometry-neutral. resvg can panic when multiple inline
            // background boxes cross the clipped body boundary; font emphasis does
            // not introduce extra SVG rect geometry or alter the text segmentation.
            fontWeight: 'bold'
          }}
        >
          {highlight.word}
        </span>
      );

      lastIndex = highlight.endIndex;
    }

    if (lastIndex < text.length) {
      elements.push(
        <span key={`text-${lastIndex}`}>
          {text.substring(lastIndex)}
        </span>
      );
    }

    return <>{elements}</>;
  };
  
  return (
    <div style={{
      width: `${target.widthPx}px`,
      height: `${target.heightPx}px`,
      backgroundColor: '#FFFFFF',
      ...bodyFont,
      lineHeight: '14px',
      padding: '0px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 标题 banner */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        paddingLeft: `${layout.titlePaddingXPx}px`,
        paddingRight: `${layout.titlePaddingXPx}px`,
        paddingTop: `${layout.titlePaddingTopPx}px`,
        paddingBottom: `${layout.titlePaddingBottomPx}px`,
        backgroundColor: 'black',
        color: 'white',
        flexShrink: 0
      }}>
        <div style={{
          ...titleFont,
          lineHeight: `${layout.titleLineHeightPx}px`,
          fontWeight: 'normal',
          wordWrap: 'break-word',
          wordBreak: 'normal',
          width: '100%',
          whiteSpace: 'normal'
        }}>
          {title}
        </div>
      </div>

      {/* 内容区域 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        paddingLeft: `${layout.bodyPaddingXPx}px`,
        paddingRight: `${layout.bodyPaddingXPx}px`,
        paddingTop: `${layout.bodyPaddingTopPx}px`,
        overflow: 'hidden'
      }}>
        <div style={{
          flex: 1,
          display: 'flex',
          ...bodyFont,
          lineHeight: `${layout.bodyLineHeightPx}px`,
          color: '#333333',
          overflow: 'hidden'
        }}>
          <span>{target.kind === 'eink' ? message : renderHighlightedText(message, highlights)}</span>
        </div>
      </div>

      {/* 底部信息栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: `${layout.footerHeightPx}px`,
        paddingLeft: '4px',
        paddingRight: '4px',
        borderTop: '1px solid rgba(0,0,0,0.1)',
        boxSizing: 'border-box',
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        ...footerFont,
        lineHeight: `${layout.footerLineHeightPx}px`,
        color: '#333',
        fontWeight: 'normal',
        textAlign: 'center'
      }}>
        <span style={{ display: 'block', maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap' }}>{footerText}</span>
      </div>
    </div>
  );
};
