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

// 湿度图标（用中文字代替 emoji，FusionPixelFont 不支持 emoji）
const getHumidityIcon = (): string => {
  return '湿';
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

  // 缩放：原设计 296x152，目标 ESP32 640x384 = 2.16x / 2.53x
  // satori 不支持 transform: scale，所以直接放大每个元素的尺寸
  const SCALE = 640 / 296;  // ≈ 2.16
  const px = (n: number) => `${Math.round(n * SCALE)}px`;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#FFFFFF',
      fontFamily: 'FusionPixelFont',
      fontSize: px(12),
      lineHeight: px(14),
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
        height: px(40),
        paddingLeft: px(16),
        paddingRight: px(16),
        backgroundColor: invertedBanner ? '#000000' : '#FFFFFF',
        color: invertedBanner ? '#FFFFFF' : '#000000',
        flexShrink: 0
      }}>
        <div style={{
          display: 'flex',
          fontFamily: 'FusionPixelFont',
          fontSize: px(28),
          lineHeight: px(32),
          fontWeight: 'normal'
        }}>
          {getCityDisplayText()}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: px(8),
          fontFamily: 'FusionPixelFont',
          fontSize: px(28),
          lineHeight: px(32)
        }}>
          <span>{getHumidityIcon()}</span>
          <span>{data.humidity}%</span>
        </div>
      </div>

      {/* 主内容：超大温度 + 大天气图标 */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: px(16),
        paddingRight: px(16)
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'flex-start',
          gap: px(8)
        }}>
          <div style={{
            display: 'flex',
            fontFamily: 'FusionPixelFont',
            fontSize: px(95),
            lineHeight: px(95),
            fontWeight: 'normal',
            letterSpacing: '-2px'
          }}>
            {data.temperature}
          </div>
          <div style={{
            display: 'flex',
            fontFamily: 'FusionPixelFont',
            fontSize: px(40),
            lineHeight: px(40),
            fontWeight: 'normal',
            alignSelf: 'flex-start',
            marginTop: px(15),
            marginLeft: px(8)
          }}>
            °C
          </div>
        </div>

        {/* 天气图标 + 文字：上下排列让"阴/多云"也能完整显示 */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: px(4)
        }}>
          <div style={{
            display: 'flex',
            fontFamily: 'FusionPixelFont',
            fontSize: px(85),
            lineHeight: px(85),
            textAlign: 'center'
          }}>
            {getWeatherIconText(data.weather)}
          </div>
          <div style={{
            display: 'flex',
            fontFamily: 'FusionPixelFont',
            fontSize: px(26),
            lineHeight: px(30),
            fontWeight: 'normal',
            textAlign: 'center'
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
        height: px(22),
        paddingLeft: px(8),
        paddingRight: px(8),
        borderTop: '1px solid rgba(0,0,0,0.1)',
        backgroundColor: invertedBanner ? '#000000' : 'rgba(0,0,0,0.05)',
        color: invertedBanner ? '#FFFFFF' : '#333333',
        fontFamily: 'FusionPixelFont',
        fontSize: px(18),
        lineHeight: px(20),
        fontWeight: 'normal',
        flexShrink: 0
      }}>
        <div style={{
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          whiteSpace: 'nowrap'
        }}>
          体感 {getFeelsLikeTemp()}°C
        </div>
        <div style={{
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          whiteSpace: 'nowrap'
        }}>
          {data.windDirection ? `${data.windDirection}风 ${(data.windPower || '').replace(/≤/g, '<=')}` : `风力 ${data.windPower || 'N/A'}`}
        </div>
        <div style={{
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          whiteSpace: 'nowrap'
        }}>
          明日 {data.tomorrowWeather || data.forecast?.tomorrow?.weather || '未知'}
        </div>
      </div>
    </div>
  );
};

export { SatoriWeatherWidget };