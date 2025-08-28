/**
 * 数据源模块抽象基类
 */

import { 
  DataSourceModule, 
  RawDataItem, 
  DataSourceParams, 
  DataSourceParamDefinition, 
  DataSourceHealthStatus 
} from '../modular-architecture.js';

/**
 * 数据源模块抽象基类
 */
export abstract class BaseDataSourceModule implements DataSourceModule {
  abstract name: string;
  abstract version: string;
  abstract description: string;
  
  abstract fetchRawData(params: DataSourceParams): Promise<RawDataItem[]>;
  abstract getSupportedParams(): DataSourceParamDefinition[];
  
  validateParams(params: DataSourceParams): boolean {
    const supportedParams = this.getSupportedParams();
    
    // 检查必需参数
    for (const paramDef of supportedParams) {
      if (paramDef.required && !(paramDef.name in params)) {
        console.error(`缺少必需参数: ${paramDef.name}`);
        return false;
      }
      
      // 检查参数类型和验证
      if (paramDef.name in params) {
        const value = params[paramDef.name];
        
        if (paramDef.validation && !paramDef.validation(value)) {
          console.error(`参数验证失败: ${paramDef.name}`);
          return false;
        }
      }
    }
    
    return true;
  }
  
  async getHealthStatus(): Promise<DataSourceHealthStatus> {
    const startTime = Date.now();
    
    try {
      // 尝试获取一条测试数据
      const testData = await this.fetchRawData({ count: 1, startIndex: 0 });
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        message: `${this.name}正常运行`,
        lastChecked: new Date().toISOString(),
        responseTime,
        dataQuality: testData.length > 0 ? 100 : 50
      };
      
    } catch (error) {
      return {
        healthy: false,
        message: `${this.name}异常: ${error instanceof Error ? error.message : '未知错误'}`,
        lastChecked: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        dataQuality: 0
      };
    }
  }
}