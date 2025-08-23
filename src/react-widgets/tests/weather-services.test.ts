#!/usr/bin/env tsx

/**
 * 天气服务统一测试套件
 * 整合所有天气相关的测试功能
 */

import { weatherService } from '../services/weather-service.js';
import { getWeatherForCityEfficient } from '../services/efficient-weather-service.js';
import { RobustWeatherService } from '../services/robust-weather-service.js';

const robustService = new RobustWeatherService();

async function testAllWeatherServices() {
  console.log('🧪 开始天气服务全面测试...\n');

  const testCities = ['广州', '北京', '福州', '哈尔滨', '石家庄'];

  console.log('='.repeat(60));
  console.log('🔧 测试1: 传统天气服务 (weather-service)');
  console.log('='.repeat(60));

  for (const city of testCities) {
    try {
      console.log(`🔍 测试城市: ${city}`);
      const startTime = Date.now();
      const result = await weatherService.getWeatherForCity(city as any);
      const duration = Date.now() - startTime;
      console.log(`  ✅ 结果: ${result.city} ${result.temperature}°C ${result.weather} (耗时: ${duration}ms)`);
    } catch (error) {
      console.log(`  ❌ 失败: ${error}`);
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log('⚡ 测试2: 高效天气服务 (efficient-weather-service)');
  console.log('='.repeat(60));

  for (const city of testCities) {
    try {
      console.log(`🔍 测试城市: ${city}`);
      const startTime = Date.now();
      const result = await getWeatherForCityEfficient(city);
      const duration = Date.now() - startTime;
      console.log(`  ✅ 结果: ${result.city} ${result.temperature}°C ${result.weather} (耗时: ${duration}ms)`);
    } catch (error) {
      console.log(`  ❌ 失败: ${error}`);
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log('💪 测试3: 强健天气服务 (robust-weather-service)');
  console.log('='.repeat(60));

  for (const city of testCities) {
    try {
      console.log(`🔍 测试城市: ${city}`);
      const startTime = Date.now();
      const result = await robustService.getWeatherDataRobust(city);
      const duration = Date.now() - startTime;
      console.log(`  ✅ 结果: ${result.city} ${result.temperature}°C ${result.weather} (耗时: ${duration}ms)`);
    } catch (error) {
      console.log(`  ❌ 失败: ${error}`);
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log('🎯 测试总结');
  console.log('='.repeat(60));
  console.log('✅ 传统服务: 基础功能，预定义城市支持');
  console.log('⚡ 高效服务: 性能优化，快速响应'); 
  console.log('💪 强健服务: 零维护城市映射，智能重试机制');
  console.log('\n🏆 推荐使用: 强健天气服务 (robust-weather-service)');
}

// 执行测试
testAllWeatherServices().catch(console.error);