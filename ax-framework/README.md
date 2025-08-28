# AX Framework - 智能新闻优化框架

## 📁 目录结构

```
ax-framework/
├── training-data/           # 训练数据源文件
│   ├── ax-training-data.ts     # 高质量训练样本（源码）
│   └── README.md              # 训练数据说明
├── compiled/               # 编译产物（自动生成，不纳入版本控制）
│   ├── ax-training-data.js     # 编译后的JavaScript
│   ├── ax-training-data.d.ts   # TypeScript声明文件
│   └── *.map                  # 源映射文件
├── models/                 # 训练好的模型
│   ├── production/            # 生产环境模型
│   ├── development/           # 开发环境模型
│   └── experimental/          # 实验性模型
├── optimization-artifacts/ # 优化过程产物
│   ├── human-feedback/        # 人工反馈数据
│   └── training-logs/         # 训练日志
└── tsconfig.json          # TypeScript编译配置
```

## 🚀 使用方式

### 编译训练数据
```bash
# 编译AX框架训练数据
npm run build:ax-framework

# 或手动编译
npx tsc -p ax-framework/tsconfig.json
```

### 导入训练数据
```typescript
// 在代码中导入编译后的训练数据
const { trainingData } = await import('../ax-framework/compiled/ax-training-data.js');
```

## 📋 文件说明

### 源码文件（纳入版本控制）
- `training-data/ax-training-data.ts` - 手工维护的高质量训练样本
- `tsconfig.json` - 专用的TypeScript编译配置
- `README.md` - 本说明文件

### 自动生成文件（不纳入版本控制）
- `compiled/` 目录下的所有文件
- 通过 `.gitignore` 排除版本控制

## 🔧 开发规范

1. **只修改源文件**: 仅编辑 `training-data/*.ts` 文件
2. **自动编译**: 编译产物由构建工具自动生成
3. **清理构建**: 使用 `git clean -fd ax-framework/compiled/` 清理编译产物
4. **模型管理**: 生产模型存放在 `models/production/` 目录

## 📊 训练数据质量标准

- **标题长度**: 5-20字符
- **摘要长度**: 50-200字符  
- **质量评分**: 1-5分制
- **难度评级**: 1-5级分类
- **领域覆盖**: technology, ai, business, automotive等