/**
 * Satori 兼容的天气组件
 * 针对 Satori 渲染器优化，遵循 Satori 的限制：
 * - 所有 div 必须显式设置 display: flex
 * - 不支持 grid 布局
 * - 不支持 z-index
 * - 不支持 calc()
 * - 不支持 SVG 图标（使用文本替代）
 * 
 * 像素字体处理：
 * - 使用原生字体尺寸 (8px, 10px, 12px)
 * - 对于大标题，使用 12px 字体 + 整数倍缩放
 */

import React from 'react';
import { WeatherData } from '../types.js';

interface SatoriWeatherWidgetProps {
  data: WeatherData;
  invertedBanner?: boolean;
}

// 天气图标映射 - 使用文本符号替代SVG图标
const getWeatherIconText = (weather: string): string => {
  const weatherLower = weather.toLowerCase();
  
  // 晴天类型
  if (weatherLower.includes('晴') || weatherLower.includes('sunny') || weatherLower.includes('clear')) {
    return '☀';
  }
  
  // 阴天/全云类型
  if (weatherLower.includes('阴') || weatherLower.includes('overcast')) {
    return '☁';
  }
  
  // 多云类型
  if (weatherLower.includes('多云') || weatherLower.includes('cloudy') || weatherLower.includes('partly')) {
    return '⛅';
  }
  
  // 阵雨/淋雨类型
  if (weatherLower.includes('阵雨') || weatherLower.includes('shower')) {
    return '🌦';
  }
  
  // 雷阵雨类型
  if (weatherLower.includes('雷阵雨') || weatherLower.includes('雷雨')) {
    return '⛈';
  }
  
  // 普通雨天类型
  if (weatherLower.includes('雨') || weatherLower.includes('rain') || weatherLower.includes('drizzle')) {
    return '🌧';
  }
  
  // 雷暴类型
  if (weatherLower.includes('雷') || weatherLower.includes('thunder') || weatherLower.includes('storm')) {
    return '⛈';
  }
  
  // 雨夹雪/雨雪类型
  if (weatherLower.includes('雨夹雪') || weatherLower.includes('sleet')) {
    return '🌨';
  }
  
  // 雪天类型
  if (weatherLower.includes('雪') || weatherLower.includes('snow')) {
    return '❄';
  }
  
  // 雾天类型
  if (weatherLower.includes('雾') || weatherLower.includes('fog')) {
    return '🌫';
  }
  
  // 霾/烟雾类型
  if (weatherLower.includes('霾') || weatherLower.includes('haze') || weatherLower.includes('smog')) {
    return '🌫';
  }
  
  // 大风类型
  if (weatherLower.includes('大风') || weatherLower.includes('windy') || weatherLower.includes('gust')) {
    return '💨';
  }
  
  // 冰雹类型
  if (weatherLower.includes('冰雹') || weatherLower.includes('hail')) {
    return '🌨';
  }
  
  // 默认 - 多云
  return '⛅';
};

// 湿度图标
const getHumidityIcon = (): string => {
  return '💧';
};

