#!/usr/bin/env tsx

/**
 * React 组件生成和发送脚本
 * 将 React 组件渲染为图片并发送到水墨屏设备
 */

import React from 'react';
import { WeatherWidget } from '../src/react-widgets/components/WeatherWidget.js';
import { CompactWeatherWidget } from '../src/react-widgets/components/CompactWeatherWidget.js';
import { MiniWeatherWidget } from '../src/react-widgets/components/MiniWeatherWidget.js';
import { EnhancedMiniWeatherWidget } from '../src/react-widgets/components/EnhancedMiniWeatherWidget.js';
import { MaximizedWeatherWidget } from '../src/react-widgets/components/MaximizedWeatherWidget.js';
import SmartMaximizedWeatherWidget from '../src/react-widgets/components/SmartMaximizedWeatherWidget.js';
import { weatherMockData } from '../src/react-widgets/mock-data.js';
import { widgetRenderer } from '../src/react-widgets/renderer.js';
import { EnvLoader } from '../src/image-sender/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

function showUsage(): void {
    console.log('🎨 React 组件生成和发送工具');
    console.log('');
    console.log('用法: npm run widget:weather [城市] [版本] [边框:0|1]');
    console.log('');
    console.log('示例:');
    console.log('  npm run widget:weather guangzhou mini 0      # 超迷你版广州天气');
    console.log('  npm run widget:weather beijing compact 1     # 紧凑版北京天气');
    console.log('  npm run widget:weather shenzhen original     # 原版深圳天气');
    console.log('');
    console.log('可用城市: guangzhou, beijing, shenzhen');
    console.log('可用版本: maximized (推荐), enhanced, mini, compact, original');
    console.log('');
    console.log('✨ 版本特点:');
    console.log('  • maximized:  最大化空间利用版本 (你满意的版本) ✅');
    console.log('  • enhanced:   矢量图标版迷你组件');
    console.log('  • mini:       超大温度显示，极简布局');
    console.log('  • compact:    平衡信息量和可读性');
    console.log('  • original:   信息丰富的完整版本');
    process.exit(0);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        showUsage();
    }
    
    const city = args[0] || 'guangzhou';
    const version = args[1] || 'maximized';
    const border = args[2] || '0';
    
    // 检查城市数据是否存在
    if (!weatherMockData[city as keyof typeof weatherMockData]) {
        console.error(`❌ 不支持的城市: ${city}`);
        console.error('可用城市:', Object.keys(weatherMockData).join(', '));
        process.exit(1);
    }
    
    try {
        console.log('🎨 开始生成天气组件...');
        console.log(`📍 城市: ${city}`);
        console.log(`🎨 版本: ${version}`);
        console.log(`🖼️  边框: ${border === '1' ? '黑色' : '白色'}`);
        console.log('');
        
        // 确保输出目录存在
        const outputDir = './processed-images/widgets';
        await execAsync(`mkdir -p "${outputDir}"`);
        
        // 获取城市天气数据
        const weatherData = weatherMockData[city as keyof typeof weatherMockData];
        
        // 根据版本选择组件
        console.log(`🔨 渲染 React 天气组件 (${version}版)...`);
        let weatherWidget: React.ReactElement;
        
        switch (version) {
            case 'smart':
            case 'maximized':
                if (version === 'smart') {
                    // 智能字体版本 - 启动字体服务器
                    const fontServerUrl = 'http://localhost:3001';
                    weatherWidget = React.createElement(SmartMaximizedWeatherWidget, { 
                        data: weatherData, 
                        fontServerUrl 
                    });
                } else {
                    weatherWidget = React.createElement(MaximizedWeatherWidget, { data: weatherData });
                }
                break;
            case 'enhanced':
                weatherWidget = React.createElement(EnhancedMiniWeatherWidget, { data: weatherData });
                break;
            case 'mini':
                weatherWidget = React.createElement(MiniWeatherWidget, { data: weatherData });
                break;
            case 'compact':
                weatherWidget = React.createElement(CompactWeatherWidget, { data: weatherData });
                break;
            case 'original':
            default:
                weatherWidget = React.createElement(WeatherWidget, {
                    data: weatherData,
                    config: { theme: 'eink', fontSize: 'small' }
                });
                break;
        }
        
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