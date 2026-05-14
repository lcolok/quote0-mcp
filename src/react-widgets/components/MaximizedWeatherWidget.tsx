import React from 'react';
import { WeatherData } from '../types.js';
import { FontLoader } from '../font-loader.js';

// 矢量图标 - Weather Icons专业天气图标库
import { 
  WiDaySunny, WiCloudy, WiRain, WiSnow, WiThunderstorm,
  WiDayRainMix, WiNightClear, WiDayCloudy, WiRainMix,
  WiShowers, WiDayShowers, WiDayThunderstorm, WiFog,
  WiCloudyGusts, WiStrongWind, WiDayHaze, WiSmog,
  WiRaindrops, WiDaySleet, WiSleet, WiHail
} from 'react-icons/wi';
import { 
  MdSunny, MdCloud, MdGrain, MdAcUnit, MdFlashOn, 
  MdCloudQueue, MdWbCloudy, MdThunderstorm, MdFoggy
} from 'react-icons/md';
import { BsDropletFill } from 'react-icons/bs';

interface MaximizedWeatherWidgetProps {
  data: WeatherData;
  invertedBanner?: boolean; // 可选参数：是否反色显示底部banner
}

const MaximizedWeatherWidget: React.FC<MaximizedWeatherWidgetProps> = ({ data, invertedBanner = true }) => {
  // 构建城市显示文本：直接使用高德API提供的完整地理信息
  const getCityDisplayText = () => {
    // 检查全局缓存的地理信息（从高德API直接获取）
    const geoInfo = (global as any).__amapGeoCache;
    if (geoInfo && typeof geoInfo.city === 'string' && typeof geoInfo.district === 'string') {
      const cityName = geoInfo.city.replace(/(市|区|县)$/, '');
      const districtName = geoInfo.district.replace(/(区|县)$/, '');
      return `${cityName}${districtName}`;
    }
    
    // 优先使用传递的完整地理信息
    if (data.realCity && data.district) {
      const cityName = data.realCity.replace(/(市|区|县)$/, '');
      const districtName = data.district.replace(/(区|县)$/, '');
      return `${cityName}${districtName}`;
    }
    
    // 回退到省市数据
    if (data.province && data.city) {
      const cityName = data.city.replace(/(市|区|县)$/, '');
      const provinceName = data.province.replace(/省$/, '');
      return `${provinceName}${cityName}`;
    }
    
    // 最终回退
    return data.city;
  };

  // 计算体感温度 (Heat Index / Apparent Temperature)
  const calculateFeelsLike = (temp: number, humidity: number, windSpeed?: string): number => {
    // 简化版体感温度计算公式
    // 基于温度和湿度的热指数计算
    
    // 如果温度低于27°C，体感温度主要受风速影响
    if (temp < 27) {
      // 风速影响：风速越大，体感越低
      const windFactor = windSpeed && windSpeed.includes('≤3') ? -1 : 
                        windSpeed && windSpeed.includes('4-5') ? -2 : 
                        windSpeed && windSpeed.includes('≥6') ? -3 : -0.5;
      return Math.round(temp + windFactor);
    }
    
    // 高温情况下，主要受湿度影响 (Heat Index公式简化版)
    const T = temp;
    const RH = humidity;
    
    // 简化的热指数计算
    let heatIndex = T;
    
    if (RH > 40) {
      // 湿度较高时，体感温度上升
      const humidityEffect = (RH - 40) * 0.1;
      heatIndex += humidityEffect;
    }
    
    // 风速降温效果
    const windFactor = windSpeed && windSpeed.includes('≤3') ? -0.5 : 
                      windSpeed && windSpeed.includes('4-5') ? -1.5 : 
                      windSpeed && windSpeed.includes('≥6') ? -2.5 : -0.5;
    
    return Math.round(heatIndex + windFactor);
  };

  // 获取体感温度
  const getFeelsLikeTemp = (): number => {
    return calculateFeelsLike(data.temperature, data.humidity, data.windPower);
  };

  // 专业天气图标 - 使用Weather Icons库，调整为更大尺寸充分利用空间
  const getWeatherIcon = (weather: string) => {
    const iconProps = { size: 90, color: '#000' }; // 增大图标以充分利用90x90容器
    
    const weatherLower = weather.toLowerCase();
    
    // 晴天类型
    if (weatherLower.includes('晴') || weatherLower.includes('sunny') || weatherLower.includes('clear')) {
      return <WiDaySunny {...iconProps} />;
    }
    
    // 阴天/全云类型
    if (weatherLower.includes('阴') || weatherLower.includes('overcast')) {
      return <WiCloudy {...iconProps} />;
    }
    
    // 多云类型
    if (weatherLower.includes('多云') || weatherLower.includes('cloudy') || weatherLower.includes('partly')) {
      return <WiDayCloudy {...iconProps} />;
    }
    
    // 阵雨/淋雨类型
    if (weatherLower.includes('阵雨') || weatherLower.includes('shower')) {
      return <WiDayShowers {...iconProps} />;
    }
    
    // 雷阵雨类型
    if (weatherLower.includes('雷阵雨') || weatherLower.includes('雷雨')) {
      return <WiDayThunderstorm {...iconProps} />;
    }
    
    // 普通雨天类型
    if (weatherLower.includes('雨') || weatherLower.includes('rain') || weatherLower.includes('drizzle')) {
      return <WiRain {...iconProps} />;
    }
    
    // 雷暴类型
    if (weatherLower.includes('雷') || weatherLower.includes('thunder') || weatherLower.includes('storm')) {
      return <WiThunderstorm {...iconProps} />;
    }
    
    // 雨夹雪/雨雪类型
    if (weatherLower.includes('雨夹雪') || weatherLower.includes('sleet')) {
      return <WiSleet {...iconProps} />;
    }
    
    // 雪天类型
    if (weatherLower.includes('雪') || weatherLower.includes('snow')) {
      return <WiSnow {...iconProps} />;
    }
    
    // 雾天类型
    if (weatherLower.includes('雾') || weatherLower.includes('fog')) {
      return <WiFog {...iconProps} />;
    }
    
    // 霾/烟雾类型
    if (weatherLower.includes('霾') || weatherLower.includes('haze') || weatherLower.includes('smog')) {
      return <WiSmog {...iconProps} />;
    }
    
    // 大风类型
    if (weatherLower.includes('大风') || weatherLower.includes('windy') || weatherLower.includes('gust')) {
      return <WiStrongWind {...iconProps} />;
    }
    
    // 冰雹类型
    if (weatherLower.includes('冰雹') || weatherLower.includes('hail')) {
      return <WiHail {...iconProps} />;
    }
    
    // 默认 - 多云
    return <WiDayCloudy {...iconProps} />;
  };

  // 容器 - 完全填满屏幕
  const containerStyle: React.CSSProperties = {
    width: '296px',
    height: '152px',
    backgroundColor: 'white',
    color: 'black',
    padding: '0px', // 完全消除边距
    margin: '0px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: FontLoader.getFusionPixelFontFamily(),
    position: 'relative',
    imageRendering: 'pixelated'
  };

  // 顶部信息条 - 紧凑布局，为底部banner压缩高度
  const topBarStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '32px', // 从40px压缩到32px，为底部banner腾出8px
    paddingLeft: '6px',
    paddingRight: '6px',
    backgroundColor: 'black',
    color: 'white'
  };

  const cityStyle: React.CSSProperties = {
    fontSize: '28px', // 恢复地区字体大小
    fontWeight: 'normal',
    lineHeight: '1'
  };

  const humidityStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '24px' // 恢复合适的湿度数值
  };

  // 主内容区域 - 居中布局，两边等距
  const mainContentStyle: React.CSSProperties = {
    height: '104px', // 152px总高度 - 32px顶部 - 16px底部 = 104px主内容
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center', // 改为居中
    gap: '20px', // 设置固定间距，让两个组件居中且等距
    padding: '0 10px' // 两边预留相等边距
  };

  // 左侧温度区域 - 居中对齐
  const tempSectionStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline', // 基线对齐
    justifyContent: 'center', // 温度数字居中
    gap: '4px',
    flex: '0 0 auto' // 不允许伸缩，保持固定尺寸
  };

  const tempStyle: React.CSSProperties = {
    fontSize: '96px', // 从108px调整到96px以适应压缩后的高度
    fontWeight: 'normal',
    lineHeight: '0.8',
    letterSpacing: '-4px',
    textAlign: 'center' // 改为居中对齐
  };

  const degreeStyle: React.CSSProperties = {
    fontSize: '36px', // 摄氏度符号改为12的倍数(12×3)
    fontWeight: 'normal',
    alignSelf: 'flex-start', // 顶部对齐
    marginTop: '8px' // 微调垂直位置
  };

  // 右侧天气图标区域 - 优化布局充分利用空间
  const weatherSectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px', // 减少间距以节省空间
    flex: '0 0 auto' // 不允许收缩或扩张，保持固定尺寸
  };

  // 天气图标容器 - 调整为更合适的尺寸以充分利用空间
  const weatherIconContainerStyle: React.CSSProperties = {
    width: '90px',
    height: '90px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0, // 防止容器被压缩
    backgroundColor: 'transparent'
  };

  const weatherTextStyle: React.CSSProperties = {
    fontSize: '28px', // 恢复天气描述字体大小
    fontWeight: 'normal',
    textAlign: 'center',
    writingMode: 'vertical-rl', // 竖排显示
    textOrientation: 'upright', // 保持汉字正向
    letterSpacing: '6px' // 保持字间距
  };

  // 底部横条banner样式 - 支持反色切换
  const bottomBannerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    height: '18px',
    backgroundColor: invertedBanner ? 'black' : 'rgba(0,0,0,0.05)', // 根据参数切换背景色
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around', // 改为均匀分布
    paddingLeft: '4px',
    paddingRight: '4px',
    borderTop: '1px solid rgba(0,0,0,0.1)'
  };

  const bannerItemStyle: React.CSSProperties = {
    fontSize: '12px',
    color: invertedBanner ? 'white' : '#333', // 根据参数切换文字颜色
    fontWeight: 'normal',
    textAlign: 'center',
    minWidth: '80px', // 设置最小宽度确保不会太挤
    whiteSpace: 'nowrap' // 防止文字换行
  };

  return (
    <div style={containerStyle}>
      {/* 顶部信息条：城市 + 湿度 */}
      <div style={topBarStyle}>
        <div style={cityStyle}>{getCityDisplayText()}</div>
        <div style={humidityStyle}>
          <BsDropletFill size={24} color="white" />
          <span>{data.humidity}%</span>
        </div>
      </div>
      
      {/* 主内容：超大温度 + 大天气图标 */}
      <div style={mainContentStyle}>
        <div style={tempSectionStyle}>
          <div style={tempStyle}>{data.temperature}</div>
          <div style={degreeStyle}>°C</div>
        </div>
        
        <div style={weatherSectionStyle}>
          <div style={weatherIconContainerStyle}>
            {getWeatherIcon(data.weather)}
          </div>
          <div style={weatherTextStyle}>{data.weather}</div>
        </div>
      </div>

      {/* 底部横条banner：体感温度 + 风向风力 + 明日天气 */}
      <div style={bottomBannerStyle}>
        <div style={bannerItemStyle}>体感 {getFeelsLikeTemp()}°C</div>
        <div style={bannerItemStyle}>
          {data.windDirection ? `${data.windDirection}风 ${data.windPower?.replace('≤', '≤ ') || ''}` : `风力 ${data.windPower || 'N/A'}`}
        </div>
        <div style={bannerItemStyle}>明日 {data.tomorrowWeather || data.forecast?.tomorrow?.weather || '未知'}</div>
      </div>
    </div>
  );
};

export { MaximizedWeatherWidget };