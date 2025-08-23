/**
 * 文字新闻组件
 * 适配水墨屏显示的新闻内容展示
 */

import React from 'react';
import { WidgetProps } from '../core/widget-plugin.js';
import { FontLoader } from '../font-loader.js';

export interface NewsData {
  title: string;
  summary?: string;
  source: string;
  publishTime: string;
  category?: string;
  items?: NewsItem[];
}

export interface NewsItem {
  title: string;
  source?: string;
  time?: string;
}

export const NewsWidget: React.FC<WidgetProps<NewsData>> = ({ data, config }) => {
  const { title, summary, source, publishTime, category, items } = data;
  const borderColor = config?.border === '1' ? '#000000' : '#FFFFFF';

  return (
    <div style={{
      width: '296px',
      height: '152px',
      backgroundColor: '#FFFFFF',
      border: `2px solid ${borderColor}`,
      fontFamily: FontLoader.getFusionPixelFontFamily(),
      fontSize: '12px',
      lineHeight: '14px',
      padding: '8px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '6px',
        paddingBottom: '4px',
        borderBottom: '1px solid #333333'
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 'normal',
          color: '#000000'
        }}>
          📰 {category || '实时新闻'}
        </div>
        <div style={{
          fontSize: '12px',
          color: '#666666'
        }}>
          {new Date(publishTime).toLocaleDateString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>
      </div>

      {/* 主新闻标题 */}
      {title && (
        <div style={{
          fontSize: '12px',
          fontWeight: 'normal',
          color: '#000000',
          marginBottom: '4px',
          lineHeight: '14px'
        }}>
          {title.length > 35 ? `${title.substring(0, 32)}...` : title}
        </div>
      )}

      {/* 摘要 */}
      {summary && (
        <div style={{
          fontSize: '12px',
          color: '#333333',
          marginBottom: '6px',
          lineHeight: '14px'
        }}>
          {summary.length > 55 ? `${summary.substring(0, 52)}...` : summary}
        </div>
      )}

      {/* 新闻列表 */}
      {items && items.length > 0 && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}>
          {items.slice(0, 5).map((item, index) => (
            <div key={index} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '4px',
              fontSize: '12px'
            }}>
              <span style={{
                color: '#666666',
                minWidth: '12px',
                fontSize: '12px'
              }}>
                {index + 1}.
              </span>
              <div style={{
                flex: 1,
                lineHeight: '14px'
              }}>
                <div style={{
                  color: '#000000',
                  marginBottom: '1px'
                }}>
                  {item.title.length > 32 ? `${item.title.substring(0, 29)}...` : item.title}
                </div>
                {item.source && (
                  <div style={{
                    fontSize: '12px',
                    color: '#999999'
                  }}>
                    {item.source} {item.time && `• ${item.time}`}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 底部信息栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '4px',
        paddingTop: '4px',
        borderTop: '1px solid #DDDDDD',
        fontSize: '12px',
        color: '#999999'
      }}>
        <span>来源: {source}</span>
        <span>{items ? `共${items.length}条` : '单条新闻'}</span>
      </div>
    </div>
  );
};