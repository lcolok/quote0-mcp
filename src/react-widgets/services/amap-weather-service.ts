/**
 * 高德开放平台天气API服务
 * 提供基于高德地图精确城市编码的天气查询功能
 */

interface AmapWeatherResponse {
  status: string;
  count: string;
  info: string;
  infocode: string;
  lives?: AmapLiveWeather[];
  forecasts?: AmapForecastWeather[];
}

interface AmapLiveWeather {
  province: string;
  city: string;
  adcode: string;
  weather: string;
  temperature: string;
  winddirection: string;
  windpower: string;
  humidity: string;
  reporttime: string;
  temperature_float: string;
  humidity_float: string;
}

interface AmapForecastWeather {
  city: string;
  adcode: string;
  province: string;
  reporttime: string;
  casts: AmapWeatherCast[];
}

interface AmapWeatherCast {
  date: string;
  week: string;
  dayweather: string;
  nightweather: string;
  daytemp: string;
  nighttemp: string;
  daywind: string;
  nightwind: string;
  daypower: string;
  nightpower: string;
  daytemp_float: string;
  nighttemp_float: string;
}

export interface AmapWeatherData {
  city: string;
  province: string;
  district?: string; // 新增区县信息
  realCity?: string; // 新增真实市级名称
  temperature: number;
  weather: string;
  humidity: number;
  windDirection: string;
  windPower: string;
  reportTime: string;
  forecast?: {
    date: string;
    dayWeather: string;
    nightWeather: string;
    dayTemp: number;
    nightTemp: number;
  }[];
}

export class AmapWeatherService {
  private apiKey: string;
  private baseUrl = 'https://restapi.amap.com/v3/weather/weatherInfo';
  private cachedGeoInfo: {
    province: string;
    city: string; 
    district: string;
    adcode: string;
  } | null = null;

