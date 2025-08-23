#!/usr/bin/env tsx

/**
 * 多源天气服务测试脚本
 * 验证中国气象局API + 高德API的融合效果
 */

import { readFileSync } from 'fs';
import { MultiSourceWeatherService } from '../services/multi-source-weather-service.js';

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

async function testMultiSourceWeather(): Promise<void> {
  console.log('🌐 测试多源天气服务...\n');

  try {
    const multiService = new MultiSourceWeatherService();

    // 测试城市列表 - 包含各种情况
    const testCities = [
      { name: '广州', desc: '省会城市' },
      { name: '花都', desc: '区县城市' },
      { name: '深圳', desc: '特区城市' },
      { name: '杭州', desc: '省会城市' },
      { name: '义乌', desc: '县级市' },
      { name: '三亚', desc: '旅游城市' }
    ];

    for (const testCity of testCities) {
      console.log(`📍 测试城市: ${testCity.name} (${testCity.desc})`);
      console.log('─'.repeat(50));
      
      try {
        const startTime = Date.now();
        const weatherData = await multiService.getWeatherData(testCity.name);
        const endTime = Date.now();
        
        console.log(`✅ 获取成功 (耗时: ${endTime - startTime}ms)`);
        console.log(`   🏙️  城市: ${weatherData.city}`);
        console.log(`   🏞️  省份: ${weatherData.province || '未知'}`);
        console.log(`   🌡️  温度: ${weatherData.temperature}°C`);
        console.log(`   🌤️  天气: ${weatherData.weather}`);
        console.log(`   💧 湿度: ${weatherData.humidity}%`);
        console.log(`   💨 风向: ${weatherData.windDirection}`);
        console.log(`   💨 风力: ${weatherData.windSpeed}`);
        console.log(`   ⏰ 更新: ${weatherData.updateTime}`);
        console.log(`   📡 来源: ${weatherData.source}`);

        // 测试预报功能
        try {
          const forecastData = await multiService.getWeatherForecast(testCity.name);
          if (forecastData && forecastData.forecast) {
            console.log(`   📅 预报: ${forecastData.forecast.length}天数据可用`);
          }
        } catch (forecastError) {
          console.log(`   ⚠️  预报数据: 不可用`);
        }
        
      } catch (error) {
        console.error(`   ❌ ${testCity.name} 测试失败:`, error);
      }
      
      console.log('');
    }

    console.log('🎯 数据源可靠性测试...');
    
    // 压力测试：连续查询同一个城市
    const stressTestCity = '广州';
    const stressTestCount = 3;
    console.log(`🔄 连续查询 ${stressTestCity} ${stressTestCount} 次...`);
    
    for (let i = 1; i <= stressTestCount; i++) {
      try {
        const startTime = Date.now();
        const result = await multiService.getWeatherData(stressTestCity);
        const endTime = Date.now();
        console.log(`   第${i}次: ${result.temperature}°C ${result.weather} (${endTime - startTime}ms) [${result.source}]`);
      } catch (error) {
        console.error(`   第${i}次失败:`, error);
      }
    }

    console.log('\n✅ 多源天气服务测试完成！');

  } catch (error) {
    console.error('❌ 多源天气服务初始化失败:', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testMultiSourceWeather()
    .then(() => {
      console.log('🎉 多源服务测试完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 测试失败:', error);
      process.exit(1);
    });
}