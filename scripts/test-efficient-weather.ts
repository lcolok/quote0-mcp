#!/usr/bin/env tsx

/**
 * 测试高效智能天气服务
 */

import { efficientWeatherService, getWeatherForCityEfficient } from '../src/react-widgets/services/efficient-weather-service.js';

async function testEfficientWeatherService() {
  console.log('⚡ 测试高效智能天气服务');
  console.log('======================');
  
  const testCities = [
    '海珠区',      // 应该使用广州总站
    '朝阳区',      // 应该找到北京朝阳
    '天河区',      // 应该使用广州总站
    '黄浦区',      // 应该进行搜索
    '成都',        // 已知城市
    '厦门',        // 需要搜索
  ];
  
  console.log(`📝 支持的已知城市数量: ${efficientWeatherService.getSupportedCities().length}`);
  console.log(`前10个已知城市: ${efficientWeatherService.getSupportedCities().slice(0, 10).join(', ')}`);
  
  for (const cityName of testCities) {
    console.log(`\n🎯 测试城市: ${cityName}`);
    console.log(''.padEnd(40, '-'));
    
    try {
      const startTime = Date.now();
      const weatherData = await getWeatherForCityEfficient(cityName);
      const endTime = Date.now();
      
      console.log(`✅ 成功获取天气数据 (耗时: ${endTime - startTime}ms):`);
      console.log(`   城市: ${weatherData.city}`);
      console.log(`   温度: ${weatherData.temperature}°C`);
      console.log(`   天气: ${weatherData.weather}`);
      console.log(`   湿度: ${weatherData.humidity}%`);
      console.log(`   更新时间: ${weatherData.lastUpdate}`);
      
    } catch (error) {
      console.error(`❌ 测试"${cityName}"失败:`, error);
    }
    
    // 避免请求过于频繁
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function testKnownVsUnknown() {
  console.log('\n📊 对比已知城市 vs 未知城市的性能');
  console.log('=====================================');
  
  // 已知城市
  console.log('\n✅ 已知城市测试:');
  const knownCities = ['北京', '上海', '广州', '深圳'];
  
  for (const city of knownCities) {
    try {
      const startTime = Date.now();
      const weatherData = await getWeatherForCityEfficient(city);
      const endTime = Date.now();
      
      console.log(`${city}: ${weatherData.temperature}°C ${weatherData.weather} (${endTime - startTime}ms)`);
    } catch (error) {
      console.log(`${city}: 失败`);
    }
  }
  
  // 未知城市（需要搜索）
  console.log('\n🔍 未知城市测试（需要搜索）:');
  const unknownCities = ['海珠区', '朝阳区'];
  
  for (const city of unknownCities) {
    try {
      const startTime = Date.now();
      const weatherData = await getWeatherForCityEfficient(city);
      const endTime = Date.now();
      
      console.log(`${city}: ${weatherData.city} ${weatherData.temperature}°C ${weatherData.weather} (${endTime - startTime}ms)`);
    } catch (error) {
      console.log(`${city}: 失败`);
    }
  }
}

async function main() {
  try {
    await testEfficientWeatherService();
    await testKnownVsUnknown();
    
    console.log('\n🎉 测试完成！');
    console.log('\n💡 优势总结:');
    console.log('  ✅ 已知城市：瞬时响应，使用预定义代码');
    console.log('  ✅ 未知城市：智能搜索，小范围高效查找');
    console.log('  ✅ 不再需要硬编码所有城市');
    console.log('  ✅ 支持任意中国城市名称查询');
    
  } catch (error) {
    console.error('测试出错:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}