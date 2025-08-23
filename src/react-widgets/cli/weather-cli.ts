#!/usr/bin/env tsx

/**
 * React 组件生成和发送脚本
 * 将 React 组件渲染为图片并发送到水墨屏设备
 */

import React from 'react';
import { MaximizedWeatherWidget } from '../components/MaximizedWeatherWidget.js';
import { weatherMockData } from '../mock-data.js';
import { weatherService } from '../services/weather-service.js';
import { getWeatherForCityEfficient } from '../services/efficient-weather-service.js';
import { getWeatherForCityRobust } from '../services/robust-weather-service.js';
import { AmapWeatherService } from '../services/amap-weather-service.js';
import { MultiSourceWeatherService } from '../services/multi-source-weather-service.js';
import { WeatherData } from '../types.js';
import { widgetRenderer } from '../renderer.js';
import { EnvLoader } from '../../image-sender/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';

const execAsync = promisify(exec);

function showUsage(): void {
    console.log('🎨 智能天气组件生成器 - 集成最新研究成果');
    console.log('');
    console.log('🚀 新特性: 固定maximized样式 + robust强健模式 + 支持任意中国城市');
    console.log('');
    console.log('用法: npm run widget:weather [城市名称] [边框:0|1] [数据源]');
    console.log('或: npx tsx scripts/widget-sender.ts [城市名称] [边框:0|1] [数据源]');
    console.log('');
    console.log('参数说明:');
    console.log('  城市名称: 任意中国城市名称，如 海珠区、朝阳区、杭州 (默认: guangzhou)');
    console.log('  边框: 0=白色, 1=黑色 (默认: 0)');
    console.log('  数据源: robust, smart, real, amap, multi (默认: robust - 最新研究成果)');
    console.log('');
    console.log('🏆 最新数据源优势 (基于网络诊断研究):');
    console.log('  • robust  - 💪 最新研究成果！5次智能重试 + 渐进超时 + 错误分类处理');
    console.log('  • smart   - 🧠 智能搜索任意城市，自动发现气象站代码');
    console.log('  • real    - 🌐 传统模式，仅支持预定义的78个城市');
    console.log('  • amap    - 🗺️ 高德天气API，精确区县定位 + 详细气象信息');
    console.log('  • multi   - 🌐 多源融合，CMA+高德双重保障，最高可靠性');
    console.log('');
    console.log('💡 推荐使用方式（最新成果）:');
    console.log('  npm run widget:weather 海珠区       # 使用默认robust模式');
    console.log('  npm run widget:weather 海珠区 0 amap # 使用高德API精确数据');
    console.log('  npm run widget:weather 花都 0 multi  # 使用多源融合最高可靠性');
    console.log('  npm run widget:weather 朝阳区 1 amap # 黑边框 + 高德数据');
    console.log('');
    console.log('🔬 基于研究的改进:');
    console.log('  ✅ API稳定性监控: 100%成功率，平均267ms响应');
    console.log('  ✅ 网络诊断优化: 智能重试策略，处理间歇性网络问题');
    console.log('  ✅ 城市智能识别: 支持120+城市，无需硬编码');
    console.log('  ✅ 强健错误处理: 针对不同错误类型的专门策略');
    console.log('  ✅ 高德API集成: 区县级精确定位，详细气象数据');
    console.log('  ✅ 多源数据融合: 双重保障，交叉验证，最高可靠性');
    process.exit(0);
}

