# 小组件框架解耦设计发现

## 🔍 当前耦合问题分析

### 1. CLI层强耦合
**问题**: `weather-cli.ts` 包含了过多天气专用逻辑
```typescript
// 当前问题：硬编码天气逻辑
const dataSource = args[2] || 'amap'; // 天气专用
const weatherData = await getWeatherForCityRobust(city); // 天气专用
```

### 2. 类型系统不通用
**问题**: `types.ts` 只定义了天气相关类型
```typescript
// 当前问题：只有WeatherData，缺乏通用抽象
export interface WeatherData { ... }
```

### 3. 渲染器缺乏组件抽象
**问题**: `renderer.ts` 虽然通用但缺乏组件类型管理

## 💡 解耦策略

### 1. 插件化架构
将每个组件类型设计为独立插件，遵循统一接口：

```typescript
interface WidgetPlugin<TData = any, TConfig = any> {
  type: string;
  name: string;
  description: string;
  
  // 数据获取接口
  dataProvider: WidgetDataProvider<TData>;
  
  // 渲染组件
  component: React.ComponentType<WidgetProps<TData>>;
  
  // 配置验证
  validateConfig(config: TConfig): boolean;
  
  // CLI参数定义
  getCliOptions(): CliOption[];
}
```

### 2. 通用CLI框架
```typescript
// 新的通用CLI设计
interface WidgetCLI {
  register(plugin: WidgetPlugin): void;
  run(widgetType: string, args: string[]): Promise<void>;
}
```

### 3. 数据提供者抽象
```typescript
interface WidgetDataProvider<T> {
  getSources(): string[];
  getData(source: string, params: any): Promise<T>;
  validateParams(params: any): boolean;
}
```

## 🎯 具体实施计划

### 第一步：创建框架核心
1. 设计通用组件接口
2. 创建插件注册机制
3. 重构CLI为通用框架

### 第二步：天气组件插件化
1. 将天气逻辑提取为插件
2. 保持现有功能完整性
3. 验证插件机制正确性

### 第三步：开发新闻组件
1. 使用插件接口开发新闻组件
2. 验证框架的通用性
3. 完善插件生态

## 🔧 技术实现要点

### 1. 类型安全的插件系统
- 使用泛型确保类型安全
- 运行时配置验证
- 自动CLI参数生成

### 2. 可扩展的数据源管理
- 支持多数据源策略
- 统一的错误处理
- 缓存和重试机制

### 3. 一致的用户体验
- 统一的CLI接口风格
- 一致的错误提示
- 标准化的输出格式

---
*发现时间: 2025-01-23*
*优先级: ⭐⭐⭐⭐⭐*