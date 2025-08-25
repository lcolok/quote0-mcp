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
  
  // 使用智能字体样式
  const titleFont = smartFont(24);   // 28px字体 - 使用智能字体系统
  const contentFont = smartFont(12);  // 12px字体 - A级渲染
  
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
      {/* 动态标题banner - 完全自适应内容高度 */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        // 移除固定高度限制，让内容自然撑开
        paddingLeft: '6px',
        paddingRight: '6px',
        paddingTop: '4px',
        paddingBottom: '4px',
        backgroundColor: 'black',
        color: 'white',
        flexShrink: 0  // 防止被压缩
      }}>
        <div style={{
          ...titleFont,  // 使用智能字体系统
          fontWeight: 'normal',
          lineHeight: 1.1,
          wordWrap: 'break-word',
          wordBreak: 'normal', // 使用正常的换行规则（英文在单词边界换行，中文任意位置）
          width: '100%',
          whiteSpace: 'normal' // 允许自然换行
        }}>
          {title}
        </div>
      </div>

      {/* 主内容区域 - 使用flex自动填充剩余空间 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        paddingLeft: '4px',
        paddingRight: '4px',
        paddingTop: '2px',
        overflow: 'hidden'
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
        ...contentFont,  // 使用智能字体系统（同内容12px）
        color: '#333',
        fontWeight: 'normal',
        textAlign: 'center'
      }}>
        <span>来源: {source || '未知'}</span>
      </div>
    </div>
  );
};