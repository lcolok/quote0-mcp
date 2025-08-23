/**
 * 高效智能天气服务
 * 结合已知城市代码和智能搜索，提供最佳性能
 */

import { WeatherData } from '../types/weather-types.js';

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
 * 优先使用已知代码，必要时进行小范围智能搜索
 */
export class EfficientWeatherService {
  private readonly baseUrl = 'https://weather.cma.cn/api/now';
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  
  // 已知的高质量气象站代码
  private readonly knownStations: Record<string, string> = {
    // 直辖市及主要区域
    '北京': '54511', '北京市': '54511',
    '海淀': '54399', '海淀区': '54399', '北京海淀': '54399',
    '通州': '54431', '通州区': '54431', '北京通州': '54431',
    '朝阳': '54433', '朝阳区': '54433', '北京朝阳': '54433',
    '门头沟': '54505', '门头沟区': '54505', '北京门头沟': '54505',
    
    '上海': '58367', '上海市': '58367',
    '徐家汇': '58367',
    '宝山': '58362', '宝山区': '58362', '上海宝山': '58362',
    '嘉定': '58365', '嘉定区': '58365', '上海嘉定': '58365',
    
    '天津': '54527', '天津市': '54527',
    '西青': '54527', '西青区': '54527',
    '宝坻': '54525', '宝坻区': '54525', '天津宝坻': '54525',
    
    '重庆': '57516', '重庆市': '57516',
    '沙坪坝': '57516', '沙坪坝区': '57516',
    
    // 广东省
    '广州': '59287', '广州市': '59287',
    '花都': '59284', '花都区': '59284', '广州花都': '59284',
    '从化': '59285', '从化区': '59285', '广州从化': '59285',
    '增城': '59294', '增城区': '59294', '广州增城': '59294',
    '番禺': '59481', '番禺区': '59481', '广州番禺': '59481',
    '海珠': '59287', '海珠区': '59287', '广州海珠': '59287', // 使用广州总站
    '天河': '59287', '天河区': '59287', '广州天河': '59287', // 使用广州总站
    '越秀': '59287', '越秀区': '59287', '广州越秀': '59287', // 使用广州总站
    
    '深圳': '59493', '深圳市': '59493',
    '中山': '59485', '中山市': '59485',
    '珠海': '59488', '珠海市': '59488',
    '东莞': '59289', '东莞市': '59289',
    
    // 江苏省
    '南京': '58238', '南京市': '58238',
    '六合': '58235', '六合区': '58235', '南京六合': '58235',
    '扬州': '58245', '扬州市': '58245',
    '江阴': '58351', '江阴市': '58351',
    '常熟': '58352', '常熟市': '58352',
    '吴江': '58359', '吴江区': '58359',
    '海门': '58360', '海门区': '58360',
    
    // 浙江省
    '杭州': '58457', '杭州市': '58457',
    '桐乡': '58456', '桐乡市': '58456',
    
    // 湖北省
    '武汉': '57494', '武汉市': '57494',
    '黄陂': '57491', '黄陂区': '57491', '武汉黄陂': '57491',
    '黄冈': '57498', '黄冈市': '57498',
    
    // 四川省
    '成都': '56294', '成都市': '56294',
    '广汉': '56291', '广汉市': '56291',
    
    // 山东省
    '济南': '54823', '济南市': '54823',
    
    // 其他主要城市
    '兰州': '52889', '兰州市': '52889',
    '贵阳': '57816', '贵阳市': '57816',
    '西安': '57036', '西安市': '57036',
  };

  // 智能搜索的小范围映射
  private readonly searchHints: Record<string, number[]> = {
    '北京': [54400, 54450],
    '上海': [58350, 58380],
    '广州': [59280, 59300],
    '深圳': [59490, 59500],
    '杭州': [58450, 58470],
    '南京': [58230, 58250],
    '成都': [56290, 56310],
    '武汉': [57490, 57500],
  };

  /**
   * 智能获取天气数据
   */
  async getWeatherDataSmart(cityName: string): Promise<WeatherData> {
    console.log(`🌤️  智能获取"${cityName}"天气数据...`);
    
    // 1. 优先检查已知城市代码
    const knownCode = this.findKnownCityCode(cityName);
    if (knownCode) {
      console.log(`✅ 使用已知代码: ${knownCode}`);
      return this.getWeatherDataByCode(knownCode);
    }
    
    // 2. 进行小范围智能搜索
    console.log(`🔍 进行智能搜索...`);
    const searchCode = await this.smartSearch(cityName);
    if (searchCode) {
      console.log(`✅ 搜索发现代码: ${searchCode}`);
      return this.getWeatherDataByCode(searchCode);
    }
    
    throw new Error(`未找到"${cityName}"的气象站代码`);
  }

