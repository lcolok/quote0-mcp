import { DynamicCityService } from '../services/dynamic-city-service.js';

async function testDynamicCityService() {
  const service = new DynamicCityService();
  
  console.log('🧪 测试动态城市代码发现服务...\n');

  // 测试各种城市名称
  const testCities = [
    '杭州',      // 浙江省会
    '福州',      // 福建省会
    '南昌',      // 江西省会
    '郑州',      // 河南省会
    '石家庄',    // 河北省会
    '太原',      // 山西省会
    '沈阳',      // 辽宁省会
    '长春',      // 吉林省会
    '哈尔滨',    // 黑龙江省会
    '合肥',      // 安徽省会
    '西湖区',    // 区级测试
    '黄浦区',    // 区级测试
    '天山区',    // 新疆区级测试
    '不存在的城市', // 应该fallback
  ];

  for (const city of testCities) {
    try {
      console.log(`🔍 查找城市: ${city}`);
      const startTime = Date.now();
      const cityCode = await service.smartCityLookup(city);
      const duration = Date.now() - startTime;
      
      console.log(`  ✅ 找到代码: ${cityCode} (耗时: ${duration}ms)`);
      console.log('');
    } catch (error) {
      console.log(`  ❌ 查找失败: ${error}`);
      console.log('');
    }
  }
}

testDynamicCityService().catch(console.error);