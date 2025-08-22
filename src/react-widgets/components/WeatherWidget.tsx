/**
 * 天气小组件 - 专为 296x152 水墨屏优化
 */

import React from 'react';
import { WeatherData, WidgetConfig } from '../types.js';

interface WeatherWidgetProps {
  data: WeatherData;
  config?: Partial<WidgetConfig>;
}

const DEFAULT_CONFIG: WidgetConfig = {
  width: 296,
  height: 152,
  theme: 'eink',
  fontSize: 'small'
};

export const WeatherWidget: React.FC<WeatherWidgetProps> = ({ 
  data, 
  config = {} 
}) => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // 获取天气图标（文字版本，适合水墨屏）
  const getWeatherIcon = (weather: string): string => {
    const iconMap: Record<string, string> = {
      '晴': '☀',
      '多云': '☁',
      '阴': '☁',
      '小雨': '🌦',
      '中雨': '🌧',
      '大雨': '⛈',
      '雷阵雨': '⛈',
      '雪': '❄',
      '雾': '🌫'
    };
    return iconMap[weather] || '☀';
  };

  // 获取AQI颜色类名（水墨屏友好）
  const getAQIClass = (level: string): string => {
    const levelMap: Record<string, string> = {
      '优': 'aqi-excellent',
      '良': 'aqi-good', 
      '轻度污染': 'aqi-moderate',
      '中度污染': 'aqi-unhealthy',
      '重度污染': 'aqi-very-unhealthy'
    };
    return levelMap[level] || 'aqi-good';
  };

  const styles: React.CSSProperties = {
    width: finalConfig.width,
    height: finalConfig.height,
    backgroundColor: finalConfig.theme === 'eink' ? '#FFFFFF' : '#000000',
    color: finalConfig.theme === 'eink' ? '#000000' : '#FFFFFF',
    fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
    fontSize: finalConfig.fontSize === 'small' ? '12px' : '14px',
    padding: '8px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid #000000'
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
    fontSize: '14px',
    fontWeight: 'bold'
  };

  const mainContentStyle: React.CSSProperties = {
    display: 'flex',
    flex: 1,
    gap: '8px'
  };

  const leftColumnStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center'
  };

  const rightColumnStyle: React.CSSProperties = {
    flex: 1,
    fontSize: '10px',
    lineHeight: '1.3'
  };

  const temperatureStyle: React.CSSProperties = {
    fontSize: '32px',
    fontWeight: 'bold',
    margin: '4px 0'
  };

  const weatherIconStyle: React.CSSProperties = {
    fontSize: '24px',
    margin: '2px 0'
  };

  const footerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    marginTop: '4px',
    paddingTop: '4px',
    borderTop: '1px solid #000000'
  };

  return (
    <div style={styles}>
      {/* 头部：城市名和日期时间 */}
      <div style={headerStyle}>
        <span>{data.city}</span>
        <span>{new Date().toLocaleDateString('zh-CN', { 
          month: 'short', 
          day: 'numeric',
          weekday: 'short'
        })}</span>
      </div>

      {/* 主要内容区 */}
      <div style={mainContentStyle}>
        {/* 左侧：温度和天气图标 */}
        <div style={leftColumnStyle}>
          <div style={weatherIconStyle}>{getWeatherIcon(data.weather)}</div>
          <div style={temperatureStyle}>{data.temperature}°</div>
          <div style={{ fontSize: '12px' }}>{data.weather}</div>
        </div>

        {/* 右侧：详细信息 */}
        <div style={rightColumnStyle}>
          <div><strong>湿度:</strong> {data.humidity}%</div>
          <div><strong>风向:</strong> {data.windDirection} {data.windLevel}级</div>
          <div><strong>气压:</strong> {data.pressure}hPa</div>
          <div><strong>空气:</strong> 
            <span className={getAQIClass(data.aqiLevel)}> {data.aqiLevel} {data.aqi}</span>
          </div>
          <div style={{ marginTop: '4px', fontSize: '9px' }}>
            <div>日出 {data.sunrise} | 日落 {data.sunset}</div>
          </div>
        </div>
      </div>

      {/* 底部：明日预报 */}
      <div style={footerStyle}>
        <span>
          明日: {data.forecast.tomorrow.weather} 
        </span>
        <span>
          {data.forecast.tomorrow.tempRange.min}°-{data.forecast.tomorrow.tempRange.max}°
        </span>
      </div>
    </div>
  );
};

export default WeatherWidget;