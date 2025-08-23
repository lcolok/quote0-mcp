/**
 * 天气组件插件实现
 * 将现有天气功能重构为标准插件格式
 */

import React from 'react';
import { 
  WidgetPlugin, 
  WidgetDataProvider, 
  CliOption, 
  WidgetConfig, 
  WidgetDataParams 
} from '../core/widget-plugin.js';
import { MaximizedWeatherWidget } from '../components/MaximizedWeatherWidget.js';
import { WeatherData } from '../types.js';

// 导入现有天气服务
import { weatherMockData } from '../mock-data.js';
import { weatherService } from '../services/weather-service.js';
import { getWeatherForCityEfficient } from '../services/efficient-weather-service.js';
import { getWeatherForCityRobust } from '../services/robust-weather-service.js';
import { AmapWeatherService } from '../services/amap-weather-service.js';
import { MultiSourceWeatherService } from '../services/multi-source-weather-service.js';

/**
 * 天气数据参数接口
 */
interface WeatherDataParams extends WidgetDataParams {
  city: string;
  dataSource?: string;
}

/**
 * 天气组件配置接口
 */
interface WeatherConfig extends WidgetConfig {
  border?: '0' | '1';
}

/**
 * 天气数据提供者实现
 */
class WeatherDataProvider implements WidgetDataProvider<WeatherData> {
  private amapService: AmapWeatherService | null = null;
  private multiService: MultiSourceWeatherService | null = null;

  constructor() {
    // 使用懒加载模式，避免在环境变量加载前初始化服务
  }

  private getAmapService(): AmapWeatherService {
    if (!this.amapService) {
      this.amapService = new AmapWeatherService();
    }
    return this.amapService;
  }

  private getMultiService(): MultiSourceWeatherService {
    if (!this.multiService) {
      this.multiService = new MultiSourceWeatherService();
    }
    return this.multiService;
  }

  getSources(): string[] {
    return ['amap', 'multi', 'robust', 'smart', 'real', 'mock'];
  }

  getDefaultSource(): string {
    return 'amap';
  }

  getSourceDescription(source: string): string {
    const descriptions: Record<string, string> = {
      amap: '🗺️ 高德天气API - 精确区县定位 + 详细气象信息',
      multi: '🌐 多源融合 - CMA+高德双重保障，最高可靠性',
      robust: '💪 强健模式 - 5次智能重试 + 渐进超时 + 错误分类处理',
      smart: '🧠 智能搜索 - 自动发现气象站代码，支持任意城市',
      real: '🌐 传统模式 - 中国气象局真实数据，仅支持预定义城市',
      mock: '📝 模拟数据 - 用于测试和演示'
    };
    return descriptions[source] || '未知数据源';
  }

  async getData(source: string, params: WeatherDataParams): Promise<WeatherData> {
    const { city } = params;

    switch (source) {
      case 'amap':
        return await this.getAmapData(city);
      
      case 'multi':
        return await this.getMultiService().getWeatherData(city);
      
      case 'robust':
        return await getWeatherForCityRobust(city);
      
      case 'smart':
        return await getWeatherForCityEfficient(city);
      
      case 'real':
        return await weatherService.getWeatherData(city);
      
      case 'mock':
        return this.getMockData(city);
      
      default:
        throw new Error(`不支持的数据源: ${source}`);
    }
  }

  validateParams(params: WeatherDataParams): boolean {
    return !!(params.city && typeof params.city === 'string');
  }

  private async getAmapData(city: string): Promise<WeatherData> {
    const amapService = this.getAmapService();
    const adcode = await amapService.getCityAdcode(city);
    if (!adcode) {
      throw new Error(`高德API未找到城市 ${city} 的编码`);
    }
    
    const amapData = await amapService.getCurrentWeather(adcode);
    
    // 获取预报数据
    let forecastData = null;
    try {
      forecastData = await amapService.getWeatherForecast(adcode);
    } catch (error) {
      console.log('⚠️ 获取预报数据失败，跳过明日天气');
    }
    
    // 转换为标准WeatherData格式
    return {
      city: amapData.city,
      province: amapData.province,
      temperature: amapData.temperature,
      weather: amapData.weather,
      humidity: amapData.humidity,
      windDirection: amapData.windDirection,
      windPower: amapData.windPower,
      windSpeed: amapData.windPower,
      pressure: 0,
      visibility: 0,
      updateTime: amapData.reportTime,
      source: '高德天气API',
      tomorrowWeather: forecastData?.forecast?.[1]?.dayWeather || 
                     (forecastData?.forecast?.[1] ? 
                      `${forecastData.forecast[1].dayWeather} ${forecastData.forecast[1].nightTemp}-${forecastData.forecast[1].dayTemp}°C` 
                      : undefined)
    };
  }

