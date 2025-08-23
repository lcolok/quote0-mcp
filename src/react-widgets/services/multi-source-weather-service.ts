/**
 * 多源天气服务聚合器
 * 整合中国气象局API和高德天气API，提供更可靠的天气数据
 */

import { EfficientWeatherService } from './efficient-weather-service.js';
import { AmapWeatherService, type AmapWeatherData } from './amap-weather-service.js';
import { DynamicCityService } from './dynamic-city-service.js';
import type { WeatherData } from '../types/weather-types.js';

export class MultiSourceWeatherService {
  private cmaService: EfficientWeatherService;
  private amapService: AmapWeatherService;
  private cityService: DynamicCityService;

  constructor() {
    this.cmaService = new EfficientWeatherService();
    this.amapService = new AmapWeatherService();
    this.cityService = new DynamicCityService();
  }

  /**
   * 获取天气数据 - 多源聚合策略
   * 1. 优先使用中国气象局API（更准确的气象数据）
   * 2. 失败时回退到高德API（更好的城市覆盖）
   * 3. 支持数据交叉验证和融合
   */
  async getWeatherData(cityName: string): Promise<WeatherData> {
    console.log(`🌐 多源天气查询: ${cityName}`);

    let cmaResult: WeatherData | null = null;
    let amapResult: AmapWeatherData | null = null;
    const errors: string[] = [];

    // 1. 尝试中国气象局API
    try {
      console.log('☁️ 尝试中国气象局API...');
      cmaResult = await this.cmaService.getWeatherDataSmart(cityName);
      console.log(`✅ 中国气象局API成功: ${cmaResult.city} ${cmaResult.temperature}°C ${cmaResult.weather}`);
    } catch (error) {
      const errorMsg = `中国气象局API失败: ${error}`;
      console.warn(`⚠️ ${errorMsg}`);
      errors.push(errorMsg);
    }

    // 2. 尝试高德API作为补充
    try {
      console.log('🗺️ 尝试高德天气API...');
      const adcode = await this.amapService.getCityAdcode(cityName);
      if (adcode) {
        amapResult = await this.amapService.getCurrentWeather(adcode);
        console.log(`✅ 高德API成功: ${amapResult.city} ${amapResult.temperature}°C ${amapResult.weather}`);
      } else {
        console.warn('⚠️ 高德API: 未找到城市编码');
      }
    } catch (error) {
      const errorMsg = `高德API失败: ${error}`;
      console.warn(`⚠️ ${errorMsg}`);
      errors.push(errorMsg);
    }

    // 3. 数据融合和选择策略
    if (cmaResult && amapResult) {
      console.log('🔀 两个数据源都成功，使用融合策略');
      return this.mergeWeatherData(cmaResult, amapResult, cityName);
    } else if (cmaResult) {
      console.log('☁️ 使用中国气象局数据');
      return cmaResult;
    } else if (amapResult) {
      console.log('🗺️ 使用高德天气数据');
      return this.transformAmapToWeatherData(amapResult);
    } else {
      throw new Error(`所有天气数据源都失败: ${errors.join('; ')}`);
    }
  }

  /**
   * 数据融合策略
   * 结合两个数据源的优势，提供更可靠的天气信息
   */
  private mergeWeatherData(cmaData: WeatherData, amapData: AmapWeatherData, cityName: string): WeatherData {
    // 温度差异检查
    const tempDiff = Math.abs(cmaData.temperature - amapData.temperature);
    if (tempDiff > 5) {
      console.warn(`⚠️ 温度差异较大: CMA(${cmaData.temperature}°C) vs 高德(${amapData.temperature}°C)`);
    }

    // 融合策略：优先信任中国气象局的数据，但使用高德的城市信息
    return {
      city: amapData.city || cmaData.city, // 高德的城市名可能更准确
      province: amapData.province || '',
      temperature: cmaData.temperature, // 气象局温度更准确
      weather: cmaData.weather, // 气象局天气描述更专业
      humidity: amapData.humidity > 0 ? amapData.humidity : 0,
      windDirection: amapData.windDirection || '',
      windSpeed: amapData.windPower || '',
      pressure: 0,
      visibility: 0,
      updateTime: cmaData.updateTime,
      source: `融合数据源(CMA+高德)`
    };
  }

  /**
   * 将高德天气数据转换为标准WeatherData格式
   */
  private transformAmapToWeatherData(amapData: AmapWeatherData): WeatherData {
    return {
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
  }

  /**
   * 获取预报数据（如果高德API支持的话）
   */
  async getWeatherForecast(cityName: string): Promise<AmapWeatherData | null> {
    try {
      const adcode = await this.amapService.getCityAdcode(cityName);
      if (adcode) {
        return await this.amapService.getWeatherForecast(adcode);
      }
    } catch (error) {
      console.warn('获取天气预报失败:', error);
    }
    return null;
  }

  /**
   * 数据质量验证
   */
  private validateWeatherData(data: WeatherData): boolean {
    return (
      data.temperature >= -50 && data.temperature <= 60 &&
      data.humidity >= 0 && data.humidity <= 100 &&
      data.city.length > 0
    );
  }
}