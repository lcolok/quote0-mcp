/**
 * 真实天气数据获取服务
 * 基于中国气象局API
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

/**
 * 城市代码映射表
 * 基于中国气象局城市ID，支持市级和区县级精确定位
 * 总共支持60+个城市和地区
 */
export const CITY_CODES = {
  // 北京市及各区县 (经过验证的真实气象站)
  'beijing': '54511',           // 北京市
  'beijing-haidian': '54399',   // 北京-海淀区 ✓
  'beijing-tongzhou': '54431',  // 北京-通州区 ✓
  'beijing-pinggu': '54424',    // 北京-平谷区 ✓
  'beijing-yanqing': '54406',   // 北京-延庆区 ✓
  'beijing-huairou': '54419',   // 北京-怀柔区 ✓
  'beijing-miyun': '54416',     // 北京-密云区 ✓
  'beijing-mentougou': '54505', // 北京-门头沟区 ✓
  'beijing-chaoyang': '54433',  // 北京-朝阳区 ✓
  
  // 上海市及周边区县
  'shanghai': '58367',          // 上海(徐家汇)
  'shanghai-baoshan': '58362',  // 上海-宝山区 ✓
  'shanghai-jiading': '58365',  // 上海-嘉定区 ✓
  
  // 天津市及区县
  'tianjin': '54527',           // 天津-西青区
  'tianjin-baodi': '54525',     // 天津-宝坻区 ✓
  
  // 重庆市及区县
  'chongqing': '57516',         // 重庆-沙坪坝区
  'chongqing-dianjiang': '57425', // 重庆-垫江县 ✓
  'chongqing-rongchang': '57505', // 重庆-荣昌区 ✓
  'chongqing-hechuan': '57512',   // 重庆-合川区 ✓
  'chongqing-yubei': '57513',     // 重庆-渝北区 ✓
  
  // 广东省各市县
  'guangzhou': '59287',         // 广州市
  'guangzhou-conghua': '59285', // 广州-从化区 ✓
  'guangzhou-huadu': '59284',   // 广州-花都区 ✓
  'guangzhou-zengcheng': '59294', // 广州-增城区 ✓
  'guangzhou-panyu': '59481',   // 广州-番禺区 ✓
  'guangzhou-haizhu': '59287',  // 广州-海珠区 (使用市总站)
  'shenzhen': '59493',          // 深圳市
  'zhongshan': '59485',         // 中山市 ✓
  'zhuhai': '59488',            // 珠海市 ✓
  'dongguan': '59289',          // 东莞市 ✓
  'foshan-nanhai': '59288',     // 佛山-南海区 ✓
  'foshan-shunde': '59480',     // 佛山-顺德区 ✓
  'jiangmen-heshan': '59473',   // 江门-鹤山市 ✓
  'jiangmen-kaiping': '59475',  // 江门-开平市 ✓
  'jiangmen-xinhui': '59476',   // 江门-新会区 ✓
  'jiangmen-enping': '59477',   // 江门-恩平市 ✓
  'jiangmen-taishan': '59478',  // 江门-台山市 ✓
  'qingyuan': '59280',          // 清远市 ✓
  'huidong': '59492',           // 惠东县 ✓
  'huiyang': '59298',           // 惠阳区 ✓
  'zengcheng': '59294',         // 增城区 ✓
  
  // 江苏省各市县  
  'nanjing': '58238',           // 南京市
  'nanjing-liuhe': '58235',     // 南京-六合区 ✓
  'yangzhou': '58245',          // 扬州市 ✓
  'taizhou-jiangyan': '58250',  // 泰州-姜堰区 ✓
  'wuxi-jiangyin': '58351',     // 无锡-江阴市 ✓
  'suzhou-changshu': '58352',   // 苏州-常熟市 ✓
  'suzhou-wujiang': '58359',    // 苏州-吴江区 ✓
  'nantong-haimen': '58360',    // 南通-海门区 ✓
  
  // 浙江省各市县
  'hangzhou': '58457',          // 杭州市
  'jiaxing-tongxiang': '58456', // 嘉兴-桐乡市 ✓
  
  // 湖北省各市县
  'wuhan': '57494',             // 武汉市
  'wuhan-huangpi': '57491',     // 武汉-黄陂区 ✓
  'huanggang': '57498',         // 黄冈市 ✓
  'huanggang-tuanfeng': '57495', // 黄冈-团风县 ✓
  'enshi-jianshi': '57445',     // 恩施-建始县 ✓
  'yichang-dangyang': '57460',  // 宜昌-当阳市 ✓
  'yichang-yidu': '57465',      // 宜昌-宜都市 ✓
  'qianjiang': '57475',         // 潜江市 ✓
  'xiantao': '57485',           // 仙桃市 ✓
  
  // 四川省各市县
  'chengdu': '56294',           // 成都市
  'deyang-guanghan': '56291',   // 德阳-广汉市 ✓
  'chengdu-jintang': '56296',   // 成都-金堂县 ✓
  'suining': '57405',           // 遂宁市 ✓
  'guangan': '57415',           // 广安市 ✓
  'dazhou-dazhu': '57420',      // 达州-大竹县 ✓
  'neijiang-longchang': '57507', // 内江-隆昌市 ✓
  
  // 山东省各市县
  'jinan': '54823',             // 济南市
  'zibo-zichuan': '54824',      // 淄博-淄川区 ✓
  'laiwu': '54828',             // 莱芜区 ✓
  'weifang-qingzhou': '54831',  // 潍坊-青州市 ✓
  'weifang-changyi': '54841',   // 潍坊-昌邑市 ✓
  'qingdao-jiaozhou': '54849',  // 青岛-胶州市 ✓
  
  // 河北省各市县
  'chengde-luanping': '54420',  // 承德-滦平县 ✓
  'langfang-dachang': '54510',  // 廊坊-大厂县 ✓
  'langfang-sanhe': '54520',    // 廊坊-三河市 ✓
  'handan-qiuxian': '54820',    // 邯郸-邱县 ✓
  
  // 河南省各市县
  'sanmenxia': '57051',         // 三门峡市 ✓
  'sanmenxia-lingbao': '57056', // 三门峡-灵宝市 ✓
  'pingdingshan-ruzhou': '57075', // 平顶山-汝州市 ✓
  'luoyang-luanchuan': '57077', // 洛阳-栾川县 ✓
  'xinyang-huaibin': '58205',   // 信阳-淮滨县 ✓
  
  // 安徽省各市县
  'fuyang-yingshang': '58210',  // 阜阳-颍上县 ✓
  'huainan-shouxian': '58215',  // 淮南-寿县 ✓
  
  // 陕西省各市县
  'xian': '57036',              // 西安市
  'xianyang-yongshou': '57030', // 咸阳-永寿县 ✓
  'xianyang-chunhua': '57031',  // 咸阳-淳化县 ✓
  'xianyang-jingyang': '57033', // 咸阳-泾阳县 ✓
  
  // 其他省份主要城市
  'lanzhou': '52889',           // 兰州市 ✓
  'guiyang': '57816',           // 贵阳市 ✓
  'chifeng': '54218',           // 赤峰市 ✓
  'wenshan-funing': '59205',    // 文山-富宁县 ✓
  'baise-debao': '59215',       // 百色-德保县 ✓
  'nanning-shanglin': '59235',  // 南宁-上林县 ✓
  'guigang-pingnan': '59255',   // 贵港-平南县 ✓
  'wuzhou': '59265',            // 梧州市 ✓
  
  // 西藏自治区
  'linzhi-langxian': '56308',   // 林芝-朗县 ✓
  'linzhi': '56312',            // 林芝市 ✓
  'chamdo-zuogong': '56331',    // 昌都-左贡县 ✓
} as const;

