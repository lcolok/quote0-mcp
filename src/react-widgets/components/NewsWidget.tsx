/**
 * 文字新闻组件
 * 适配水墨屏显示的新闻内容展示
 */

import React from 'react';
import { WidgetProps } from '../core/widget-plugin.js';
import { smartFont } from '../utils/smart-font-utils.js';
import { HighlightedWord } from '../services/llm-workflow-engine.js';

export interface NewsData {
  title: string;
  message: string;
  signature: string;
  source?: string;
  publishTime?: string;
  category?: string;
  link?: string;
  highlights?: HighlightedWord[];  // 新增高亮词汇支持
}

export const NewsWidget: React.FC<WidgetProps<NewsData>> = ({ data }) => {
  const { title, message, source, highlights } = data;
  
  // 智能计算标题行数和高度
  const calculateTitleLayout = (title: string, maxWidth: number = 284) => {
    const fontSize = 28; // 更新字体大小为28px
    const charWidth = fontSize * 0.8; // 优化中文字符宽度（28px * 0.8 = 22.4px）
    const maxCharsPerLine = Math.floor(maxWidth / charWidth);
    
    // 计算实际需要的行数
    let estimatedLines = Math.ceil(title.length / maxCharsPerLine);
    
    // 限制最大行数为3行，确保布局不会过高
    const maxLines = 3;
    const actualLines = Math.min(estimatedLines, maxLines);
    
    // 根据行数计算合适的高度
    const lineHeight = fontSize * 1.1;
    const padding = 8; // 上下padding总和
    const minHeight = 42; // 调整最小高度适配28px字体
    const calculatedHeight = Math.max(minHeight, actualLines * lineHeight + padding);
    
    return {
      lines: actualLines,
      height: calculatedHeight,
      lineHeight: lineHeight / fontSize // 相对行高
    };
  };
  
  const titleLayout = calculateTitleLayout(title);
  
  // 渲染带高亮的文本
  const renderHighlightedText = (text: string, highlights: HighlightedWord[] = []) => {
    if (!highlights || highlights.length === 0) {
      return <span>{text}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    // 按位置排序高亮词汇
    const sortedHighlights = [...highlights].sort((a, b) => a.startIndex - b.startIndex);

    for (const highlight of sortedHighlights) {
      // 添加高亮前的普通文本
      if (highlight.startIndex > lastIndex) {
        elements.push(
          <span key={`text-${lastIndex}`}>
            {text.substring(lastIndex, highlight.startIndex)}
          </span>
        );
      }

      // 添加高亮文本（反色显示）
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

    // 添加最后剩余的普通文本
    if (lastIndex < text.length) {
      elements.push(
        <span key={`text-${lastIndex}`}>
          {text.substring(lastIndex)}
        </span>
      );
    }

    return <>{elements}</>;
  };
  
  // 使用智能字体样式
  const contentFont = smartFont(12);  // 12px = 12px基础字体×1，A级渲染

  // 计算内容区域高度（总高度 - 标题高度 - 底部高度）
  const contentHeight = 152 - titleLayout.height - 16;
  
  return (
    <div style={{
      width: '296px',
      height: '152px',
      backgroundColor: '#FFFFFF',
      ...contentFont,  // 使用智能字体样式
      padding: '0px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 动态标题banner - 根据标题长度调整行数和高度 */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        height: `${titleLayout.height}px`,
        paddingLeft: '6px',
        paddingRight: '6px',
        paddingTop: '4px',
        paddingBottom: '4px',
        backgroundColor: 'black',
        color: 'white',
        transition: 'height 0.2s ease-in-out' // 平滑高度变化
      }}>
        <div style={{
          fontSize: '28px',
          fontWeight: 'normal',
          lineHeight: titleLayout.lineHeight,
          wordWrap: 'break-word',
          wordBreak: 'break-all', // 强制在任何字符处断行
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: titleLayout.lines,
          WebkitBoxOrient: 'vertical',
          width: '100%',
          whiteSpace: 'normal' // 确保允许换行
        }}>
          {title}
        </div>
      </div>

      {/* 自适应主内容区域 - 根据标题高度动态调整 */}
      <div style={{
        height: `${contentHeight}px`,
        display: 'flex',
        flexDirection: 'column',
        paddingLeft: '4px',
        paddingRight: '4px',
        paddingTop: '2px',
        overflow: 'hidden',
        transition: 'height 0.2s ease-in-out' // 平滑高度变化
      }}>
        {/* 新闻内容 */}
        <div style={{
          flex: 1,
          ...contentFont,
          color: '#333333',
          overflow: 'hidden'
        }}>
          {renderHighlightedText(message, highlights)}
        </div>
      </div>

      {/* 底部信息栏 - 单条banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '16px',
        paddingLeft: '4px',
        paddingRight: '4px',
        borderTop: '1px solid rgba(0,0,0,0.1)',
        fontSize: '12px',
        color: '#333',
        fontWeight: 'normal',
        textAlign: 'center'
      }}>
        <span>来源: {source || '未知'}</span>
      </div>
    </div>
  );
};