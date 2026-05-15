/**
 * 超迷你天气组件 - 极度简化版本
 * 296x152 像素，只显示最关键信息
 */

import React from 'react';
import { WeatherData } from '../types.js';
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from '../core/device-constants.js';

interface MiniWeatherWidgetProps {
  data: WeatherData;
}

export const MiniWeatherWidget: React.FC<MiniWeatherWidgetProps> = ({ data }) => {
  
  const containerStyle: React.CSSProperties = {
    width: `${EINK_DEVICE_WIDTH}px`,
    height: `${EINK_DEVICE_HEIGHT}px`,
    backgroundColor: '#FFFFFF',
    color: '#000000',
    fontFamily: 'Arial, sans-serif',
    padding: '8px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    border: '3px solid #000000',
    fontSize: '20px',
    fontWeight: 'bold'
  };

  // 城市名 - 大字体
  const cityStyle: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: '8px',
    height: '30px',
    lineHeight: '30px'
  };

  // 主要内容 - 温度居中超大显示
  const mainStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1
  };

  const tempStyle: React.CSSProperties = {
    fontSize: '72px',
    fontWeight: 'bold',
    lineHeight: '1',
    textAlign: 'center'
  };

  // 底部一行信息
  const bottomStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '18px',
    fontWeight: 'bold',
    height: '24px'
  };
  
  return (
    <div style={containerStyle}>
      {/* 城市名 */}
      <div style={cityStyle}>
        {data.city}
      </div>

      {/* 中心温度 */}
      <div style={mainStyle}>
        <div style={tempStyle}>
          {data.temperature}°
        </div>
      </div>

      {/* 底部信息 */}
      <div style={bottomStyle}>
        <span>{data.weather}</span>
        <span>{data.humidity}%</span>
        <span>{data.aqiLevel}</span>
      </div>
    </div>
  );
};

export default MiniWeatherWidget;