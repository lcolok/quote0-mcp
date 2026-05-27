#!/usr/bin/env tsx

/**
 * 测试 weathercityid 包的具体使用方法
 */

// @ts-ignore
import weatherCityId from 'weathercityid';

function testWeatherCityIdAPI() {
  console.log('🧪 测试 weathercityid API');
  console.log('=========================');
  
  console.log('完整数据结构:');
  console.log(JSON.stringify(weatherCityId, null, 2).substring(0, 1000) + '...');
  
  // 尝试访问具体数据
  console.log('\n🔍 尝试不同的数据访问方式:');
  
  try {
    // 方式1: 直接访问cityId
    console.log('1. weatherCityId.cityId:');
    if (weatherCityId.cityId) {
      console.log('   类型:', typeof weatherCityId.cityId);
      const cityIdKeys = Object.keys(weatherCityId.cityId);
      console.log('   键数量:', cityIdKeys.length);
      
      // 访问中国数据
      if (weatherCityId.cityId['86']) {
        console.log('   中国数据存在');
        const chinaData = weatherCityId.cityId['86'];
        const provinceKeys = Object.keys(chinaData);
        console.log('   省份数量:', provinceKeys.length);
        
        // 查看北京数据
        if (chinaData['110000']) {
          console.log('   北京数据:', chinaData['110000']);
        }
        
        // 查看广东数据
        if (chinaData['440000']) {
          console.log('   广东数据:', chinaData['440000']);
        }
        
        // 列出前几个省份
        console.log('   前5个省份:');
        provinceKeys.slice(0, 5).forEach(key => {
          console.log(`     ${key}:`, chinaData[key]);
        });
      }
    }
    
    // 方式2: 查看是否有其他结构
    console.log('\n2. 查看所有顶级键:');
    Object.keys(weatherCityId).forEach(key => {
      console.log(`   ${key}:`, typeof (weatherCityId as any)[key]);
    });
    
    // 方式3: 查看是否是数组或其他格式
    console.log('\n3. 数据结构详情:');
    console.log('   weatherCityId 是数组吗?', Array.isArray(weatherCityId));
    console.log('   weatherCityId constructor:', weatherCityId.constructor.name);
    
  } catch (error) {
    console.error('访问数据时出错:', error);
  }
}

async function main() {
  try {
    testWeatherCityIdAPI();
  } catch (error) {
    console.error('测试出错:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}