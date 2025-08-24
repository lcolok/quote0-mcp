# AX Framework 现代化反馈系统

这是一个基于React的现代化Web界面，用于收集AX新闻AI模型的人工反馈，实现持续学习和优化。

## ✨ 特性

- 🎨 **现代化UI设计**：使用React + TypeScript + Tailwind CSS
- 📊 **实时数据展示**：动态图表和统计信息
- ✋ **交互式反馈**：星级评分、多维度质量评估
- 🔄 **自动集成**：与AX训练系统无缝连接
- 📱 **响应式设计**：支持桌面和移动设备
- 🎭 **动画效果**：使用Framer Motion提供流畅体验

## 🏗️ 技术架构

### 前端技术栈
- **React 18** - 现代化组件框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 原子化CSS框架
- **Vite** - 快速构建工具
- **Zustand** - 轻量级状态管理
- **Framer Motion** - 动画库
- **Lucide React** - 图标库
- **React Hot Toast** - 通知组件

### 后端集成
- **Express API** - RESTful API服务器
- **文件系统存储** - 反馈数据持久化
- **AX训练集成** - 自动转换为训练数据

## 🚀 快速开始

### 1. 安装依赖

```bash
cd src/feedback-ui
npm install
```

### 2. 启动开发服务器

```bash
npm run start
```

应用将在 `http://localhost:3002` 启动

### 3. 启动API服务器（可选）

```bash
cd server
npm install
node api.js
```

API服务器将在 `http://localhost:3003` 启动

### 4. 一键启动（推荐）

```bash
# 从项目根目录运行
./scripts/start-feedback-system.sh
```

## 📝 使用方法

### 基本工作流

1. **打开应用**：在浏览器中访问 `http://localhost:3002`
2. **查看AI输出**：系统会显示AI生成的新闻标题和摘要
3. **提供反馈**：
   - 填写评估者信息
   - 对整体质量打分
   - 评估标题和摘要的各项指标
   - 添加专家标注和改进建议
4. **提交反馈**：点击提交按钮，数据自动保存并发送到训练系统
5. **查看统计**：右侧面板显示评估历史和质量趋势

### 反馈数据处理

提交的反馈会自动：
- 保存到本地存储作为备份
- 发送到API服务器进行持久化
- 转换为AX训练格式
- 生成质量分析报告

## 🔧 开发指南

### 项目结构

```
src/feedback-ui/
├── src/
│   ├── components/          # React组件
│   │   ├── AIOutputDisplay.tsx    # AI输出展示
│   │   ├── Card.tsx              # 卡片组件
│   │   ├── Dashboard.tsx         # 统计面板
│   │   ├── FeedbackForm.tsx      # 反馈表单
│   │   └── StarRating.tsx        # 星级评分
│   ├── store/              # 状态管理
│   │   └── feedbackStore.ts      # Zustand状态存储
│   ├── types/              # TypeScript类型
│   │   └── feedback.ts           # 反馈数据类型
│   ├── App.tsx             # 主应用组件
│   ├── App.css            # 全局样式
│   ├── main.tsx           # 应用入口
│   └── index.css          # 基础样式
├── server/                 # 后端API
│   └── api.js             # Express服务器
├── public/                # 静态资源
├── package.json           # 依赖配置
├── vite.config.ts        # Vite配置
├── tailwind.config.js    # Tailwind配置
└── tsconfig.json         # TypeScript配置
```

### 添加新功能

1. **新组件**：在 `src/components/` 中创建新的React组件
2. **状态管理**：在 `feedbackStore.ts` 中添加新的状态和操作
3. **类型定义**：在 `types/feedback.ts` 中定义新的TypeScript类型
4. **样式**：使用Tailwind CSS类名进行样式设置

### 自定义配置

- **端口配置**：修改 `package.json` 中的 `start` 脚本
- **API地址**：在 `feedbackStore.ts` 中修改API端点
- **样式主题**：在 `tailwind.config.js` 中自定义主题色彩

## 🔗 与AX训练系统集成

### 数据流

1. **Web反馈** → `localStorage` + `API服务器`
2. **文件存储** → `web-feedback-data/*.json`
3. **训练转换** → `scripts/web-feedback-integration.ts`
4. **AX格式** → `ax-optimization-artifacts/human-feedback/`

### 处理反馈数据

```bash
# 处理Web反馈并转换为训练数据
cd ../../..
npx tsx scripts/web-feedback-integration.ts
```

### 集成到持续训练

反馈数据会自动转换为AX训练格式，包含：
- 原始新闻内容和AI输出
- 人工评分和质量指标
- 专家标注和改进建议
- 评估者专业背景信息
- 详细的反馈分析报告

## 📊 数据格式

### 反馈数据结构

```typescript
interface HumanFeedback {
  taskId: string;
  timestamp: string;
  reviewer: ReviewerInfo;      // 评估者信息
  input: NewsInput;           // 原始新闻
  aiOutput: AIOutput;         // AI输出
  overallScore: number;       // 整体评分
  titleFeedback: TitleFeedback;    // 标题反馈
  summaryFeedback: SummaryFeedback; // 摘要反馈
  expertAnnotations: ExpertAnnotations; // 专家标注
  comments?: string;          // 额外评论
}
```

### AX训练格式

生成的训练数据包含完整的输入输出映射和人工质量标注，可直接用于：
- BootstrapFewShot优化
- MiPRO指令优化
- 质量评估模型训练
- 持续学习系统

## 🚀 部署指南

### 开发环境
```bash
npm run dev    # 开发服务器
npm run build  # 构建生产版本
npm run preview # 预览生产版本
```

### 生产环境
```bash
npm run build
# 将 dist/ 目录部署到Web服务器
```

### Docker部署（可选）
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3002
CMD ["npm", "run", "preview"]
```

## 🤝 贡献指南

1. Fork项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建Pull Request

## 📄 许可证

MIT License

## 🆘 故障排除

### 常见问题

1. **端口占用**：修改 `package.json` 中的端口号
2. **API连接失败**：检查后端服务器是否启动
3. **构建错误**：清除缓存并重新安装依赖
4. **样式不生效**：检查Tailwind CSS配置

### 获取帮助

- 查看浏览器控制台错误信息
- 检查网络请求状态
- 确认Node.js版本 >= 16
- 验证依赖安装完整性

---

🎉 **感谢使用AX Framework现代化反馈系统！**

通过这个系统，您可以轻松收集高质量的人工反馈，持续改进AI新闻处理模型的质量。