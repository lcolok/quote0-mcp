#!/usr/bin/env tsx

/**
 * 测试真实天气API获取
 */

import { weatherService, SupportedCity } from '../src/react-widgets/services/weather-service.js';

async function testSingleCity(city: SupportedCity) {
    console.log(`\n🧪 测试${city}天气数据获取...`);
    console.log('='.repeat(50));
    
    try {
        const startTime = Date.now();
        const weatherData = await weatherService.getWeatherData(city);
        const duration = Date.now() - startTime;
        
        console.log(`✅ ${city}天气数据获取成功 (耗时: ${duration}ms)`);
        console.log('📊 天气数据:');
        console.log(`   城市: ${weatherData.city}`);
        console.log(`   温度: ${weatherData.temperature}°C`);
        console.log(`   天气: ${weatherData.weather}`);
        console.log(`   湿度: ${weatherData.humidity}%`);
        console.log(`   风向: ${weatherData.windDirection}`);
        console.log(`   风速: ${weatherData.windSpeed}m/s (${weatherData.windScale})`);
        console.log(`   体感: ${weatherData.feelst}°C`);
        console.log(`   气压: ${weatherData.pressure}hPa`);
        console.log(`   节气: ${weatherData.jieQi}`);
        console.log(`   更新: ${weatherData.lastUpdate}`);
        
        return weatherData;
    } catch (error) {
        console.error(`❌ ${city}天气数据获取失败:`, error);
        throw error;
    }
}

async function testMultipleCities() {
    console.log('\n🌍 测试批量城市天气数据获取...');
    console.log('='.repeat(50));
    
    const cities: SupportedCity[] = ['beijing', 'shanghai', 'guangzhou'];
    
    try {
        const startTime = Date.now();
        const weatherMap = await weatherService.getMultipleCitiesWeather(cities);
        const duration = Date.now() - startTime;
        
        console.log(`✅ 批量天气数据获取成功 (耗时: ${duration}ms)`);
        
        Object.entries(weatherMap).forEach(([city, data]) => {
            console.log(`\n📍 ${city}:`);
            console.log(`   ${data.city} - ${data.temperature}°C - ${data.weather} - 湿度${data.humidity}%`);
        });
        
        return weatherMap;
    } catch (error) {
        console.error('❌ 批量天气数据获取失败:', error);
        throw error;
    }
}

async function testServiceFeatures() {
    console.log('\n🔧 测试服务功能...');
    console.log('='.repeat(50));
    
    // 测试支持的城市列表
    const supportedCities = weatherService.getSupportedCities();
    console.log('📝 支持的城市:', supportedCities);
    
    // 测试城市支持检查
    console.log('✓ beijing 是否支持:', weatherService.isCitySupported('beijing'));
    console.log('✓ unknown 是否支持:', weatherService.isCitySupported('unknown'));
}

async function main() {
    console.log('🌤️  真实天气API测试开始');
    console.log('=====================================');
    
    try {
        // 测试服务功能
        await testServiceFeatures();
        
        // 测试单个城市
        await testSingleCity('beijing');
        await testSingleCity('shanghai');
        
        // 测试批量获取
        await testMultipleCities();
        
        console.log('\n🎉 所有测试完成！');
        
    } catch (error) {
        console.error('\n💥 测试失败:', error);
        process.exit(1);
    }
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}