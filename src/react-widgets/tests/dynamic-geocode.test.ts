#!/usr/bin/env tsx

/**
 * 测试高德地理编码API动态查询功能
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

async function testDynamicGeocode(): Promise<void> {
  console.log('🌐 测试高德地理编码API动态查询...\n');

  try {
    const amapService = new AmapWeatherService();

    // 测试没有预定义映射的城市
    const testCities = [
      '义乌', // 县级市，应该不在静态映射中
      '三亚', // 旅游城市
      '嘉兴', // 地级市
      '温州', // 地级市
      '佛山', // 地级市
      '珠海' // 特区
    ];

    for (const cityName of testCities) {
      console.log(`📍 测试动态查询: ${cityName}`);
      
      try {
        // 获取adcode（会尝试动态查询）
        const adcode = await amapService.getCityAdcode(cityName);
        console.log(`   🏷️  获取到adcode: ${adcode}`);

        if (adcode) {
          // 获取天气数据
          const weather = await amapService.getCurrentWeather(adcode);
          console.log(`   🌤️  天气数据: ${weather.city} ${weather.temperature}°C ${weather.weather}`);
          console.log(`   💧 湿度: ${weather.humidity}%, 风向: ${weather.windDirection}`);
        }
        
      } catch (error) {
        console.error(`   ❌ ${cityName} 查询失败:`, error);
      }
      
      console.log('');
    }

    console.log('✅ 动态地理编码测试完成！');

  } catch (error) {
    console.error('❌ 测试初始化失败:', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testDynamicGeocode()
    .then(() => {
      console.log('🎉 动态查询测试完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 测试失败:', error);
      process.exit(1);
    });
}