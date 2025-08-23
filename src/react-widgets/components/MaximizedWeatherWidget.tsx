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
  // 构建城市显示文本：优先显示"城市•区县"格式
  const getCityDisplayText = () => {
    if (data.province && data.city) {
      // 处理高德API数据：从"广东省"提取"广东"，从"海珠区"显示完整名称
      const cityName = data.city.replace(/(市|区|县)$/, ''); // 移除后缀
      const provinceName = data.province.replace(/省$/, ''); // 移除"省"后缀
      
      // 如果城市名包含区县信息（如"海珠区"），使用特殊格式
      if (data.city.match(/(区|县)$/)) {
        // 对于区县，显示为 "广州海珠"（直接连接，最紧凑）
        const mainCity = getMainCityName(provinceName, data.city);
        const districtName = data.city.replace(/(区|县)$/, ''); // 移除区县后缀
        return `${mainCity}${districtName}`;
      } else {
        // 对于地级市，显示为 "广东广州"  
        return `${provinceName}${cityName}`;
      }
    }
    
    // 回退到原始城市名
    return data.city;
  };

  // 根据省份和区县推断主要城市名
  const getMainCityName = (province: string, district: string): string => {
    // 广州市区县映射
    const guangzhouDistricts = ['海珠区', '天河区', '越秀区', '荔湾区', '白云区', '黄埔区', '花都区', '番禺区', '南沙区', '从化区', '增城区'];
    // 深圳市区县映射  
    const shenzhenDistricts = ['福田区', '罗湖区', '南山区', '宝安区', '龙岗区', '盐田区', '龙华区', '坪山区', '光明区', '大鹏新区'];
    // 北京市区县映射
    const beijingDistricts = ['东城区', '西城区', '朝阳区', '丰台区', '石景山区', '海淀区', '门头沟区', '房山区', '通州区', '顺义区', '昌平区', '大兴区', '怀柔区', '平谷区', '密云区', '延庆区'];
    
    if (guangzhouDistricts.includes(district)) return '广州';
    if (shenzhenDistricts.includes(district)) return '深圳'; 
    if (beijingDistricts.includes(district)) return '北京';
    
    // 默认情况：使用省份名去掉"省"
    return province.replace(/省$/, '');
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

export { MaximizedWeatherWidget };