/**
 * 智能天气服务
 * 支持城市名称自动搜索和气象站代码发现
 * 不再需要硬编码城市列表
 */

import { WeatherData } from '../types.js';

export interface WeatherStation {
  code: string;
  name: string;
  path: string;
  isValid: boolean;
  lastTested?: Date;
}

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
  if (humidity > 85) {
    return '雨';
  } else if (humidity < 40) {
    return '晴';
  } else if (humidity > 70) {
    return '多云';
  } else {
    return '晴';
  }
}

/**
 * 智能天气服务类
 */
export class SmartWeatherService {
  private readonly baseUrl = 'https://weather.cma.cn/api/now';
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  private readonly stationCache = new Map<string, WeatherStation>();
  private readonly searchCache = new Map<string, string[]>();

  /**
   * 测试单个气象站代码是否有效
   */
  private async testStationCode(code: string): Promise<WeatherStation | null> {
    try {
      const response = await fetch(`${this.baseUrl}/${code}`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const data: CMAWeatherResponse = await response.json();
        if (data.code === 0 && data.data && data.data.location) {
          const station: WeatherStation = {
            code,
            name: data.data.location.name,
            path: data.data.location.path,
            isValid: true,
            lastTested: new Date(),
          };
          
          // 缓存有效的站点
          this.stationCache.set(code, station);
          
          return station;
        }
      }
      
      return null;
      
    } catch (error) {
      return null;
    }
  }