  constructor() {
    this.apiKey = process.env.AMAP_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('高德API密钥未配置，请在.env中设置AMAP_API_KEY');
    }
  }

  /**
   * 获取实时天气数据
   */
  async getCurrentWeather(cityAdcode: string): Promise<AmapWeatherData> {
    const params = new URLSearchParams({
      key: this.apiKey,
      city: cityAdcode,
      extensions: 'base',
      output: 'JSON'
    });

    const url = `${this.baseUrl}?${params.toString()}`;
    console.log(`🗺️ 高德天气查询: ${cityAdcode}`);

    try {
      const response = await fetch(url);
      const data: AmapWeatherResponse = await response.json();

      if (data.status !== '1' || !data.lives || data.lives.length === 0) {
        throw new Error(`高德天气API错误: ${data.info} (${data.infocode})`);
      }

      const weather = data.lives[0];
      return this.transformWeatherData(weather);

    } catch (error) {
      console.error('❌ 高德天气查询失败:', error);
      throw error;
    }
  }

  /**
   * 获取天气预报数据
   */
  async getWeatherForecast(cityAdcode: string): Promise<AmapWeatherData> {
    const params = new URLSearchParams({
      key: this.apiKey,
      city: cityAdcode,
      extensions: 'all',
      output: 'JSON'
    });

    const url = `${this.baseUrl}?${params.toString()}`;
    console.log(`🗺️ 高德天气预报查询: ${cityAdcode}`);

    try {
      const response = await fetch(url);
      const data: AmapWeatherResponse = await response.json();

      if (data.status !== '1' || !data.forecasts || data.forecasts.length === 0) {
        throw new Error(`高德天气预报API错误: ${data.info} (${data.infocode})`);
      }

      const forecast = data.forecasts[0];
      return this.transformForecastData(forecast);

    } catch (error) {
      console.error('❌ 高德天气预报查询失败:', error);
      throw error;
    }
  }

  /**
   * 转换实时天气数据格式
   */
  private transformWeatherData(weather: AmapLiveWeather): AmapWeatherData {
    // 使用缓存的地理信息，提供更准确的城市名称
    const geoInfo = this.cachedGeoInfo;
    
    return {
      city: weather.city,
      province: weather.province,
      district: geoInfo?.district || '',
      realCity: geoInfo?.city || '', // 从地理编码获取的真实市级名称
      temperature: parseFloat(weather.temperature_float || weather.temperature),
      weather: weather.weather,
      humidity: parseFloat(weather.humidity_float || weather.humidity),
      windDirection: weather.winddirection,
      windPower: weather.windpower,
      reportTime: weather.reporttime
    };
  }

  /**
   * 转换预报数据格式
   */
  private transformForecastData(forecast: AmapForecastWeather): AmapWeatherData {
    const todayCast = forecast.casts[0];
    const forecastData = forecast.casts.map(cast => ({
      date: cast.date,
      dayWeather: cast.dayweather,
      nightWeather: cast.nightweather,
      dayTemp: parseFloat(cast.daytemp_float || cast.daytemp),
      nightTemp: parseFloat(cast.nighttemp_float || cast.nighttemp)
    }));

    return {
      city: forecast.city,
      province: forecast.province,
      temperature: parseFloat(todayCast.daytemp_float || todayCast.daytemp),
      weather: todayCast.dayweather,
      humidity: 0, // 预报数据中没有湿度信息
      windDirection: todayCast.daywind,
      windPower: todayCast.daypower,
      reportTime: forecast.reporttime,
      forecast: forecastData
    };
  }

  /**
   * 城市名称转高德城市编码
   * 使用高德地理编码API动态查询，实现真正零维护
   */
  async getCityAdcode(cityName: string): Promise<string | null> {
    // 1. 尝试动态地理编码API查询
    try {
      const dynamicAdcode = await this.getDynamicAdcode(cityName);
      if (dynamicAdcode) {
        console.log(`🌐 动态获取adcode: ${cityName} -> ${dynamicAdcode}`);
        return dynamicAdcode;
      }
    } catch (error) {
      console.warn(`⚠️ 动态adcode查询失败 ${cityName}:`, error);
    }

    // 2. 回退到静态映射（保持向后兼容）
    const staticAdcode = this.getStaticAdcode(cityName);
    if (staticAdcode) {
      console.log(`📍 静态映射adcode: ${cityName} -> ${staticAdcode}`);
      return staticAdcode;
    }

    console.warn(`⚠️ 未找到城市 ${cityName} 的高德adcode`);
    return null;
  }

  /**
   * 使用高德地理编码API动态获取adcode和完整地理信息
   */
  private async getDynamicAdcode(cityName: string): Promise<string | null> {
    const geocodeUrl = 'https://restapi.amap.com/v3/geocode/geo';
    const params = new URLSearchParams({
      key: this.apiKey,
      address: cityName,
      output: 'JSON'
    });

    const url = `${geocodeUrl}?${params.toString()}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
        const geocode = data.geocodes[0];
        
        // 缓存完整的地理信息，供后续使用
        this.cachedGeoInfo = {
          province: geocode.province || '',
          city: geocode.city || '', 
          district: geocode.district || '',
          adcode: geocode.adcode
        };
        
        // 设置全局缓存供组件使用（Node.js环境的替代方案）
        (global as any).__amapGeoCache = this.cachedGeoInfo;
        
        console.log(`🗺️ 获取完整地理信息:`, this.cachedGeoInfo);
        return geocode.adcode;
      }
    } catch (error) {
      throw new Error(`地理编码API查询失败: ${error}`);
    }

    return null;
  }

  /**
   * 静态城市编码映射（备用）
   */
  private getStaticAdcode(cityName: string): string | null {
    // 常用城市的高德adcode映射（备用）
    const commonCities: { [key: string]: string } = {
      '北京': '110000',
      '上海': '310000',
      '广州': '440100',
      '深圳': '440300',
      '杭州': '330100',
      '南京': '320100',
      '武汉': '420100',
      '成都': '510100',
      '西安': '610100',
      '重庆': '500000',
      '天津': '120000',
      '福州': '350100',
      '厦门': '350200',
      '昆明': '530100',
      '南昌': '360100',
      '郑州': '410100',
      '石家庄': '130100',
      '太原': '140100',
      '沈阳': '210100',
      '长春': '220100',
      '哈尔滨': '230100',
      '合肥': '340100',
      '济南': '370100',
      '长沙': '430100',
      '南宁': '450100',
      '海口': '460100',
      '贵阳': '520100',
      '兰州': '620100',
      '西宁': '630100',
      '银川': '640100',
      '乌鲁木齐': '650100',
      '拉萨': '540100',
      '呼和浩特': '150100',
      
      // 广州区县
      '花都': '440114',
      '番禺': '440113',
      '从化': '440117',
      '增城': '440118',
      '白云': '440111',
      '黄埔': '440112',
      '海珠': '440105',
      '天河': '440106',
      '越秀': '440104',
      '荔湾': '440103',
      '南沙': '440115'
    };

    // 1. 直接匹配
    if (commonCities[cityName]) {
      return commonCities[cityName];
    }

    // 2. 清理后匹配
    const cleanName = cityName.replace(/[市区县]/g, '');
    if (cleanName && commonCities[cleanName]) {
      return commonCities[cleanName];
    }

    // 3. 模糊匹配
    for (const [city, code] of Object.entries(commonCities)) {
      if (city.includes(cityName) || cityName.includes(city)) {
        return code;
      }
    }

    return null;
  }
}