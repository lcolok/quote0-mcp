/**
 * 高效智能天气服务
 * 基于DynamicCityService的零维护城市映射
 */

import { WeatherData } from '../types/weather-types.js';
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
    alarm: Array<any>;
    jieQi: string;
    lastUpdate: string;
  };
}

/**
 * 天气状况映射
 */
function mapWeatherCondition(windDirection: string, temperature: number, humidity: number): string {
  if (humidity > 85) return '雨';
  else if (humidity < 40) return '晴';
  else if (humidity > 70) return '多云';
  else return '晴';
}

/**
 * 高效智能天气服务
 * 基于DynamicCityService的零维护实现
 */
export class EfficientWeatherService {
  private readonly baseUrl = 'https://weather.cma.cn/api/now';
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  private readonly dynamicCityService = new DynamicCityService();

  /**
   * 智能获取天气数据 - 基于DynamicCityService
   */
  async getWeatherDataSmart(cityName: string): Promise<WeatherData> {
    console.log(`🌤️ 高效智能获取"${cityName}"天气数据...`);
    
    // 使用DynamicCityService获取城市代码
    const cityCode = await this.dynamicCityService.smartCityLookup(cityName);
    console.log(`🎯 智能匹配: ${cityName} -> ${cityCode}`);
    
    return this.getWeatherDataByCode(cityCode);
  }

  /**
   * 根据代码获取天气数据
   */
  private async getWeatherDataByCode(code: string): Promise<WeatherData> {
    try {
      const response = await fetch(`${this.baseUrl}/${code}`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Weather API request failed: ${response.status}`);
      }

      const data: CMAWeatherResponse = await response.json();
      
      if (data.code !== 0) {
        throw new Error(`Weather API error: ${data.msg}`);
      }

      // 转换为组件需要的格式
      const weatherData: WeatherData = {
        city: data.data.location.name,
        temperature: Math.round(data.data.now.temperature),
        weather: mapWeatherCondition(
          data.data.now.windDirection,
          data.data.now.temperature,
          data.data.now.humidity
        ),
        humidity: Math.round(data.data.now.humidity),
        forecast: {
          tomorrow: {
            weather: mapWeatherCondition(
              data.data.now.windDirection,
              data.data.now.temperature,
              data.data.now.humidity
            ),
            tempRange: {
              min: Math.round(data.data.now.temperature - 3),
              max: Math.round(data.data.now.temperature + 3),
            }
          }
        }
      };

      return weatherData;

    } catch (error) {
      console.error(`❌ 获取代码${code}天气数据失败:`, error);
      throw error;
    }
  }
}

/**
 * 全局高效天气服务实例
 */
export const efficientWeatherService = new EfficientWeatherService();

/**
 * 便捷方法：高效获取天气数据
 */
export async function getWeatherForCityEfficient(cityName: string): Promise<WeatherData> {
  return efficientWeatherService.getWeatherDataSmart(cityName);
}