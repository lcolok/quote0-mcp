/**
 * 数据源模块统一导出
 * 该文件现在从独立的模块文件中导入所有数据源实现
 */

// 导入分拆后的数据源模块
export { 
  BaseDataSourceModule,
  RSSDataSourceModule,
  MockDataSourceModule,
  APIDataSourceModule,
  HackerNewsDataSourceModule,
  DataSourceRegistry,
  dataSourceRegistry
} from './data-sources/index.js';