const SatoriWeatherWidget: React.FC<SatoriWeatherWidgetProps> = ({ data, invertedBanner = true }) => {
  // 构建城市显示文本：简化版本，依赖动态获取的准确数据
  const getCityDisplayText = () => {
    // 如果有省份和城市信息，进行基本格式化
    if (data.province && data.city) {
      const cityName = data.city.replace(/(市|区|县)$/, '');
      const provinceName = data.province.replace(/省$/, '');
      
      // 如果是区县级别，显示省份+区县名
      if (data.city.match(/(区|县)$/)) {
        return `${provinceName}${cityName}`;
      } else {
        // 地级市显示省份+城市名
        return `${provinceName}${cityName}`;
      }
    }
    
    // 回退到原始城市名（去掉后缀）
    return data.city?.replace(/(市|区|县)$/, '') || '未知';
  };

  // 获取体感温度：优先使用API直接提供的数据
  const getFeelsLikeTemp = (): number => {
    // 如果API提供了体感温度，直接使用
    if (data.feelst !== undefined) {
      return data.feelst;
    }
    
    // 回退：如果没有体感温度数据，使用实际温度
    return data.temperature;
  };

  return (
    <div style={{
      width: '296px',
      height: '152px',
      backgroundColor: '#FFFFFF',
      fontFamily: 'FusionPixelFont',
      fontSize: '12px',
      lineHeight: '14px',
      padding: '0px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 顶部信息条：城市 + 湿度 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '32px',
        paddingLeft: '6px',
        paddingRight: '6px',
        backgroundColor: invertedBanner ? '#000000' : '#FFFFFF',
        color: invertedBanner ? '#FFFFFF' : '#000000',
        flexShrink: 0
      }}>
        <div style={{
          fontFamily: 'FusionPixelFont',
          fontSize: '24px',
          lineHeight: '26px',
          fontWeight: 'normal'
        }}>
          {getCityDisplayText()}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          fontFamily: 'FusionPixelFont',
          fontSize: '24px',
          lineHeight: '26px'
        }}>
          <span>{getHumidityIcon()}</span>
          <span>{data.humidity}%</span>
        </div>
      </div>
      
      {/* 主内容：超大温度 + 大天气图标 */}
      <div style={{
        height: '104px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '8px',
        paddingRight: '8px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'flex-start',
          gap: '4px'
        }}>
          <div style={{
            fontFamily: 'FusionPixelFont',
            fontSize: '96px',
            lineHeight: '80px',
            fontWeight: 'normal',
            letterSpacing: '-4px',
            textAlign: 'left'
          }}>
            {data.temperature}
          </div>
          <div style={{
            fontFamily: 'FusionPixelFont',
            fontSize: '36px',
            lineHeight: '38px',
            fontWeight: 'normal',
            alignSelf: 'flex-start',
            marginTop: '8px'
          }}>
            °C
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px'
        }}>
          <div style={{
            fontFamily: 'FusionPixelFont',
            fontSize: '80px',
            lineHeight: '82px',
            textAlign: 'center'
          }}>
            {getWeatherIconText(data.weather)}
          </div>
          <div style={{
            fontFamily: 'FusionPixelFont',
            fontSize: '24px',
            lineHeight: '26px',
            fontWeight: 'normal',
            textAlign: 'center',
            writingMode: 'vertical-rl',
            textOrientation: 'upright',
            letterSpacing: '6px'
          }}>
            {data.weather}
          </div>
        </div>
      </div>

      {/* 底部横条banner：体感温度 + 风向风力 + 明日天气 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        height: '16px',
        paddingLeft: '4px',
        paddingRight: '4px',
        borderTop: '1px solid rgba(0,0,0,0.1)',
        backgroundColor: invertedBanner ? '#000000' : 'rgba(0,0,0,0.05)',
        color: invertedBanner ? '#FFFFFF' : '#333333',
        fontFamily: 'FusionPixelFont',
        fontSize: '12px',
        lineHeight: '14px',
        fontWeight: 'normal',
        textAlign: 'center'
      }}>
        <div style={{
          minWidth: '80px',
          whiteSpace: 'nowrap'
        }}>
          体感 {getFeelsLikeTemp()}°C
        </div>
        <div style={{
          minWidth: '80px',
          whiteSpace: 'nowrap'
        }}>
          {data.windDirection ? `${data.windDirection}风 ${data.windPower?.replace('≤', '≤ ') || ''}` : `风力 ${data.windPower || 'N/A'}`}
        </div>
        <div style={{
          minWidth: '80px',
          whiteSpace: 'nowrap'
        }}>
          明日 {data.tomorrowWeather || data.forecast?.tomorrow?.weather || '未知'}
        </div>
      </div>
    </div>
  );
};

export { SatoriWeatherWidget };