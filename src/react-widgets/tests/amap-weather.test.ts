#!/usr/bin/env tsx

/**
 * 高德天气API测试脚本
 * 验证高德开放平台天气查询功能
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

async function testAmapWeatherAPI(): Promise<void> {
  console.log('🗺️ 测试高德天气API...\n');

  try {
    const amapService = new AmapWeatherService();

    // 测试城市列表
    const testCities = ['广州', '花都', '深圳', '北京', '上海', '杭州'];

    for (const cityName of testCities) {
      console.log(`📍 测试城市: ${cityName}`);
      
      try {
        // 1. 获取城市编码
        const adcode = await amapService.getCityAdcode(cityName);
        console.log(`   🏷️  城市编码: ${adcode || '未找到'}`);

        if (adcode) {
          // 2. 获取实时天气
          const weather = await amapService.getCurrentWeather(adcode);
          console.log(`   🌤️  实时天气: ${weather.city} ${weather.temperature}°C ${weather.weather}`);
          console.log(`   💨 风向风力: ${weather.windDirection} ${weather.windPower}`);
          console.log(`   💧 湿度: ${weather.humidity}%`);
          console.log(`   ⏰ 更新时间: ${weather.reportTime}`);
          console.log(`   🏞️  省份: ${weather.province}`);

          // 3. 测试预报数据
          try {
            const forecast = await amapService.getWeatherForecast(adcode);
            if (forecast.forecast && forecast.forecast.length > 0) {
              console.log(`   📅 预报数据: ${forecast.forecast.length}天`);
              forecast.forecast.slice(0, 2).forEach((day, index) => {
                console.log(`     ${index + 1}. ${day.date}: ${day.dayWeather} ${day.dayTemp}°C/${day.nightTemp}°C`);
              });
            }
          } catch (forecastError) {
            console.log(`   ⚠️  预报数据获取失败: ${forecastError}`);
          }
        }
        
        console.log('');
      } catch (error) {
        console.error(`   ❌ ${cityName} 测试失败:`, error);
        console.log('');
      }
    }

    console.log('✅ 高德天气API测试完成！');

  } catch (error) {
    console.error('❌ 高德天气API初始化失败:', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testAmapWeatherAPI()
    .then(() => {
      console.log('🎉 高德API测试完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 测试失败:', error);
      process.exit(1);
    });
}