  /**
   * 查找已知城市代码
   */
  private findKnownCityCode(cityName: string): string | null {
    // 直接匹配
    if (this.knownStations[cityName]) {
      return this.knownStations[cityName];
    }
    
    // 去除常见后缀再匹配
    const cleanName = cityName.replace(/[市区县]/g, '');
    if (cleanName && this.knownStations[cleanName]) {
      return this.knownStations[cleanName];
    }
    
    // 模糊匹配
    for (const [knownCity, code] of Object.entries(this.knownStations)) {
      if (knownCity.includes(cityName) || cityName.includes(knownCity)) {
        return code;
      }
    }
    
    return null;
  }

  /**
   * 小范围智能搜索
   */
  private async smartSearch(cityName: string): Promise<string | null> {
    console.log(`🔍 智能搜索"${cityName}"...`);
    
    // 确定搜索范围
    const ranges = this.getSearchRanges(cityName);
    
    for (const [regionName, start, end] of ranges) {
      console.log(`🔍 搜索${regionName} (${start}-${end})...`);
      
      // 小批量测试
      const codes = this.generateCodes(start, end);
      const batchSize = 10; // 小批量避免超时
      
      for (let i = 0; i < codes.length; i += batchSize) {
        const batch = codes.slice(i, i + batchSize);
        
        try {
          const results = await Promise.all(
            batch.map(code => this.testCode(code, cityName))
          );
          
          const validCode = results.find(result => result !== null);
          if (validCode) {
            return validCode;
          }
        } catch (error) {
          console.log(`⚠️ 批次搜索出错，继续...`);
        }
        
        // 避免请求过于频繁
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return null;
  }

  /**
   * 获取搜索范围
   */
  private getSearchRanges(cityName: string): Array<[string, number, number]> {
    const ranges: Array<[string, number, number]> = [];
    
    // 根据城市名称特征确定搜索范围
    for (const [region, [start, end]] of Object.entries(this.searchHints)) {
      if (cityName.includes(region)) {
        ranges.push([region, start, end]);
      }
    }
    
    // 如果没有匹配的区域，使用小范围通用搜索
    if (ranges.length === 0) {
      ranges.push(['华南小范围', 59280, 59300]);
      ranges.push(['华东小范围', 58350, 58380]);
      ranges.push(['华北小范围', 54400, 54430]);
    }
    
    return ranges;
  }

  /**
   * 生成代码范围
   */
  private generateCodes(start: number, end: number): string[] {
    const codes = [];
    for (let i = start; i <= end; i++) {
      codes.push(i.toString());
    }
    return codes;
  }

  /**
   * 测试代码是否与城市匹配
   */
  private async testCode(code: string, cityName: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/${code}`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
        },
        timeout: 5000,
      });

      if (response.ok) {
        const data: CMAWeatherResponse = await response.json();
        if (data.code === 0 && data.data && data.data.location) {
          const location = `${data.data.location.name} ${data.data.location.path}`;
          
          // 检查是否与城市名称匹配
          if (this.isLocationMatch(location, cityName)) {
            console.log(`✅ 找到匹配: ${code} -> ${data.data.location.name} (${data.data.location.path})`);
            return code;
          }
        }
      }
    } catch (error) {
      // 忽略单个请求错误
    }
    
    return null;
  }

  /**
   * 判断位置是否匹配
   */
  private isLocationMatch(location: string, cityName: string): boolean {
    const cleanCityName = cityName.replace(/[市区县]/g, '');
    
    return location.includes(cityName) || 
           (cleanCityName.length >= 2 && location.includes(cleanCityName));
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
        timeout: 10000,
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

      console.log(`✅ 成功获取天气数据: ${weatherData.city} ${weatherData.temperature}°C ${weatherData.weather}`);
      return weatherData;

    } catch (error) {
      console.error(`❌ 获取气象站 ${code} 数据失败:`, error);
      throw error;
    }
  }

  /**
   * 获取支持的城市列表
   */
  getSupportedCities(): string[] {
    return Object.keys(this.knownStations);
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