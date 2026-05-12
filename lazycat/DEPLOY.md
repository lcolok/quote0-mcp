# Quote0-MCP 懒猫微服部署指南

## 快速开始

### 方式一：使用构建脚本（推荐）

```bash
cd lazycat
chmod +x build.sh
./build.sh
```

### 方式二：手动构建

#### 步骤 1: 安装 lzc-cli

```bash
npm install -g @lazycatcloud/lzc-cli
```

#### 步骤 2: 构建 API 镜像

```bash
cd /Volumes/Mac Mini M4 Plus APFS/GitHub/quote0-mcp
docker build -f Dockerfile.api -t quote0-mcp-api:latest .
```

#### 步骤 3: 推送镜像到懒猫 Registry

```bash
# 登录
lzc-cli appstore login

# 推送镜像
lzc-cli appstore copy-image quote0-mcp-api:latest
```

推送成功后，会输出类似：
```
registry.lazycat.cloud/friday/quote0-mcp-api:<hash>
```

**注意**：需要在 `lzc-manifest.yml` 中更新镜像地址。

#### 步骤 4: 构建并安装 LPK

```bash
cd lazycat

# 构建 LPK
lzc-cli project build

# 安装到懒猫微服
lzc-cli app install ./me.friday.quote0-mcp-v1.0.0.lpk
```

## 环境配置

### 必需配置（首次启动前）

安装完成后，在懒猫微服控制台设置以下环境变量：

```env
# MindReset 设备配置
MINDRESET_DEVICE_ID=你的设备序列号
MINDRESET_DEVICE_SECRET=你的设备密钥
```

获取方式：
- 打开 MindReset App
- 进入设备详情页面
- 复制设备序列号和 API 密钥

### 可选配置

```env
# 新闻调度器（默认开启）
NEWS_SCHEDULER_ENABLED=true

# 时区
TZ=Asia/Shanghai
```

## 访问应用

安装完成后，可以通过以下地址访问：

- **主服务**: `https://quote0.<你的域名>.lazycat.cloud`
- **API文档**: `https://quote0.<你的域名>.lazycat.cloud/api/docs`
- **标注系统**: `https://annotation-quote0.<你的域名>.lazycat.cloud`

## 内存占用

各服务内存限制配置：

| 服务 | 内存限制 | 说明 |
|------|----------|------|
| PostgreSQL | 512 MB | 新闻缓存数据库 |
| MinIO | 256 MB | 图片/字体对象存储 |
| Redis | 256 MB | 内存缓存 |
| News-API | 512 MB | 主 API 服务 |
| **总计** | **约 1.5 GB** | 实际占用约 600-800 MB |

## 数据持久化

所有数据存储在懒猫微服的持久化目录中：

```
/lzcapp/var/postgres    # PostgreSQL 数据
/lzcapp/var/minio       # MinIO 对象存储
/lzcapp/var/redis       # Redis 数据
/lzcapp/var/images      # 处理后的图片
```

## 故障排查

### 检查服务状态

```bash
# 查看应用状态
lzc-cli app status me.friday.quote0-mcp

# 查看日志
lzc-cli app logs me.friday.quote0-mcp
```

### 常见问题

#### 1. 服务启动失败

**症状**: 应用安装后无法访问

**排查**:
```bash
# 检查依赖服务是否健康
lzc-cli app logs me.friday.quote0-mcp --service postgres
lzc-cli app logs me.friday.quote0-mcp --service minio
lzc-cli app logs me.friday.quote0-mcp --service redis
```

**解决**: 首次启动可能需要等待数据库初始化完成（约 30-60 秒）

#### 2. 字体加载失败

**症状**: 新闻图片中的字体显示异常

**原因**: MinIO 中的字体对象未正确上传

**解决**:
```bash
# 重启 API 服务以重新初始化 MinIO 桶
lzc-cli app restart me.friday.quote0-mcp --service news-api
```

#### 3. MindReset 推送失败

**症状**: 新闻图片未推送到设备

**排查**:
1. 检查环境变量 `MINDRESET_DEVICE_ID` 和 `MINDRESET_DEVICE_SECRET` 是否设置正确
2. 查看 API 日志：
   ```bash
   lzc-cli app logs me.friday.quote0-mcp --service news-api
   ```

**解决**: 在懒猫微服控制台重新配置设备凭据

#### 4. 数据库连接失败

**症状**: API 服务日志显示数据库连接错误

**原因**: PostgreSQL 服务启动较慢

**解决**: 
- 等待 30 秒后 API 服务会自动重试连接
- 或手动重启 API 服务

## 更新应用

### 更新代码

1. 更新源代码
2. 重新构建镜像
3. 推送新镜像
4. 重新构建 LPK
5. 更新应用：
   ```bash
   lzc-cli app update me.friday.quote0-mcp ./me.friday.quote0-mcp-v1.0.1.lpk
   ```

### 仅更新配置

如果只是修改 `lzc-manifest.yml` 中的配置（如环境变量）：

```bash
cd lazycat
lzc-cli project build
lzc-cli app update me.friday.quote0-mcp ./me.friday.quote0-mcp-v1.0.0.lpk
```

## 卸载应用

```bash
lzc-cli app uninstall me.friday.quote0-mcp
```

**注意**：卸载后 `/lzcapp/var/` 中的数据会保留，重新安装后数据仍然存在。

## 开发者说明

### 本地开发调试

如果你想在本地修改代码后快速测试：

```bash
# 使用 Docker Compose 本地运行
docker-compose up -d

# 或使用 Bun 直接运行
bun api:dev
```

### 修改 manifest

编辑 `lazycat/lzc-manifest.yml` 后，需要重新构建 LPK：

```bash
cd lazycat
lzc-cli project build
```

### 发布到商店（可选）

```bash
# 构建并发布
lzc-cli project build
lzc-cli appstore publish ./me.friday.quote0-mcp-v1.0.0.lpk
```

## 参考文档

- [懒猫微服开发者手册](https://developer.lazycat.cloud/)
- [lzc-manifest.yml 规范](https://developer.lazycat.cloud/spec/manifest.html)
- [移植应用指南](https://developer.lazycat.cloud/app-example-porting.html)

## 支持

遇到问题？

1. 查看 [项目 README](../README.md)
2. 查看 [故障排查](#故障排查) 部分
3. 在懒猫微服社区寻求帮助
