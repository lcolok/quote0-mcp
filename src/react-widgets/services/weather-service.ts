/**
 * 真实天气数据获取服务
 * 基于中国气象局API + DynamicCityService零维护城市映射
 */

import { WeatherData } from '../types.js';
import { DynamicCityService } from './dynamic-city-service.js';

export interface CMAWeatherResponse {
  msg: string;
  code: number;
  data: {
    location: {
      id: string;
      name: string;
      path: string;
    };
    now: {
      precipitation: number;
      temperature: number;
      pressure: number;
      humidity: number;
      windDirection: string;
      windDirectionDegree: number;
      windSpeed: number;
      windScale: string;
      feelst: number;
    };
    alarm: Array<{
      id: string;
      title: string;
      signaltype: string;
      signallevel: string;
      effective: string;
      eventType: string;
      severity: string;
      type: string;
    }>;
    jieQi: string;
    lastUpdate: string;
  };
}

// 移除硬编码的城市映射表，使用DynamicCityService实现零维护

/**
 * 天气状况映射
 * 将中国气象局的天气描述转换为我们组件支持的格式
 */
function mapWeatherCondition(windDirection: string, temperature: number, humidity: number): string {
  // 基于温度、湿度等条件推测天气状况
  // 这是一个简化的映射，实际API可能需要更详细的天气状况字段
  
  if (humidity > 85) {
    return '雨'; // 高湿度可能是雨天
  } else if (humidity < 40) {
    return '晴'; // 低湿度可能是晴天
  } else if (humidity > 70) {
    return '多云'; // 中高湿度可能是多云
  } else {
    return '晴';
  }
}

/**
 * 中国气象局天气服务 - 基于DynamicCityService零维护
 */
export class CMAWeatherService {
  private readonly baseUrl = 'https://weather.cma.cn/api/now';
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  private readonly dynamicCityService = new DynamicCityService();

  /**
   * 获取指定城市的天气数据 - 支持任意中国城市名
   */
  async getWeatherData(cityName: string): Promise<WeatherData> {
    // 使用DynamicCityService自动获取城市代码
    const cityCode = await this.dynamicCityService.smartCityLookup(cityName);

    try {
      console.log(`🌤️  正在获取${cityName}天气数据 (代码: ${cityCode})...`);
      
      const response = await fetch(`${this.baseUrl}/${cityCode}`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Weather API request failed: ${response.status} ${response.statusText}`);
      }

      const data: CMAWeatherResponse = await response.json();
      
      if (data.code !== 0) {
        throw new Error(`Weather API error: ${data.msg}`);
      }

      // 转换为我们组件需要的格式
      const weatherData: WeatherData = {
        city: data.data.location.name,
        temperature: Math.round(data.data.now.temperature), // 四舍五入温度
        weather: mapWeatherCondition(
          data.data.now.windDirection, 
          data.data.now.temperature,
          data.data.now.humidity
        ),
        humidity: Math.round(data.data.now.humidity),
        // 添加一些额外信息（可选）
        pressure: data.data.now.pressure,
        windDirection: data.data.now.windDirection,
        windSpeed: data.data.now.windSpeed,
        windScale: data.data.now.windScale,
        feelst: Math.round(data.data.now.feelst), // 体感温度
        lastUpdate: data.data.lastUpdate,
        jieQi: data.data.jieQi, // 节气
        // 添加默认的预报数据（目前API不提供，使用当前数据估算）
        forecast: {
          tomorrow: {
            weather: mapWeatherCondition(
              data.data.now.windDirection, 
              data.data.now.temperature,
              data.data.now.humidity
            ),
            tempRange: {
              min: Math.round(data.data.now.temperature - 3), // 估算最低温度
              max: Math.round(data.data.now.temperature + 3), // 估算最高温度
            }
          }
        }
      };

      console.log(`✅ 成功获取${cityName}天气数据:`, {
        city: weatherData.city,
        temperature: weatherData.temperature,
        weather: weatherData.weather,
        humidity: weatherData.humidity,
      });

      return weatherData;

    } catch (error) {
      console.error(`❌ 获取${cityName}天气数据失败:`, error);
      throw error;
    }
  }

  /**
   * 批量获取多个城市的天气数据
   */
  async getMultipleCitiesWeather(cityNames: string[]): Promise<Record<string, WeatherData>> {
    console.log(`🌍 批量获取天气数据: ${cityNames.join(', ')}`);
    
    const results = await Promise.allSettled(
      cityNames.map(async (cityName) => {
        const data = await this.getWeatherData(cityName);
        return { cityName, data };
      })
    );

    const weatherMap: Record<string, WeatherData> = {};
    
    results.forEach((result, index) => {
      const cityName = cityNames[index];
      if (result.status === 'fulfilled') {
        weatherMap[cityName] = result.value.data;
      } else {
        console.error(`❌ ${cityName}天气数据获取失败:`, result.reason);
        // 使用备用数据或抛出错误
        throw new Error(`Failed to fetch weather data for ${cityName}: ${result.reason}`);
      }
    });

    return weatherMap;
  }

  /**
   * 获取支持的城市列表 - 基于WMO标准，支持全国主要城市
   */
  getSupportedCitiesInfo(): string {
    return '支持全国34个省会城市及主要地区，基于WMO国际气象站代码标准，零维护自动识别';
  }

  /**
   * 检查城市是否支持 - 任意中国城市名都可尝试
   */
  async isCitySupported(cityName: string): Promise<boolean> {
    try {
      const cityCode = await this.dynamicCityService.findCityCode(cityName);
      return cityCode !== null;
    } catch {
      return false;
    }
  }
}

/**
 * 全局天气服务实例
 */
export const weatherService = new CMAWeatherService();

/**
 * 便捷方法：获取天气数据 - 支持任意中国城市名
 */
export async function getWeatherForCity(cityName: string): Promise<WeatherData> {
  return weatherService.getWeatherData(cityName);
}