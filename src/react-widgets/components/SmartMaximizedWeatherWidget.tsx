/**
 * 智能字体优化版最大化天气组件
 */

import React from 'react';
import { WeatherData } from '../types.js';
import { generateSmartFontCSS, generateOptimizationReport } from '../smart-font-css';

// 矢量图标 - 使用实心版本
import { 
  MdSunny, MdCloud, MdGrain, MdAcUnit, MdFlashOn 
} from 'react-icons/md';
import { BsDropletFill } from 'react-icons/bs';

interface SmartMaximizedWeatherWidgetProps {
  data: WeatherData;
  fontServerUrl: string;
}

const SmartMaximizedWeatherWidget: React.FC<SmartMaximizedWeatherWidgetProps> = ({ data, fontServerUrl }) => {
  // 优化后的字体大小 - 基于智能字体分析
  const optimizedSizes = {
    city: 30,        // 28px → 30px (10px × 3, 完美对齐)
    humidity: 24,    // 24px (12px × 2, 已完美)
    weather: 30,     // 28px → 30px (10px × 3, 完美对齐)  
    temperature: 108, // 108px (12px × 9, 已完美)
    degree: 36       // 36px (12px × 3, 已完美)
  };

  // 生成智能字体CSS
  const fontSizes = Object.values(optimizedSizes);
  const smartFontCSS = generateSmartFontCSS(fontSizes, fontServerUrl);

  // 输出优化报告到控制台
  React.useEffect(() => {
    console.log(generateOptimizationReport(fontSizes));
  }, []);

  // 超大实心天气图标
  const getWeatherIcon = (weather: string) => {
    const iconProps = { size: 96, color: '#000' }; // 最大化天气图标
    
    switch (weather.toLowerCase()) {
      case 'sunny':
      case '晴':
      case 'clear':
        return <MdSunny {...iconProps} />;
      case 'cloudy':
      case '多云':
      case 'overcast':
        return <MdCloud {...iconProps} />;
      case 'rainy':
      case '雨':
      case 'rain':
        return <MdGrain {...iconProps} />;
      case 'snow':
      case '雪':
        return <MdAcUnit {...iconProps} />;
      case 'thunderstorm':
      case '雷雨':
        return <MdFlashOn {...iconProps} />;
      default:
        return <MdSunny {...iconProps} />;
    }
  };

  // 容器 - 完全填满屏幕
  const containerStyle: React.CSSProperties = {
    width: '296px',
    height: '152px',
    margin: 0,
    padding: 0,
    backgroundColor: 'white',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    fontFamily: 'monospace',
    WebkitFontSmoothing: 'none',
    MozOsxFontSmoothing: 'unset',
    textRendering: 'optimizeSpeed',
    imageRendering: 'pixelated' as any
  };

  // 顶部信息条样式
  const topBarStyle: React.CSSProperties = {
    backgroundColor: 'black',
    color: 'white',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 8px',
    height: '40px',
    fontSize: `${optimizedSizes.city}px`,
    fontFamily: `fusion-pixel-${optimizedSizes.city}px, monospace`
  };

  const cityStyle: React.CSSProperties = {
    fontSize: `${optimizedSizes.city}px`,
    fontWeight: 'normal',
    lineHeight: '1',
    fontFamily: `fusion-pixel-${optimizedSizes.city}px, monospace`
  };

  const humidityStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: `${optimizedSizes.humidity}px`,
    fontFamily: `fusion-pixel-${optimizedSizes.humidity}px, monospace`
  };

  // 主内容区域
  const mainContentStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px'
  };

  // 左侧温度显示
  const temperatureSectionStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px'
  };

  const tempStyle: React.CSSProperties = {
    fontSize: `${optimizedSizes.temperature}px`,
    fontWeight: 'normal',
    lineHeight: '0.8',
    letterSpacing: '-4px',
    textAlign: 'left',
    fontFamily: `fusion-pixel-${optimizedSizes.temperature}px, monospace`
  };

  const degreeStyle: React.CSSProperties = {
    fontSize: `${optimizedSizes.degree}px`,
    fontWeight: 'normal',
    alignSelf: 'flex-start',
    marginTop: '8px',
    fontFamily: `fusion-pixel-${optimizedSizes.degree}px, monospace`
  };

  // 右侧天气图标区域 - 适应竖排文字
  const weatherSectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px'
  };

  const weatherTextStyle: React.CSSProperties = {
    fontSize: `${optimizedSizes.weather}px`,
    fontWeight: 'normal',
    textAlign: 'center',
    writingMode: 'vertical-rl',
    textOrientation: 'upright',
    letterSpacing: '6px',
    fontFamily: `fusion-pixel-${optimizedSizes.weather}px, monospace`
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: smartFontCSS }} />
      <div style={containerStyle}>
        {/* 顶部信息条：城市 + 湿度 */}
        <div style={topBarStyle}>
          <div style={cityStyle}>{data.city}</div>
          <div style={humidityStyle}>
            <BsDropletFill size={24} color="white" />
            <span>{data.humidity}%</span>
          </div>
        </div>

        {/* 主要内容区域 */}
        <div style={mainContentStyle}>
          {/* 左侧：温度 */}
          <div style={temperatureSectionStyle}>
            <span style={tempStyle}>{data.temperature}</span>
            <span style={degreeStyle}>°C</span>
          </div>

          {/* 右侧：天气图标 + 竖排描述 */}
          <div style={weatherSectionStyle}>
            {getWeatherIcon(data.weather)}
            <div style={weatherTextStyle}>{data.weather}</div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SmartMaximizedWeatherWidget;