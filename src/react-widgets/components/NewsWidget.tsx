/**
 * 文字新闻组件
 * 适配水墨屏显示的新闻内容展示
 */

import React from 'react';
import { WidgetProps } from '../core/widget-plugin.js';
import { smartFont } from '../utils/smart-font-utils.js';

export interface NewsData {
  title: string;
  message: string;
  signature: string;
  source?: string;
  publishTime?: string;
  category?: string;
  link?: string;
}

export const NewsWidget: React.FC<WidgetProps<NewsData>> = ({ data }) => {
  const { title, message, source } = data;
  
  // 使用智能字体样式
  const contentFont = smartFont(12);  // 12px = 12px基础字体×1，A级渲染

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
      {/* 顶部信息条 - 使用新闻标题 */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'center',
        height: '32px',
        paddingLeft: '6px',
        paddingRight: '6px',
        backgroundColor: 'black',
        color: 'white'
      }}>
        <div style={{
          fontSize: '28px',
          fontWeight: 'normal',
          lineHeight: '1',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {title}
        </div>
      </div>

      {/* 主内容区域 - 152px - 32px顶部 - 16px底部 = 104px */}
      <div style={{
        height: '104px',
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
          {message}
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