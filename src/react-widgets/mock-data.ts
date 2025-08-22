/**
 * 广州天气 Mock 数据
 * 基于实际搜索的天气信息
 */

import { WeatherData } from './types.js';

export const guangzhouWeatherMock: WeatherData = {
  city: '广州',
  temperature: 27,
  weather: '晴',
  humidity: 79,
  windDirection: '东风',
  windLevel: 1,
  aqi: 24,
  aqiLevel: '优',
  pressure: 1002,
  sunrise: '06:00',
  sunset: '19:05',
  forecast: {
    tomorrow: {
      weather: '多云',
      tempRange: {
        min: 24,
        max: 34
      }
    }
  }
};

// 其他城市示例数据
export const weatherMockData = {
  guangzhou: guangzhouWeatherMock,
  
  beijing: {
    city: '北京',
    temperature: 22,
    weather: '多云',
    humidity: 65,
    windDirection: '西北风',
    windLevel: 2,
    aqi: 85,
    aqiLevel: '良',
    pressure: 1013,
    sunrise: '05:30',
    sunset: '19:20',
    forecast: {
      tomorrow: {
        weather: '小雨',
        tempRange: { min: 18, max: 25 }
      }
    }
  } as WeatherData,

  shenzhen: {
    city: '深圳',
    temperature: 29,
    weather: '阴',
    humidity: 82,
    windDirection: '南风',
    windLevel: 2,
    aqi: 31,
    aqiLevel: '优',
    pressure: 1005,
    sunrise: '06:05',
    sunset: '19:00',
    forecast: {
      tomorrow: {
        weather: '雷阵雨',
        tempRange: { min: 26, max: 32 }
      }
    }
  } as WeatherData
};