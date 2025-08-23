#!/usr/bin/env tsx

/**
 * 测试智能天气服务
 */

import { smartWeatherService, getWeatherForCitySmart } from '../src/react-widgets/services/smart-weather-service.js';

async function testSmartWeatherService() {
  console.log('🧠 测试智能天气服务');
  console.log('==================');
  
  const testCities = [
    '海珠区',      // 之前找不到的
    '朝阳区',      // 应该能找到北京朝阳
    '黄浦区',      // 上海的区
    '天河区',      // 广州的区  
    '成都',        // 大城市
    '厦门',        // 福建城市
    '苏州',        // 江苏城市
  ];
  
  for (const cityName of testCities) {
    console.log(`\n🔍 测试城市: ${cityName}`);
    console.log(''.padEnd(50, '='));
    
    try {
      // 1. 搜索气象站
      console.log(`第一步: 搜索"${cityName}"的气象站...`);
      const stations = await smartWeatherService.searchStationsByCity(cityName);
      
      if (stations.length > 0) {
        console.log(`✅ 找到 ${stations.length} 个相关气象站:`);
        stations.forEach((station, index) => {
          console.log(`   ${index + 1}. ${station.code}: ${station.name} (${station.path})`);
        });
        
        // 2. 获取天气数据
        console.log(`\n第二步: 获取"${cityName}"天气数据...`);
        const weatherData = await getWeatherForCitySmart(cityName);
        
        console.log(`🌤️  天气数据获取成功:`);
        console.log(`   城市: ${weatherData.city}`);
        console.log(`   温度: ${weatherData.temperature}°C`);
        console.log(`   天气: ${weatherData.weather}`);
        console.log(`   湿度: ${weatherData.humidity}%`);
        console.log(`   更新时间: ${weatherData.lastUpdate}`);
        
      } else {
        console.log(`❌ 未找到"${cityName}"的相关气象站`);
      }
      
    } catch (error) {
      console.error(`❌ 测试"${cityName}"失败:`, error);
    }
    
    // 避免请求过于频繁
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // 显示缓存统计
  console.log('\n📊 缓存统计:');
  console.log('============');
  const cachedStations = smartWeatherService.getCachedStations();
  console.log(`缓存的气象站数量: ${cachedStations.length}`);
  
  if (cachedStations.length > 0) {
    console.log('缓存的气象站:');
    cachedStations.forEach(station => {
      console.log(`  ${station.code}: ${station.name} (${station.path})`);
    });
  }
}

async function testQuickSearch() {
  console.log('\n🚀 快速测试常见城市');
  console.log('===================');
  
  const quickCities = ['海珠区', '朝阳区'];
  
  for (const city of quickCities) {
    try {
      console.log(`\n🎯 快速获取"${city}"天气...`);
      const weatherData = await getWeatherForCitySmart(city);
      console.log(`✅ ${weatherData.city}: ${weatherData.temperature}°C ${weatherData.weather} 湿度${weatherData.humidity}%`);
    } catch (error) {
      console.error(`❌ 快速测试"${city}"失败:`, error);
    }
  }
}

async function main() {
  try {
    // 测试完整的智能搜索功能
    await testSmartWeatherService();
    
    // 快速测试
    await testQuickSearch();
    
  } catch (error) {
    console.error('测试出错:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}