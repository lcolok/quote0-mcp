# 新闻质量标注系统

基于React + TypeScript的可视化新闻质量标注Web应用，为AX质量评估器提供人工标注样本。

## 技术栈

- **React 18** - UI框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **TailwindCSS** - 样式框架
- **TanStack Query** - 数据状态管理
- **Axios** - HTTP客户端
- **Lucide React** - 图标库

## 开发

### 本地开发

```bash
# 安装依赖
bun install

# 启动开发服务器
bun dev

# 访问 http://localhost:3002
```

### 构建生产版本

```bash
# 构建
bun run build

# 预览生产构建
bun run preview
```

## Docker部署

```bash
# 构建镜像
docker build -t annotation-web .

# 运行容器
docker run -p 3002:80 annotation-web

# 或使用docker-compose（推荐）
cd ..
docker-compose up -d annotation-web
```

## 环境变量

创建 `.env` 文件：

```env
# API服务器地址
VITE_API_URL=http://localhost:3001

# Docker环境
# VITE_API_URL=http://news-api:3001
```

## 项目结构

```
annotation-web/
├── src/
│   ├── api/              # API客户端
│   │   └── client.ts
│   ├── components/       # React组件
│   │   ├── Layout.tsx
│   │   ├── Dashboard.tsx
│   │   ├── AnnotationPage.tsx
│   │   ├── AnnotationForm.tsx
│   │   ├── StatisticsPage.tsx
│   │   ├── ExportPage.tsx
│   │   └── ImportPage.tsx
│   ├── types/            # TypeScript类型定义
│   │   └── index.ts
│   ├── App.tsx           # 主应用组件
│   ├── main.tsx          # 应用入口
│   └── index.css         # 全局样式
├── public/               # 静态资源
├── Dockerfile            # Docker镜像配置
├── nginx.conf            # Nginx配置
├── vite.config.ts        # Vite配置
├── tailwind.config.js    # TailwindCSS配置
├── tsconfig.json         # TypeScript配置
└── package.json          # 项目依赖
```

## 功能特性

### 1. 仪表板
- 查看标注进度概览
- 质量分布统计
- 快速操作入口

### 2. 开始标注
- 逐条标注新闻
- 综合评分（0-100）
- 五维度评分
- 标签管理
- 自动保存和跳转

### 3. 统计分析
- 按分类统计
- 完成率追踪
- 质量分布可视化

### 4. 导出样本
- 按评分范围导出
- AX框架兼容格式
- 自动下载JSON

### 5. 导入数据
- 从RSS源导入
- 批量导入
- 自动去重

## API集成

与后端API服务通信：

- `/api/annotation/news` - 获取新闻列表
- `/api/annotation/news/:id` - 获取新闻详情
- `/api/annotation/news/:id/annotate` - 提交标注
- `/api/annotation/samples/export` - 导出样本
- `/api/annotation/news/import/rss` - 导入数据
- `/api/annotation/statistics` - 获取统计

## 许可证

MIT