  /**
   * 基于城市名称智能搜索气象站代码
   */
  async searchStationsByCity(cityName: string): Promise<WeatherStation[]> {
    console.log(`🔍 智能搜索"${cityName}"的气象站...`);
    
    // 检查缓存
    if (this.searchCache.has(cityName)) {
      console.log(`💾 使用缓存结果`);
      const cachedCodes = this.searchCache.get(cityName)!;
      const stations = cachedCodes
        .map(code => this.stationCache.get(code))
        .filter((station): station is WeatherStation => station !== undefined);
      
      if (stations.length > 0) {
        return stations;
      }
    }

    const results: WeatherStation[] = [];
    
    // 智能搜索策略：根据城市名称推测可能的代码范围
    const searchRanges = this.generateSearchRanges(cityName);
    
    console.log(`📊 预计搜索 ${searchRanges.length} 个范围...`);
    
    for (const range of searchRanges) {
      console.log(`🔍 搜索范围 ${range.name} (${range.start}-${range.end})...`);
      
      const codes = this.generateCodeRange(range.start, range.end, range.step || 1);
      
      // 并发测试，但限制并发数避免过载
      const batchSize = 20;
      for (let i = 0; i < codes.length; i += batchSize) {
        const batch = codes.slice(i, i + batchSize);
        
        const batchResults = await Promise.all(
          batch.map(code => this.testStationCode(code))
        );
        
        const validStations = batchResults.filter((station): station is WeatherStation => {
          if (station && this.isRelevantToCity(station, cityName)) {
            return true;
          }
          return false;
        });
        
        results.push(...validStations);
        
        // 如果找到相关结果，可以提前停止某些范围的搜索
        if (validStations.length > 0) {
          console.log(`✅ 在${range.name}找到 ${validStations.length} 个相关气象站`);
          validStations.forEach(station => {
            console.log(`   ${station.code}: ${station.name} (${station.path})`);
          });
        }
        
        // 避免请求过于频繁
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // 缓存搜索结果
    if (results.length > 0) {
      const codes = results.map(station => station.code);
      this.searchCache.set(cityName, codes);
    }
    
    console.log(`🎯 共找到 ${results.length} 个与"${cityName}"相关的气象站`);
    return results;
  }

  /**
   * 根据城市名称生成搜索范围
   */
  private generateSearchRanges(cityName: string): Array<{name: string, start: number, end: number, step?: number}> {
    const ranges = [];
    
    // 基础搜索范围（覆盖所有主要地区）
    ranges.push(
      { name: '华北地区', start: 54400, end: 54600, step: 1 },
      { name: '华东地区', start: 58200, end: 58500, step: 1 },
      { name: '华南地区', start: 59200, end: 59500, step: 1 },
      { name: '西南地区', start: 56200, end: 56400, step: 1 },
      { name: '华中地区', start: 57400, end: 57600, step: 1 }
    );
    
    // 根据城市名称特征添加针对性搜索范围
    if (cityName.includes('北京') || cityName.includes('京')) {
      ranges.unshift({ name: '北京专项', start: 54400, end: 54450, step: 1 });
    }
    
    if (cityName.includes('上海') || cityName.includes('沪')) {
      ranges.unshift({ name: '上海专项', start: 58350, end: 58380, step: 1 });
    }
    
    if (cityName.includes('广州') || cityName.includes('深圳') || cityName.includes('广东')) {
      ranges.unshift({ name: '广东专项', start: 59280, end: 59320, step: 1 });
      ranges.unshift({ name: '广东扩展', start: 59470, end: 59500, step: 1 });
    }
    
    if (cityName.includes('杭州') || cityName.includes('浙江')) {
      ranges.unshift({ name: '浙江专项', start: 58450, end: 58470, step: 1 });
    }
    
    if (cityName.includes('南京') || cityName.includes('江苏')) {
      ranges.unshift({ name: '江苏专项', start: 58230, end: 58260, step: 1 });
      ranges.unshift({ name: '江苏扩展', start: 58350, end: 58370, step: 1 });
    }
    
    return ranges;
  }

  /**
   * 生成代码范围
   */
  private generateCodeRange(start: number, end: number, step: number = 1): string[] {
    const codes = [];
    for (let i = start; i <= end; i += step) {
      codes.push(i.toString());
    }
    return codes;
  }

  /**
   * 判断气象站是否与城市相关
   */
  private isRelevantToCity(station: WeatherStation, cityName: string): boolean {
    const stationInfo = `${station.name} ${station.path}`.toLowerCase();
    const searchTerm = cityName.toLowerCase();
    
    // 直接匹配
    if (stationInfo.includes(searchTerm)) {
      return true;
    }
    
    // 去掉常见后缀的匹配
    const cleanCityName = cityName.replace(/[市区县]/g, '');
    if (cleanCityName.length >= 2 && stationInfo.includes(cleanCityName)) {
      return true;
    }
    
    // 省份级匹配
    const provinceMapping: Record<string, string[]> = {
      '广东': ['广州', '深圳', '珠海', '中山', '东莞', '佛山'],
      '江苏': ['南京', '苏州', '无锡', '常州', '扬州'],
      '浙江': ['杭州', '宁波', '温州', '绍兴'],
      '山东': ['济南', '青岛', '烟台', '威海'],
    };
    
    for (const [province, cities] of Object.entries(provinceMapping)) {
      if (cities.some(city => cityName.includes(city)) && stationInfo.includes(province)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 获取城市天气数据（智能版本）
   */
  async getWeatherDataSmart(cityName: string): Promise<WeatherData> {
    console.log(`🌤️  智能获取"${cityName}"天气数据...`);
    
    // 1. 搜索相关气象站
    const stations = await this.searchStationsByCity(cityName);
    
    if (stations.length === 0) {
      throw new Error(`未找到"${cityName}"的气象站`);
    }
    
    // 2. 选择最佳气象站（优先选择名称最匹配的）
    const bestStation = this.selectBestStation(stations, cityName);
    console.log(`🎯 选择气象站: ${bestStation.code} - ${bestStation.name}`);
    
    // 3. 获取天气数据
    return this.getWeatherDataByCode(bestStation.code);
  }

  /**
   * 选择最佳气象站
   */
  private selectBestStation(stations: WeatherStation[], cityName: string): WeatherStation {
    // 评分系统：名称匹配度越高分数越高
    const scoredStations = stations.map(station => {
      let score = 0;
      
      // 精确匹配加分
      if (station.name.includes(cityName)) score += 100;
      if (station.path.includes(cityName)) score += 50;
      
      // 去后缀匹配加分
      const cleanCityName = cityName.replace(/[市区县]/g, '');
      if (station.name.includes(cleanCityName)) score += 80;
      
      // 长度相似度加分
      const lengthSimilarity = 1 - Math.abs(station.name.length - cityName.length) / Math.max(station.name.length, cityName.length);
      score += lengthSimilarity * 20;
      
      return { station, score };
    });
    
    // 返回得分最高的气象站
    scoredStations.sort((a, b) => b.score - a.score);
    return scoredStations[0].station;
  }

  /**
   * 根据气象站代码获取天气数据
   */
  private async getWeatherDataByCode(code: string): Promise<WeatherData> {
    try {
      const response = await fetch(`${this.baseUrl}/${code}`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
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
        pressure: data.data.now.pressure,
        windDirection: data.data.now.windDirection,
        windSpeed: data.data.now.windSpeed,
        windScale: data.data.now.windScale,
        feelst: Math.round(data.data.now.feelst),
        lastUpdate: data.data.lastUpdate,
        jieQi: data.data.jieQi,
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
      console.error(`❌ 获取气象站 ${code} 数据失败:`, error);
      throw error;
    }
  }

  /**
   * 获取缓存的气象站信息
   */
  getCachedStations(): WeatherStation[] {
    return Array.from(this.stationCache.values());
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.stationCache.clear();
    this.searchCache.clear();
  }
}

/**
 * 全局智能天气服务实例
 */
export const smartWeatherService = new SmartWeatherService();

/**
 * 便捷方法：智能获取天气数据
 */
export async function getWeatherForCitySmart(cityName: string): Promise<WeatherData> {
  return smartWeatherService.getWeatherDataSmart(cityName);
}