#!/usr/bin/env tsx

/**
 * 测试可用的矢量天气图标
 */

import React from 'react';

// Weather Icons (Wi)
import { 
  WiDaySunny, WiCloudy, WiRain, WiSnow, WiThunderstorm, WiHumidity, WiThermometer
} from 'react-icons/wi';

// Font Awesome (Fa) 
import { 
  FaSun, FaCloud, FaCloudRain, FaTint, FaThermometerHalf
} from 'react-icons/fa';

// Material Design (Md)
import { 
  MdSunny, MdCloud, MdGrain, MdOpacity, MdThermostat
} from 'react-icons/md';

// Bootstrap (Bs)
import { 
  BsSun, BsCloud, BsCloudRain, BsDroplet, BsThermometer
} from 'react-icons/bs';

const IconTest: React.FC = () => {
  const iconStyle: React.CSSProperties = {
    fontSize: '24px',
    margin: '8px',
    display: 'inline-block'
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>天气矢量图标测试</h2>
      
      <h3>Weather Icons (Wi)</h3>
      <div>
        <WiDaySunny style={iconStyle} title="晴天" />
        <WiCloudy style={iconStyle} title="多云" />
        <WiRain style={iconStyle} title="雨天" />
        <WiSnow style={iconStyle} title="雪天" />
        <WiThunderstorm style={iconStyle} title="雷暴" />
        <WiHumidity style={iconStyle} title="湿度" />
        <WiThermometer style={iconStyle} title="温度计" />
      </div>

      <h3>Font Awesome (Fa)</h3>
      <div>
        <FaSun style={iconStyle} title="太阳" />
        <FaCloud style={iconStyle} title="云朵" />
        <FaCloudRain style={iconStyle} title="下雨" />
        <FaTint style={iconStyle} title="水滴" />
        <FaThermometerHalf style={iconStyle} title="温度计" />
      </div>

      <h3>Material Design (Md)</h3>
      <div>
        <MdSunny style={iconStyle} title="晴朗" />
        <MdCloud style={iconStyle} title="云朵" />
        <MdGrain style={iconStyle} title="雨点" />
        <MdOpacity style={iconStyle} title="不透明度/水滴" />
        <MdThermostat style={iconStyle} title="恒温器" />
      </div>

      <h3>Bootstrap (Bs)</h3>
      <div>
        <BsSun style={iconStyle} title="太阳" />
        <BsCloud style={iconStyle} title="云朵" />
        <BsCloudRain style={iconStyle} title="雨云" />
        <BsDroplet style={iconStyle} title="水滴" />
        <BsThermometer style={iconStyle} title="温度计" />
      </div>
    </div>
  );
};

export default IconTest;