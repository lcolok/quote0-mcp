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

export const SatoriNewsWidget: React.FC<SatoriNewsWidgetProps> = ({ data, target = EINK_TARGET }) => {
  const { title, message, source, highlights } = data;
  const layout = target.newsLayout ?? deriveNewsLayout(target.widthPx, target.heightPx);
  const bodyFont = pixelFontStyle(layout.bodyFontPx);
  const titleFont = pixelFontStyle(layout.titleFontPx);
  const footerFont = pixelFontStyle(layout.footerFontPx);
  
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
        ...footerFont,
        lineHeight: `${layout.footerLineHeightPx}px`,
        color: '#333',
        fontWeight: 'normal',
        textAlign: 'center'
      }}>
        <span>来源: {source || '未知'}</span>
      </div>
    </div>
  );
};
