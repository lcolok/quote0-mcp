# 🏗️ 代码重组计划

## 📋 当前问题
scripts/ 目录中混合了不同功能模块的代码，应该按功能域重新组织

## 🎯 重组方案

### **1. React Widgets 模块重组**
```
src/react-widgets/
├── cli/                          # 新建CLI目录
│   ├── weather-cli.ts           # widget-sender.ts → 重命名
│   └── commands/
│       ├── send.ts
│       └── test.ts
├── tools/                        # 新建工具目录  
│   ├── network-diagnostics.ts   # diagnose-network.ts
│   ├── api-monitor.ts           # monitor-api-stability.ts
│   └── city-service-test.ts     # test-dynamic-city.ts
├── tests/                        # 新建测试目录
│   ├── weather-services.test.ts # 合并各种test-*-weather.ts
│   └── api-integration.test.ts  # test-weathercityid-api.ts
```

### **2. Image Sender 模块重组**
```
src/image-sender/
├── cli/
│   └── quick-send.ts           # scripts/quick-send.ts
├── processors/
│   ├── enhanced-ordered.ts     # scripts/enhanced-ordered.ts  
│   └── ordered-dither.ts       # scripts/ordered-dither.ts
```

### **3. 保留在根level**
```
scripts/                         # 仅保留项目级工具
├── test-icons.ts               # 图标测试 (跨模块)
├── compare-widgets.ts          # 组件对比 (跨模块)
└── archive/                    # 历史脚本
```

## 🔧 执行步骤

### Phase 1: 创建目录结构
```bash
mkdir -p src/react-widgets/{cli,tools,tests}
mkdir -p src/image-sender/{cli,processors}
```

### Phase 2: 移动文件
```bash
# React Widgets
mv scripts/widget-sender.ts src/react-widgets/cli/weather-cli.ts
mv scripts/diagnose-network.ts src/react-widgets/tools/network-diagnostics.ts
mv scripts/monitor-api-stability.ts src/react-widgets/tools/api-monitor.ts
mv scripts/test-dynamic-city.ts src/react-widgets/tools/city-service-test.ts

# Image Sender  
mv scripts/quick-send.ts src/image-sender/cli/
mv scripts/enhanced-ordered.ts src/image-sender/processors/
mv scripts/ordered-dither.ts src/image-sender/processors/

# 合并测试文件
# 将 test-*-weather.ts 合并为统一的测试套件
```

### Phase 3: 更新引用
```bash
# 更新 package.json 中的脚本路径
# 更新 import 路径
# 更新文档引用
```

## 📊 重组后的结构优势

### **清晰的模块边界**
- ✅ React Widgets: 天气组件相关的所有代码
- ✅ Image Sender: 图像处理相关的所有代码  
- ✅ Scripts: 仅保留跨模块的项目级工具

### **更好的可维护性**  
- ✅ 每个模块的CLI、工具、测试都在一起
- ✅ 降低跨模块依赖
- ✅ 便于模块化开发和测试

### **符合项目架构**
- ✅ 与现有的 src/ 目录结构一致
- ✅ 每个功能域都有完整的内部结构
- ✅ 便于未来的模块独立发布

## ⚠️ 注意事项

1. **保持向后兼容**: 更新 package.json 中的 npm scripts
2. **更新import路径**: 确保所有引用都正确更新
3. **测试验证**: 重组后需要测试所有功能正常工作
4. **文档同步**: 更新README和相关文档

## 🚀 执行时机

建议在当前功能稳定后执行此重组，确保：
- ✅ DynamicCityService 功能已完全稳定
- ✅ 所有测试通过  
- ✅ 用户功能正常工作
- ✅ 在独立分支中执行重组操作