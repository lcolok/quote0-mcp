# Claude 开发备忘录

## 快捷命令

### 小组件生成和发送
```bash
# 天气组件
bun widget weather 花都
bun widget weather 海珠区 0 amap

# 新闻组件  
bun widget news technology
bun widget news finance 0 mock
```

### 原始命令（带环境变量）
如果需要使用原始命令：
```bash
MINDRESET_DEVICE_ID=E4B063CC0F10 MINDRESET_DEVICE_SECRET=dot_app_pVMhvUteeDqAnibZQtMofYnkJuyaMjEXzgcohArxPyJbEJgnYPTpUcRsalPnEDyr node dist/image-sender/interfaces/cli/cli-main.js send "图片路径" 0
```

## 项目结构

### 插件系统
- `src/react-widgets/core/widget-plugin.ts` - 插件接口定义
- `src/react-widgets/core/widget-registry.ts` - 插件注册表
- `src/react-widgets/core/widget-cli-engine.ts` - 通用CLI执行引擎

### 已实现组件
- `src/react-widgets/plugins/weather-plugin.ts` - 天气组件插件
- `src/react-widgets/plugins/news-plugin.ts` - 新闻组件插件

### 字体系统
- 使用智能字体选择算法，支持8px/10px/12px像素字体
- 16px显示使用8px基础字体进行2x整数倍缩放

## 开发规范

### 新组件开发流程
1. 创建组件React文件：`src/react-widgets/components/XxxWidget.tsx`
2. 创建插件实现：`src/react-widgets/plugins/xxx-plugin.ts`
3. 在CLI中注册插件
4. 测试和优化

### 字体使用
- 所有组件使用 `FontLoader.getFusionPixelFontFamily()` 
- 字体大小使用16px以获得最佳清晰度（8px基础字体×2）
- 行高设置为字体大小+2px（如16px字体用18px行高）