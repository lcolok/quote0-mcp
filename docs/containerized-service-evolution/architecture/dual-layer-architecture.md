# 双层架构设计文档

## 🏗️ 架构概览

基于内容更新与轮播分离的核心洞察，设计了双层架构：

```
┌─────────────────────────────────────────────────────────┐
│                   Widget Platform                       │
├─────────────────────┬───────────────────────────────────┤
│   Content Layer     │        Display Layer              │
│  (内容生产层)        │       (显示轮播层)                 │
└─────────────────────┴───────────────────────────────────┘
```

## 📊 Content Layer (内容生产层)

### 核心职责
- **数据获取**: 调用外部API获取实时数据
- **内容生成**: 渲染React组件为水墨屏图像
- **生命周期管理**: 控制更新频率和API配额
- **版本控制**: 为生成的内容分配版本号

### 主要组件

#### 1. Lifecycle Manager (生命周期管理器)
```typescript
interface LifecycleManager {
  scheduleUpdate(widgetType: string, config: UpdateConfig): void;
  checkApiQuota(widgetType: string): QuotaStatus;
  triggerUpdate(widgetType: string, force?: boolean): Promise<void>;
  getUpdateHistory(widgetType: string): UpdateRecord[];
}
```

#### 2. Widget Factory (组件工厂)
```typescript
interface WidgetFactory {
  createWidget(type: string, params: WidgetParams): Promise<ReactElement>;
  renderToImage(widget: ReactElement, options: RenderOptions): Promise<Buffer>;
  optimizeForDevice(image: Buffer, deviceProfile: DeviceProfile): Promise<Buffer>;
}
```

#### 3. API Quota Controller (API配额控制器)
```typescript
interface QuotaController {
  trackApiCall(service: string, cost: number): void;
  checkQuotaAvailable(service: string, requiredCalls: number): boolean;
  getUsageStats(service: string, period: 'daily' | 'monthly'): UsageStats;
  setQuotaLimits(service: string, limits: QuotaLimits): void;
}
```

#### 4. Version Manager (版本管理器)
```typescript
interface VersionManager {
  createVersion(widgetType: string, content: Buffer, metadata: VersionMetadata): string;
  getLatestVersion(widgetType: string, filters?: VersionFilter): VersionInfo;
  compareVersions(oldVersion: string, newVersion: string): VersionDiff;
  rollbackToVersion(widgetType: string, targetVersion: string): Promise<void>;
}
```

## 📺 Display Layer (显示轮播层)

### 核心职责
- **轮播调度**: 管理设备的轮播时序和内容切换
- **设备管理**: 维护设备状态和配置信息
- **内容分发**: 将版本化内容推送给目标设备
- **推送优化**: 智能推送策略和错误处理

### 主要组件

#### 1. Carousel Engine (轮播引擎)
```typescript
interface CarouselEngine {
  createPlaylist(deviceId: string, config: PlaylistConfig): Promise<Playlist>;
  scheduleNext(deviceId: string): Promise<CarouselItem>;
  updatePlaylist(deviceId: string, changes: PlaylistChange[]): Promise<void>;
  getPlaylistStatus(deviceId: string): PlaylistStatus;
}
```

#### 2. Device Manager (设备管理器)
```typescript
interface DeviceManager {
  registerDevice(deviceInfo: DeviceRegistration): Promise<string>;
  updateDeviceStatus(deviceId: string, status: DeviceStatus): Promise<void>;
  getDeviceProfile(deviceId: string): DeviceProfile;
  queryDevices(filters: DeviceFilter): Promise<DeviceInfo[]>;
}
```

#### 3. Push Service (推送服务)
```typescript
interface PushService {
  pushContent(deviceId: string, content: ContentPayload): Promise<PushResult>;
  batchPush(targets: PushTarget[]): Promise<BatchPushResult>;
  retryFailedPush(pushId: string): Promise<PushResult>;
  getPushHistory(deviceId: string): Promise<PushRecord[]>;
}
```

#### 4. Cache Manager (缓存管理器)
```typescript
interface CacheManager {
  getContent(key: string): Promise<Buffer | null>;
  setContent(key: string, content: Buffer, ttl?: number): Promise<void>;
  invalidatePattern(pattern: string): Promise<number>;
  getStats(): Promise<CacheStats>;
}
```

## 🔄 层间交互

### 数据流向
1. **Content Layer** 生成新版本 → 存储到版本仓库
2. **Display Layer** 检测版本更新 → 触发内容分发
3. 设备请求轮播内容 → 从缓存获取当前版本
4. **Push Service** 主动推送新版本到设备

### 解耦机制
- 通过版本号进行内容标识
- 使用事件总线进行层间通信
- 缓存层作为数据交换中介
- API网关统一对外接口

## 💾 数据存储设计

### Redis (热数据缓存)
```
widgets:{type}:{version}     # 组件内容缓存
devices:{id}:status          # 设备状态缓存  
playlists:{device_id}        # 轮播列表缓存
quotas:{service}:{period}    # API配额统计
```

### PostgreSQL (持久化存储)
```sql
-- 组件版本记录
CREATE TABLE widget_versions (
  id VARCHAR PRIMARY KEY,
  widget_type VARCHAR NOT NULL,
  version VARCHAR NOT NULL,
  content_hash VARCHAR,
  created_at TIMESTAMP,
  metadata JSONB
);

-- 设备信息表
CREATE TABLE devices (
  device_id VARCHAR PRIMARY KEY,
  device_type VARCHAR,
  profile JSONB,
  last_seen TIMESTAMP,
  status VARCHAR
);

-- API配额使用记录
CREATE TABLE api_usage (
  service VARCHAR,
  period VARCHAR,
  usage_count INTEGER,
  limit_count INTEGER,
  reset_at TIMESTAMP
);
```

## 🚀 扩展性考虑

### 水平扩展
- Content Layer: 按组件类型分片
- Display Layer: 按设备分片  
- 缓存层: Redis Cluster
- 数据库: 读写分离

### 服务拆分
- 每个组件类型可独立为微服务
- API配额服务可独立部署
- 推送服务支持多协议适配

---
*设计版本: v1.0*  
*更新时间: 2025-01-23*