/**
 * 天气组件使用示例
 */

import React from 'react';
import { WeatherWidget } from '../components/WeatherWidget.js';
import { guangzhouWeatherMock, weatherMockData } from '../mock-data.js';
import { widgetRenderer } from '../renderer.js';

// 使用示例函数
export async function generateWeatherWidgets(): Promise<void> {
  console.log('🌤️  开始生成天气组件图片...');

  try {
    // 1. 广州天气 - 默认配置
    console.log('📍 生成广州天气组件...');
    const guangzhouWidget = React.createElement(WeatherWidget, {
      data: guangzhouWeatherMock
    });

    await widgetRenderer.renderToFile(
      guangzhouWidget,
      './processed-images/widgets/weather-guangzhou.png'
    );

    // 2. 北京天气 - 测试不同数据
    console.log('📍 生成北京天气组件...');
    const beijingWidget = React.createElement(WeatherWidget, {
      data: weatherMockData.beijing
    });

    await widgetRenderer.renderToFile(
      beijingWidget,
      './processed-images/widgets/weather-beijing.png'
    );

    // 3. 深圳天气 - 小字体版本
    console.log('📍 生成深圳天气组件...');
    const shenzhenWidget = React.createElement(WeatherWidget, {
      data: weatherMockData.shenzhen
    });

    await widgetRenderer.renderToFile(
      shenzhenWidget,
      './processed-images/widgets/weather-shenzhen.png'
    );

    console.log('✅ 所有天气组件生成完成！');
    console.log('📁 查看生成的图片: ./processed-images/widgets/');

  } catch (error) {
    console.error('❌ 天气组件生成失败:', error);
    throw error;
  } finally {
    await widgetRenderer.close();
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  generateWeatherWidgets()
    .then(() => {
      console.log('🎉 天气组件示例运行完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 运行失败:', error);
      process.exit(1);
    });
}