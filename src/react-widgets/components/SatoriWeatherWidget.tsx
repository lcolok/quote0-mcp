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
import { getWeatherIconDataUri } from './weather-pixel-icons.js';

interface SatoriWeatherWidgetProps {
  data: WeatherData;
  invertedBanner?: boolean;
}

// 天气图标：用 12×12 像素 SVG（data URI）通过 <img> 加载
// 详见 weather-pixel-icons.ts 头部注释

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

  // v1.0.23: 所有 fontSize 严格用 8/10/12 的整数倍，避免像素字体非整数倍缩放糊
  // 布局像素（height/padding/gap/margin）可以任意值，只有 fontSize 受像素字体约束
  // 满版 640x384 = 顶部 64 + 主区 272 + 底部 48

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#FFFFFF',
      fontFamily: 'FusionPixelFont',
      padding: '0px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 顶部信息条：城市 + 湿度，高度 64px */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '32px',
        paddingLeft: '8px',
        paddingRight: '8px',
        backgroundColor: invertedBanner ? '#000000' : '#FFFFFF',
        color: invertedBanner ? '#FFFFFF' : '#000000',
        flexShrink: 0
      }}>
        <div style={{
          display: 'flex',
          fontFamily: 'FusionPixelFont',
          fontSize: '24px',
          lineHeight: '24px',
          fontWeight: 'normal'
        }}>
          {getCityDisplayText()}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontFamily: 'FusionPixelFont',
          fontSize: '24px',
          lineHeight: '24px'
        }}>
          <span>{getHumidityIcon()}</span>
          <span>{data.humidity}%</span>
        </div>
      </div>

      {/* 主内容：超大温度 + 大天气图标，主区高度 272px */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingLeft: '8px',
        paddingRight: '8px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          gap: '4px'
        }}>
          <div style={{
            display: 'flex',
            fontFamily: 'FusionPixelFont',
            fontSize: '96px',
            lineHeight: '96px',
            fontWeight: 'normal'
          }}>
            {data.temperature}
          </div>
          <div style={{
            display: 'flex',
            fontFamily: 'FusionPixelFont',
            fontSize: '24px',
            lineHeight: '24px',
            fontWeight: 'normal',
            marginTop: '8px'
          }}>
            °C
          </div>
        </div>

        {/* 天气图标 + 文字：12×12 SVG 像素图标 6x 放大到 72px，下方完整描述 */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px'
        }}>
          <img
            src={getWeatherIconDataUri(data.weather)}
            width={72}
            height={72}
            style={{ display: 'flex' }}
          />
          <div style={{
            display: 'flex',
            fontFamily: 'FusionPixelFont',
            fontSize: '12px',
            lineHeight: '12px',
            fontWeight: 'normal',
            textAlign: 'center'
          }}>
            {data.weather}
          </div>
        </div>
      </div>

      {/* 底部横条 banner：体感温度 + 风向风力 + 明日天气，高度 48px */}
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
        lineHeight: '12px',
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