  private getMockData(city: string): WeatherData {
    if (!weatherMockData[city as keyof typeof weatherMockData]) {
      throw new Error(`模拟数据不支持的城市: ${city}`);
    }
    return weatherMockData[city as keyof typeof weatherMockData];
  }
}

/**
 * 天气组件插件实现
 */
export class WeatherPlugin implements WidgetPlugin<WeatherData, WeatherConfig> {
  meta = {
    type: 'weather',
    name: '智能天气组件',
    description: '显示实时天气信息，支持多种数据源',
    version: '2.0.0',
    author: 'MindReset Team',
    homepage: 'https://github.com/anthropics/claude-code'
  };

  dataProvider = new WeatherDataProvider();

  component = MaximizedWeatherWidget;

  getCliOptions(): CliOption[] {
    return [
      {
        name: 'city',
        description: '城市名称 (必需)',
        required: true
      },
      {
        name: 'border',
        description: '边框颜色: 0=白色, 1=黑色',
        required: false,
        defaultValue: '0',
        choices: ['0', '1']
      },
      {
        name: 'dataSource',
        description: '数据源',
        required: false,
        defaultValue: 'amap',
        choices: this.dataProvider.getSources()
      }
    ];
  }

  validateConfig(config: WeatherConfig): boolean {
    if (config.border && !['0', '1'].includes(config.border)) {
      return false;
    }
    return true;
  }

  parseCliArgs(args: string[]): { params: WeatherDataParams; config: WeatherConfig } {
    const city = args[0];
    const border = args[1] || '0';
    const dataSource = args[2] || this.dataProvider.getDefaultSource();

    if (!city) {
      throw new Error('城市名称是必需参数');
    }

    // 验证数据源和城市支持
    if (dataSource === 'real' && !weatherService.isCitySupported(city)) {
      throw new Error(`真实数据不支持的城市: ${city}。支持的城市: ${weatherService.getSupportedCities().join(', ')}`);
    }

    if (dataSource === 'mock' && !weatherMockData[city as keyof typeof weatherMockData]) {
      throw new Error(`模拟数据不支持的城市: ${city}。支持的城市: ${Object.keys(weatherMockData).join(', ')}`);
    }

    return {
      params: { city, dataSource },
      config: { border: border as '0' | '1' }
    };
  }

  getUsageHelp(): string {
    return `🌤️ 天气组件使用说明

🚀 用法: npm run widget:weather <城市名称> [边框] [数据源]

📝 参数说明:
  城市名称: 任意中国城市名称，如 海珠区、朝阳区、杭州 (必需)
  边框: 0=白色, 1=黑色 (默认: 0)
  数据源: ${this.dataProvider.getSources().join(', ')} (默认: ${this.dataProvider.getDefaultSource()})

🏆 数据源详情:
${this.dataProvider.getSources().map(source => 
  `  • ${source.padEnd(8)} - ${this.dataProvider.getSourceDescription(source)}`
).join('\n')}

💡 示例命令:
${this.getExampleCommands().map(cmd => `  ${cmd}`).join('\n')}

🔬 特性:
  ✅ 支持120+城市，无需硬编码
  ✅ 智能重试策略，处理网络问题  
  ✅ 区县级精确定位
  ✅ 多源数据融合，交叉验证
  ✅ 水墨屏显示优化`;
  }

  getExampleCommands(): string[] {
    return [
      'npm run widget:weather 海珠区',
      'npm run widget:weather 海珠区 0 amap',
      'npm run widget:weather 花都 0 multi',
      'npm run widget:weather 朝阳区 1 amap',
      'npm run widget:weather 北京 0 robust'
    ];
  }
}

// 导出插件实例
export const weatherPlugin = new WeatherPlugin();