export type SupportedCity = keyof typeof CITY_CODES;

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
 * 中国气象局天气服务
 */
export class CMAWeatherService {
  private readonly baseUrl = 'https://weather.cma.cn/api/now';
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

  /**
   * 获取指定城市的天气数据
   */
  async getWeatherData(city: SupportedCity): Promise<WeatherData> {
    const cityCode = CITY_CODES[city];
    if (!cityCode) {
      throw new Error(`Unsupported city: ${city}`);
    }

    try {
      console.log(`🌤️  正在获取${city}天气数据...`);
      
      const response = await fetch(`${this.baseUrl}/${cityCode}`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeout: 10000, // 10秒超时
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

      console.log(`✅ 成功获取${city}天气数据:`, {
        city: weatherData.city,
        temperature: weatherData.temperature,
        weather: weatherData.weather,
        humidity: weatherData.humidity,
      });

      return weatherData;

    } catch (error) {
      console.error(`❌ 获取${city}天气数据失败:`, error);
      throw error;
    }
  }

  /**
   * 批量获取多个城市的天气数据
   */
  async getMultipleCitiesWeather(cities: SupportedCity[]): Promise<Record<SupportedCity, WeatherData>> {
    console.log(`🌍 批量获取天气数据: ${cities.join(', ')}`);
    
    const results = await Promise.allSettled(
      cities.map(async (city) => {
        const data = await this.getWeatherData(city);
        return { city, data };
      })
    );

    const weatherMap: Record<string, WeatherData> = {};
    
    results.forEach((result, index) => {
      const city = cities[index];
      if (result.status === 'fulfilled') {
        weatherMap[city] = result.value.data;
      } else {
        console.error(`❌ ${city}天气数据获取失败:`, result.reason);
        // 使用备用数据或抛出错误
        throw new Error(`Failed to fetch weather data for ${city}: ${result.reason}`);
      }
    });

    return weatherMap as Record<SupportedCity, WeatherData>;
  }

  /**
   * 获取支持的城市列表
   */
  getSupportedCities(): SupportedCity[] {
    return Object.keys(CITY_CODES) as SupportedCity[];
  }

  /**
   * 检查城市是否支持
   */
  isCitySupported(city: string): city is SupportedCity {
    return city in CITY_CODES;
  }
}

/**
 * 全局天气服务实例
 */
export const weatherService = new CMAWeatherService();

/**
 * 便捷方法：获取天气数据
 */
export async function getWeatherForCity(city: SupportedCity): Promise<WeatherData> {
  return weatherService.getWeatherData(city);
}