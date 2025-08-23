/**
 * 文字新闻组件
 * 适配水墨屏显示的新闻内容展示
 */

import React from 'react';
import { WidgetProps } from '../core/widget-plugin.js';
import { smartFont } from '../utils/smart-font-utils.js';

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

export const NewsWidget: React.FC<WidgetProps<NewsData>> = ({ data }) => {
  const { title, summary, source, publishTime, category, items } = data;
  
  // 使用智能字体样式
  const titleFont = smartFont(12);  // 12px = 12px基础字体×1，A级渲染

  return (
    <div style={{
      width: '296px',
      height: '152px',
      backgroundColor: '#FFFFFF',
      ...titleFont,  // 使用智能字体样式
      padding: '0px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 顶部信息条 - 效仿天气组件样式 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
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
          lineHeight: '1'
        }}>
{category || '实时新闻'}
        </div>
        <div style={{
          fontSize: '12px',
          color: 'white',
          fontWeight: 'normal'
        }}>
          {new Date(publishTime).toLocaleDateString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
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
        {/* 主新闻标题 */}
      {title && (
        <div style={{
          fontSize: '12px',
          fontWeight: 'normal',
          color: '#000000',
          marginBottom: '2px',
          lineHeight: '14px'
        }}>
          {title.length > 28 ? `${title.substring(0, 25)}...` : title}
        </div>
      )}

      {/* 摘要 */}
      {summary && (
        <div style={{
          fontSize: '12px',
          color: '#333333',
          marginBottom: '2px',
          lineHeight: '14px'
        }}>
          {summary.length > 40 ? `${summary.substring(0, 37)}...` : summary}
        </div>
      )}

      {/* 新闻列表 */}
      {items && items.length > 0 && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '1px'
        }}>
          {items.slice(0, 4).map((item, index) => (
            <div key={index} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '4px',
              fontSize: '12px',
              lineHeight: '14px'
            }}>
              <span style={{
                color: '#666666',
                minWidth: '16px',
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
                  marginBottom: '1px',
                  fontSize: '12px'
                }}>
                  {item.title.length > 22 ? `${item.title.substring(0, 19)}...` : item.title}
                </div>
                {item.source && (
                  <div style={{
                    fontSize: '12px',
                    color: '#999999',
                    lineHeight: '12px'
                  }}>
                    {item.source} {item.time && `• ${item.time}`}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {/* 底部信息栏 - 效仿天气组件样式 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-around',
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
        <span>来源: {source}</span>
        <span>{items ? `共${items.length}条` : '单条新闻'}</span>
      </div>
    </div>
  );
};