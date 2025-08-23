interface CityData {
  [key: string]: string;
}

interface ProvinceData {
  [provinceCode: string]: string;
}

interface CityHierarchy {
  provinces: ProvinceData;
  cities: { [provinceCode: string]: CityData };
  stations: { [cityCode: string]: CityData };
}

export class DynamicCityService {
  private cityHierarchy: CityHierarchy = {
    provinces: {},
    cities: {},
    stations: {}
  };

  private cache = new Map<string, string>();
  private isInitialized = false;

  // 基于已知WMO气象站代码的扩展映射
  private knownWMOStations: { [key: string]: string } = {
    // 直辖市
    '北京': '54511', '北京市': '54511',
    '海淀': '54399', '海淀区': '54399', '北京海淀': '54399',
    '朝阳': '54433', '朝阳区': '54433', '北京朝阳': '54433',
    '上海': '58367', '上海市': '58367',
    '天津': '54527', '天津市': '54527',
    '重庆': '57516', '重庆市': '57516',
    
    // 省会城市
    '广州': '59287', '广州市': '59287',
    '海珠': '59287', '海珠区': '59287',
    '天河': '59287', '天河区': '59287',
    '深圳': '59493', '深圳市': '59493',
    '杭州': '58457', '杭州市': '58457',
    '南京': '58238', '南京市': '58238',
    '武汉': '57494', '武汉市': '57494',
    '成都': '56294', '成都市': '56294',
    '西安': '57036', '西安市': '57036',
    '厦门': '59134', '厦门市': '59134',
    '福州': '58847', '福州市': '58847',
    '昆明': '56778', '昆明市': '56778',
    '南昌': '58606', '南昌市': '58606',
    '郑州': '57083', '郑州市': '57083',
    '石家庄': '53698', '石家庄市': '53698',
    '太原': '53772', '太原市': '53772',
    '沈阳': '54342', '沈阳市': '54342',
    '长春': '54161', '长春市': '54161',
    '哈尔滨': '50953', '哈尔滨市': '50953',
    '合肥': '58321', '合肥市': '58321',
    '济南': '54823', '济南市': '54823',
    '长沙': '57679', '长沙市': '57679',
    '南宁': '59431', '南宁市': '59431',
    '海口': '59758', '海口市': '59758',
    '贵阳': '57816', '贵阳市': '57816',
    '兰州': '52889', '兰州市': '52889',
    '西宁': '52866', '西宁市': '52866',
    '银川': '53614', '银川市': '53614',
    '乌鲁木齐': '51463', '乌鲁木齐市': '51463',
    '拉萨': '55591', '拉萨市': '55591',
    '呼和浩特': '53463', '呼和浩特市': '53463',
  };

  async initializeCityDatabase(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 暂时不加载动态数据，直接标记为初始化完成
      this.isInitialized = true;
      console.log('🎯 使用扩展WMO气象站代码映射');
    } catch (error) {
      console.error('初始化城市数据库失败:', error);
      throw error;
    }
  }

  private async loadProvinces(): Promise<void> {
    const response = await fetch('https://www.weather.com.cn/data/city3jdata/china.html');
    const text = await response.text();
    this.cityHierarchy.provinces = JSON.parse(text);
  }

  private async loadCitiesForProvince(provinceCode: string): Promise<CityData> {
    if (this.cityHierarchy.cities[provinceCode]) {
      return this.cityHierarchy.cities[provinceCode];
    }

    const response = await fetch(`https://www.weather.com.cn/data/city3jdata/provshi/${provinceCode}.html`);
    const text = await response.text();
    const cities = JSON.parse(text);
    this.cityHierarchy.cities[provinceCode] = cities;
    return cities;
  }

  private async loadStationsForCity(cityCode: string): Promise<CityData> {
    if (this.cityHierarchy.stations[cityCode]) {
      return this.cityHierarchy.stations[cityCode];
    }

    const response = await fetch(`https://www.weather.com.cn/data/city3jdata/station/${cityCode}.html`);
    const text = await response.text();
    const stations = JSON.parse(text);
    this.cityHierarchy.stations[cityCode] = stations;
    return stations;
  }

  async findCityCode(cityName: string): Promise<string | null> {
    if (!this.isInitialized) {
      await this.initializeCityDatabase();
    }

    const cacheKey = cityName.toLowerCase().trim();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // 1. 直接精确匹配
    if (this.knownWMOStations[cityName]) {
      const code = this.knownWMOStations[cityName];
      this.cache.set(cacheKey, code);
      return code;
    }

    // 2. 清理城市名后匹配
    const cleanName = cityName.replace(/[市区县]/g, '');
    if (cleanName && this.knownWMOStations[cleanName]) {
      const code = this.knownWMOStations[cleanName];
      this.cache.set(cacheKey, code);
      return code;
    }

    // 3. 模糊匹配
    for (const [knownCity, code] of Object.entries(this.knownWMOStations)) {
      if (knownCity.includes(cityName) || cityName.includes(knownCity)) {
        this.cache.set(cacheKey, code);
        return code;
      }
    }

    return null;
  }

  async smartCityLookup(cityName: string): Promise<string> {
    // 使用扩展的WMO气象站代码映射
    const code = await this.findCityCode(cityName);
    if (code) {
      console.log(`🎯 智能匹配城市代码: ${cityName} -> ${code}`);
      return code;
    }

    // 最后fallback到广州
    console.log(`⚠️ 未找到城市 ${cityName}，使用默认城市代码: 59287 (广州)`);
    return '59287';
  }
}