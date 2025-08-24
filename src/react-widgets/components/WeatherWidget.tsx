import React from 'react';
import { WeatherData } from '../types.js';
import { FontLoader } from '../font-loader.js';

// 天气图标 - 只保留实际使用的图标
import { 
  WiDaySunny, WiCloudy, WiRain, WiSnow, WiThunderstorm,
  WiDayCloudy, WiDayShowers, WiDayThunderstorm, WiFog,
  WiStrongWind, WiSmog, WiSleet, WiHail
} from 'react-icons/wi';
import { BsDropletFill } from 'react-icons/bs';

interface WeatherWidgetProps {
  data: WeatherData;
  invertedBanner?: boolean; // 可选参数：是否反色显示底部banner
}

const WeatherWidget: React.FC<WeatherWidgetProps> = ({ data, invertedBanner = true }) => {
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

  // 专业天气图标 - 使用Weather Icons库
  const getWeatherIcon = (weather: string) => {
    const iconProps = { size: 120, color: '#000' }; // Weather Icons需要更大的size值
    
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

  // 主内容区域 - 在固定高度内分配空间
  const mainContentStyle: React.CSSProperties = {
    height: '104px', // 152px总高度 - 32px顶部 - 16px底部 = 104px主内容
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: '8px',
    paddingRight: '8px'
  };

  // 左侧温度区域 - 只显示主温度
  const tempSectionStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline', // 基线对齐
    justifyContent: 'flex-start',
    gap: '4px'
  };

  const tempStyle: React.CSSProperties = {
    fontSize: '96px', // 从108px调整到96px以适应压缩后的高度
    fontWeight: 'normal',
    lineHeight: '0.8',
    letterSpacing: '-4px',
    textAlign: 'left'
  };

  const degreeStyle: React.CSSProperties = {
    fontSize: '36px', // 摄氏度符号改为12的倍数(12×3)
    fontWeight: 'normal',
    alignSelf: 'flex-start', // 顶部对齐
    marginTop: '8px' // 微调垂直位置
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
          {getWeatherIcon(data.weather)}
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

export { WeatherWidget };