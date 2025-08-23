#!/usr/bin/env tsx

/**
 * 测试海珠区高德天气查询
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

async function testHaizhuWeather(): Promise<void> {
  console.log('🏙️ 测试海珠区高德天气查询...\n');

  try {
    const amapService = new AmapWeatherService();
    const cityName = '海珠';

    console.log(`📍 查询城市: ${cityName}`);
    
    // 1. 获取城市编码
    const adcode = await amapService.getCityAdcode(cityName);
    console.log(`🏷️  城市编码: ${adcode || '未找到'}`);

    if (adcode) {
      // 2. 获取实时天气
      const weather = await amapService.getCurrentWeather(adcode);
      console.log(`🌤️  实时天气: ${weather.city} ${weather.temperature}°C ${weather.weather}`);
      console.log(`💨 风向风力: ${weather.windDirection} ${weather.windPower}`);
      console.log(`💧 湿度: ${weather.humidity}%`);
      console.log(`⏰ 更新时间: ${weather.reportTime}`);
      console.log(`🏞️  省份: ${weather.province}`);
    } else {
      console.log('❌ 未找到海珠区的高德城市编码');
    }

  } catch (error) {
    console.error('❌ 海珠区天气查询失败:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testHaizhuWeather()
    .then(() => {
      console.log('🎉 海珠区测试完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 测试失败:', error);
      process.exit(1);
    });
}