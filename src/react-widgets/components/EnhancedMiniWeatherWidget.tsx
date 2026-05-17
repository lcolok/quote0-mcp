import React from 'react';
import { WeatherData } from '../types.js';
import { FontLoader } from '../font-loader.js';

// 矢量图标 - 使用多个图标库的最佳选择
import { 
  WiDaySunny, WiCloudy, WiRain, WiSnow, WiThunderstorm, WiHumidity 
} from 'react-icons/wi';
import { FaTint } from 'react-icons/fa';
import { BsDroplet } from 'react-icons/bs';
import { EINK_TARGET, RenderTarget } from '../core/render-targets.js';

interface EnhancedMiniWeatherWidgetProps {
  data: WeatherData;
  target?: RenderTarget;
}

const EnhancedMiniWeatherWidget: React.FC<EnhancedMiniWeatherWidgetProps> = ({ data, target = EINK_TARGET }) => {
  // 根据天气状况选择图标
  const getWeatherIcon = (weather: string) => {
    const iconProps = { size: 56, color: '#000' };
    
    switch (weather.toLowerCase()) {
      case 'sunny':
      case '晴':
      case 'clear':
        return <WiDaySunny {...iconProps} />;
      case 'cloudy':
      case '多云':
      case 'overcast':
        return <WiCloudy {...iconProps} />;
      case 'rainy':
      case '雨':
      case 'rain':
        return <WiRain {...iconProps} />;
      case 'snow':
      case '雪':
        return <WiSnow {...iconProps} />;
      case 'thunderstorm':
      case '雷雨':
        return <WiThunderstorm {...iconProps} />;
      default:
        return <WiDaySunny {...iconProps} />;
    }
  };

  const containerStyle: React.CSSProperties = {
    width: `${target.widthPx}px`,
    height: `${target.heightPx}px`,
    backgroundColor: 'white',
    color: 'black',
    padding: '4px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: FontLoader.getFusionPixelFontFamily(),
    fontSize: '16px',
    fontWeight: 'normal',
    // 强制像素网格对齐
    imageRendering: 'pixelated',
    transform: 'translateZ(0)',
    // 确保容器本身像素对齐
    position: 'relative'
  };

  // 顶部区域：城市和天气图标
  const topSectionStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '56px',
    paddingBottom: '2px'
  };

  const cityStyle: React.CSSProperties = {
    fontSize: '24px', // 12px像素字体的2倍
    fontWeight: 'normal',
    lineHeight: '1',
    imageRendering: 'pixelated',
    textRendering: 'geometricPrecision'
  };

  // 中间区域：温度（占用最大空间）
  const middleSectionStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  };

  const tempStyle: React.CSSProperties = {
    fontSize: '84px', // 12px像素字体的7倍，确保像素对齐
    fontWeight: 'normal',
    lineHeight: '1',
    textAlign: 'center',
    letterSpacing: '0px', // 避免破坏像素对齐
    // 像素完美渲染
    imageRendering: 'pixelated',
    textRendering: 'geometricPrecision'
  };

  // 底部区域：湿度和天气描述
  const bottomSectionStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '28px',
    paddingTop: '2px'
  };

  const humidityStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px', // 原始像素字体大小
    imageRendering: 'pixelated',
    textRendering: 'geometricPrecision'
  };

  const weatherSectionStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  };

  const weatherTextStyle: React.CSSProperties = {
    fontSize: '12px', // 原始像素字体大小
    fontWeight: 'normal',
    imageRendering: 'pixelated',
    textRendering: 'geometricPrecision'
  };

  return (
    <div style={containerStyle}>
      {/* 顶部：城市和天气图标 */}
      <div style={topSectionStyle}>
        <div style={cityStyle}>{data.city}</div>
        {getWeatherIcon(data.weather)}
      </div>
      
      {/* 中间：超大温度显示（Flex占用最大空间）*/}
      <div style={middleSectionStyle}>
        <div style={tempStyle}>{data.temperature}°</div>
      </div>
      
      {/* 底部：湿度和天气描述 */}
      <div style={bottomSectionStyle}>
        <div style={humidityStyle}>
          <BsDroplet size={24} />
          <span>{data.humidity}%</span>
        </div>
        <div style={weatherSectionStyle}>
          <div style={weatherTextStyle}>{data.weather}</div>
        </div>
      </div>
    </div>
  );
};

export { EnhancedMiniWeatherWidget };