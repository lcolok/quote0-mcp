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
import { EINK_TARGET, RenderTarget } from '../core/render-targets.js';

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

export const SatoriNewsWidget: React.FC<SatoriNewsWidgetProps> = ({ data, target = EINK_TARGET }) => {
  const { title, message, source, highlights } = data;
  
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
            backgroundColor: '#000000',
            color: '#FFFFFF',
            padding: '2px 3px',
            margin: '0 1px',
            borderRadius: '3px',
            fontWeight: 'bold',
            border: '1px solid #000000'
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
      fontFamily: 'FusionPixelFont',
      fontSize: '12px',
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
        paddingLeft: '6px',
        paddingRight: '6px',
        paddingTop: '4px',
        paddingBottom: '4px',
        backgroundColor: 'black',
        color: 'white',
        flexShrink: 0
      }}>
        <div style={{
          fontFamily: 'FusionPixelFont',
          fontSize: '24px',
          lineHeight: '26px',
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
        paddingLeft: '4px',
        paddingRight: '4px',
        paddingTop: '2px',
        overflow: 'hidden'
      }}>
        <div style={{
          flex: 1,
          display: 'flex',
          fontFamily: 'FusionPixelFont',
          fontSize: '12px',
          lineHeight: '14px',
          color: '#333333',
          overflow: 'hidden'
        }}>
          <span>{renderHighlightedText(message, highlights)}</span>
        </div>
      </div>

      {/* 底部信息栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '16px',
        paddingLeft: '4px',
        paddingRight: '4px',
        borderTop: '1px solid rgba(0,0,0,0.1)',
        fontFamily: 'FusionPixelFont',
        fontSize: '12px',
        lineHeight: '14px',
        color: '#333',
        fontWeight: 'normal',
        textAlign: 'center'
      }}>
        <span>来源: {source || '未知'}</span>
      </div>
    </div>
  );
};