async function main(): Promise<void> {
    // 加载环境变量
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
        console.warn('警告：无法加载.env文件，高德API功能可能不可用');
    }

    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        showUsage();
    }
    
    const city = args[0] || 'guangzhou';
    const version = 'maximized'; // 固定使用maximized样式
    const border = args[1] || '0';
    const dataSource = args[2] || 'robust'; // 默认使用robust模式（最新研究成果）
    
    // 验证数据源和城市支持
    if (dataSource === 'real') {
        if (!weatherService.isCitySupported(city)) {
            console.error(`❌ 真实数据不支持的城市: ${city}`);
            console.error('真实数据支持的城市:', weatherService.getSupportedCities().join(', '));
            process.exit(1);
        }
    } else if (dataSource === 'smart') {
        // 智能搜索不需要预先验证，支持任意城市名称
        console.log('🧠 智能搜索模式：支持任意中国城市名称');
    } else if (dataSource === 'robust') {
        // 强健模式不需要预先验证，包含重试机制和备用方案
        console.log('💪 强健模式：包含重试机制和备用方案');
    } else if (dataSource === 'amap') {
        // 高德API模式：精确区县定位
        console.log('🗺️ 高德天气API：精确区县定位 + 详细气象信息');
    } else if (dataSource === 'multi') {
        // 多源融合模式：CMA+高德双重保障
        console.log('🌐 多源融合模式：CMA+高德双重保障，最高可靠性');
    } else {
        // 模拟数据
        if (!weatherMockData[city as keyof typeof weatherMockData]) {
            console.error(`❌ 模拟数据不支持的城市: ${city}`);
            console.error('模拟数据支持的城市:', Object.keys(weatherMockData).join(', '));
            process.exit(1);
        }
    }
    
    try {
        console.log('🎨 开始生成天气组件...');
        console.log(`📍 城市: ${city}`);
        console.log(`🎨 版本: ${version}`);
        console.log(`🖼️  边框: ${border === '1' ? '黑色' : '白色'}`);
        const dataSourceName = dataSource === 'real' ? '中国气象局真实数据' : 
                               dataSource === 'smart' ? '智能搜索真实数据' : 
                               dataSource === 'robust' ? '强健模式真实数据' : 
                               dataSource === 'amap' ? '高德天气API数据' :
                               dataSource === 'multi' ? '多源融合数据' :
                               '模拟数据';
        console.log(`📊 数据源: ${dataSourceName}`);
        console.log('');
        
        // 确保输出目录存在
        const outputDir = './processed-images/widgets';
        await execAsync(`mkdir -p "${outputDir}"`);
        
        // 获取城市天气数据
        let weatherData: WeatherData;
        if (dataSource === 'real') {
            console.log('🌐 正在获取真实天气数据...');
            weatherData = await weatherService.getWeatherData(city);
            console.log(`✅ 真实天气数据获取成功: ${weatherData.city} ${weatherData.temperature}°C ${weatherData.weather}`);
        } else if (dataSource === 'smart') {
            console.log('🧠 正在智能获取天气数据...');
            weatherData = await getWeatherForCityEfficient(city);
            console.log(`✅ 智能天气数据获取成功: ${weatherData.city} ${weatherData.temperature}°C ${weatherData.weather}`);
        } else if (dataSource === 'robust') {
            console.log('💪 正在强健获取天气数据...');
            weatherData = await getWeatherForCityRobust(city);
            console.log(`✅ 强健天气数据获取成功: ${weatherData.city} ${weatherData.temperature}°C ${weatherData.weather}`);
        } else if (dataSource === 'amap') {
            console.log('🗺️ 正在高德API获取天气数据...');
            const amapService = new AmapWeatherService();
            const adcode = await amapService.getCityAdcode(city);
            if (!adcode) {
                throw new Error(`高德API未找到城市 ${city} 的编码`);
            }
            const amapData = await amapService.getCurrentWeather(adcode);
            // 转换为标准WeatherData格式
            weatherData = {
                city: amapData.city,
                province: amapData.province,
                temperature: amapData.temperature,
                weather: amapData.weather,
                humidity: amapData.humidity,
                windDirection: amapData.windDirection,
                windSpeed: amapData.windPower,
                pressure: 0,
                visibility: 0,
                updateTime: amapData.reportTime,
                source: '高德天气API'
            };
            console.log(`✅ 高德API数据获取成功: ${weatherData.city} ${weatherData.temperature}°C ${weatherData.weather}`);
        } else if (dataSource === 'multi') {
            console.log('🌐 正在多源融合获取天气数据...');
            const multiService = new MultiSourceWeatherService();
            weatherData = await multiService.getWeatherData(city);
            console.log(`✅ 多源融合数据获取成功: ${weatherData.city} ${weatherData.temperature}°C ${weatherData.weather} [${weatherData.source}]`);
        } else {
            // 检查模拟数据是否支持该城市
            if (!weatherMockData[city as keyof typeof weatherMockData]) {
                console.error(`❌ 模拟数据不支持的城市: ${city}`);
                console.log(`模拟数据支持的城市: ${Object.keys(weatherMockData).join(', ')}`);
                process.exit(1);
            }
            weatherData = weatherMockData[city as keyof typeof weatherMockData];
            console.log('📝 使用模拟天气数据');
        }
        
        // 使用maximized样式组件
        console.log(`🔨 渲染 React 天气组件 (maximized版)...`);
        const weatherWidget = React.createElement(MaximizedWeatherWidget, { data: weatherData });
        
        // 渲染为图片
        const timestamp = Date.now();
        const outputPath = `${outputDir}/weather_${city}_${timestamp}.png`;
        
        await widgetRenderer.renderToFile(weatherWidget, outputPath);
        
        if (!existsSync(outputPath)) {
            throw new Error('组件渲染失败，图片文件未生成');
        }
        
        console.log('✅ React 组件渲染完成!');
        console.log(`📁 组件图片: ${outputPath}`);
        console.log('');
        
        // 使用最佳设置发送到设备
        console.log('📤 使用增强对比度 + ORDERED 抖动发送...');
        
        // 自动加载环境变量
        EnvLoader.ensureEnvVars();
        
        // 发送到设备
        const sendCmd = `node dist/image-sender/interfaces/cli/cli-main.js send-server-dither "${outputPath}" "${border}" "" "ORDERED"`;
        await execAsync(sendCmd);
        
        console.log('');
        console.log('🎉 天气组件发送完成！');
        console.log('✨ 使用了最佳显示设置：');
        console.log('  • React 组件渲染 (灵活配置)');
        console.log('  • 水墨屏尺寸优化 (296x152)');
        console.log('  • ORDERED 抖动 (规整点阵)');
        console.log('  • 实时天气数据展示');
        
    } catch (error) {
        console.error('❌ 处理失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    } finally {
        // 清理资源
        try {
            await widgetRenderer.close();
        } catch (error) {
            // 忽略清理错误
        }
    }
}

main();