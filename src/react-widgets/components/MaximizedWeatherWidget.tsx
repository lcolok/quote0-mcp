import React from 'react';
import { WeatherData } from '../types.js';
import { FontLoader } from '../font-loader.js';

// 矢量图标 - 使用实心版本
import { 
  WiDaySunny, WiCloudy, WiRain, WiSnow, WiThunderstorm 
} from 'react-icons/wi';
import { 
  MdSunny, MdCloud, MdGrain, MdAcUnit, MdFlashOn 
} from 'react-icons/md';
import { BsDropletFill } from 'react-icons/bs';

interface MaximizedWeatherWidgetProps {
  data: WeatherData;
}

const MaximizedWeatherWidget: React.FC<MaximizedWeatherWidgetProps> = ({ data }) => {
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

  // 顶部信息条 - 紧凑布局
  const topBarStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '40px', // 恢复合适的顶部栏高度
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

  // 主内容区域 - 占用剩余全部空间
  const mainContentStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: '8px',
    paddingRight: '8px'
  };

  // 左侧温度 - 超大显示，数字和符号水平排列
  const tempSectionStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline', // 基线对齐
    justifyContent: 'flex-start',
    gap: '4px'
  };

  const tempStyle: React.CSSProperties = {
    fontSize: '108px', // 极大温度显示
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
    </div>
  );
};

export { MaximizedWeatherWidget };