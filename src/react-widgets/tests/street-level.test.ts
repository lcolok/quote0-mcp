#!/usr/bin/env tsx

/**
 * 测试高德地理编码API的街道级精确度
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

// 扩展AmapWeatherService以获取详细地理编码信息
class DetailedAmapService extends AmapWeatherService {
  // 暴露内部方法用于测试
  async getDetailedGeocode(address: string): Promise<any> {
    const geocodeUrl = 'https://restapi.amap.com/v3/geocode/geo';
    const params = new URLSearchParams({
      key: process.env.AMAP_API_KEY || '',
      address: address,
      output: 'JSON'
    });

    const url = `${geocodeUrl}?${params.toString()}`;
    console.log(`🔍 地理编码查询: ${address}`);
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      return data;
    } catch (error) {
      throw new Error(`地理编码API查询失败: ${error}`);
    }
  }
}

async function testStreetLevelPrecision(): Promise<void> {
  console.log('🏘️ 测试街道级精确定位...\n');

  try {
    const service = new DetailedAmapService();

    // 测试不同精度级别的地址
    const testAddresses = [
      // 基础区县级
      '海珠区',
      '花都区',
      
      // 街道级
      '海珠区新港街道',
      '海珠区赤岗街道', 
      '花都区新华街道',
      '花都区花城街道',
      
      // 更精确的街道地址
      '广州市海珠区新港中路',
      '广州市花都区迎宾大道',
      
      // 知名地标/商圈
      '珠江新城',
      '天河城',
      '北京路步行街',
      '上海外滩'
    ];

    for (const address of testAddresses) {
      console.log(`📍 测试地址: ${address}`);
      
      try {
        // 获取详细地理编码信息
        const geocodeData = await service.getDetailedGeocode(address);
        
        if (geocodeData.status === '1' && geocodeData.geocodes && geocodeData.geocodes.length > 0) {
          const geocode = geocodeData.geocodes[0];
          
          console.log(`   🏷️  adcode: ${geocode.adcode}`);
          console.log(`   📍 格式化地址: ${geocode.formatted_address}`);
          console.log(`   🏛️  省份: ${geocode.province}`);
          console.log(`   🏙️  城市: ${geocode.city || '直辖市'}`);
          console.log(`   🏘️  区县: ${geocode.district}`);
          console.log(`   🛣️  街道: ${geocode.township || '未知'}`);
          console.log(`   📊 精确度: ${geocode.level}`);
          console.log(`   📐 坐标: ${geocode.location}`);
          
          // 尝试获取天气数据
          try {
            const weather = await service.getCurrentWeather(geocode.adcode);
            console.log(`   🌤️  天气: ${weather.city} ${weather.temperature}°C ${weather.weather}`);
          } catch (weatherError) {
            console.log(`   ⚠️  天气数据: 获取失败 (可能超出限额)`);
          }
          
        } else {
          console.log(`   ❌ 未找到地理编码信息`);
        }
        
      } catch (error) {
        console.error(`   ❌ ${address} 查询失败:`, error);
      }
      
      console.log('');
      
      // 添加延时避免API限额
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('✅ 街道级精确度测试完成！');

  } catch (error) {
    console.error('❌ 测试初始化失败:', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testStreetLevelPrecision()
    .then(() => {
      console.log('🎉 街道级测试完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 测试失败:', error);
      process.exit(1);
    });
}