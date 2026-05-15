/**
 * 极简天气组件 - 专为 296x152 超小屏幕优化
 * 只显示最核心的信息，确保清晰可读
 */

import React from 'react';
import { WeatherData } from '../types.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from '../core/device-constants.js';

interface CompactWeatherWidgetProps {
  data: WeatherData;
}

export const CompactWeatherWidget: React.FC<CompactWeatherWidgetProps> = ({ data }) => {
  // 获取简化的天气图标
  const getWeatherIcon = (weather: string): string => {
    const iconMap: Record<string, string> = {
      '晴': '☀',
      '多云': '☁',
      '阴': '☁',
      '小雨': '☂',
      '中雨': '☂',
      '大雨': '☂',
      '雷阵雨': '⚡',
      '雪': '❄',
      '雾': '〜'
    };
    return iconMap[weather] || '☀';
  };

  // 容器样式 - 占满整个屏幕
  const containerStyle: React.CSSProperties = {
    width: `${EINK_DEVICE_WIDTH}px`,
    height: `${EINK_DEVICE_HEIGHT}px`,
    backgroundColor: '#FFFFFF',
    color: '#000000',
    fontFamily: 'Arial, sans-serif',
    padding: '6px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    border: '2px solid #000000',
    fontSize: '16px',
    fontWeight: 'bold',
    lineHeight: '1.2'
  };

  // 头部样式 - 城市和日期
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '4px',
    height: '22px'
  };

  // 主要内容区 - 温度和天气
  const mainStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: '16px'
  };

  // 温度显示样式
  const tempStyle: React.CSSProperties = {
    fontSize: '48px',
    fontWeight: 'bold',
    lineHeight: '1',
    textAlign: 'center'
  };

  // 天气图标和描述
  const weatherStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px'
  };

  const iconStyle: React.CSSProperties = {
    fontSize: '32px',
    lineHeight: '1'
  };

  const weatherTextStyle: React.CSSProperties = {
    fontSize: '16px',
    fontWeight: 'bold'
  };

  // 底部信息
  const footerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '14px',
    fontWeight: 'bold',
    marginTop: '4px',
    height: '18px'
  };

  const today = new Date();
  const dateStr = `${today.getMonth() + 1}/${today.getDate()}`;
  
  return (
    <div style={containerStyle}>
      {/* 顶部：城市和日期 */}
      <div style={headerStyle}>
        <span>{data.city}</span>
        <span>{dateStr}</span>
      </div>

      {/* 主体：温度和天气 */}
      <div style={mainStyle}>
        <div style={tempStyle}>
          {data.temperature}°
        </div>
        
        <div style={weatherStyle}>
          <div style={iconStyle}>{getWeatherIcon(data.weather)}</div>
          <div style={weatherTextStyle}>{data.weather}</div>
        </div>
      </div>

      {/* 底部：关键信息 */}
      <div style={footerStyle}>
        <span>湿度{data.humidity}%</span>
        <span>{data.windDirection}{data.windLevel}级</span>
        <span>空气{data.aqiLevel}</span>
      </div>
    </div>
  );
};

export default CompactWeatherWidget;