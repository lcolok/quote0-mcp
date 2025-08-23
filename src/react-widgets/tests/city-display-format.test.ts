#!/usr/bin/env tsx

/**
 * 测试城市显示格式
 * 验证"城市•区县"格式的显示效果
 */

import { readFileSync } from 'fs';
import { AmapWeatherService } from '../services/amap-weather-service.js';

// 手动加载.env文件
try {
  const envContent = readFileSync('.env', 'utf8');
  envContent.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const [key, value] = line.split('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    }
  });
} catch (error) {
  console.warn('警告：无法加载.env文件');
}

// 模拟城市显示格式函数（与组件中的逻辑一致）
const getCityDisplayText = (city: string, province: string) => {
  if (province && city) {
    // 处理高德API数据：从"广东省"提取"广东"，从"海珠区"显示完整名称
    const cityName = city.replace(/(市|区|县)$/, ''); // 移除后缀
    const provinceName = province.replace(/省$/, ''); // 移除"省"后缀
    
    // 如果城市名包含区县信息（如"海珠区"），使用特殊格式
    if (city.match(/(区|县)$/)) {
      // 对于区县，显示为 "广州•海珠"（省略"区"字）
      const mainCity = getMainCityName(provinceName, city);
      const districtName = city.replace(/(区|县)$/, ''); // 移除区县后缀
      return `${mainCity}•${districtName}`;
    } else {
      // 对于地级市，显示为 "广东•广州"  
      return `${provinceName}•${cityName}`;
    }
  }
  
  // 回退到原始城市名
  return city;
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

async function testCityDisplayFormat(): Promise<void> {
  console.log('🏙️ 测试城市显示格式...\n');

  try {
    const amapService = new AmapWeatherService();

    // 测试不同类型的城市
    const testCities = [
      '海珠区',   // 广州区县
      '花都区',   // 广州区县  
      '朝阳区',   // 北京区县
      '福田区',   // 深圳区县
      '广州',     // 省会城市
      '深圳',     // 特区城市
      '佛山',     // 地级市
      '珠海',     // 地级市
      '义乌',     // 县级市
      '三亚'      // 旅游城市
    ];

    for (const cityName of testCities) {
      console.log(`📍 测试城市: ${cityName}`);
      
      try {
        const adcode = await amapService.getCityAdcode(cityName);
        if (adcode) {
          const weatherData = await amapService.getCurrentWeather(adcode);
          
          // 显示原始数据
          console.log(`   🏷️  原始数据: city="${weatherData.city}", province="${weatherData.province}"`);
          
          // 显示格式化后的显示文本
          const displayText = getCityDisplayText(weatherData.city, weatherData.province);
          console.log(`   🎨 显示格式: "${displayText}"`);
          console.log(`   🌡️  天气: ${weatherData.temperature}°C ${weatherData.weather}`);
          
        } else {
          console.log(`   ❌ 未找到adcode`);
        }
      } catch (error) {
        console.error(`   ❌ ${cityName} 查询失败:`, error);
      }
      
      console.log('');
    }

    console.log('✅ 城市显示格式测试完成！');

  } catch (error) {
    console.error('❌ 测试初始化失败:', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testCityDisplayFormat()
    .then(() => {
      console.log('🎉 显示格式测试完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 测试失败:', error);
      process.exit(1);
    });
}