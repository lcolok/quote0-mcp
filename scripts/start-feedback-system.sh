#!/bin/bash

echo "🚀 启动AX Framework现代化反馈系统"
echo "=================================="

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到Node.js，请先安装Node.js"
    exit 1
fi

# 检查依赖
echo "📦 检查依赖..."
cd src/feedback-ui
if [ ! -d "node_modules" ]; then
    echo "📥 安装React依赖..."
    npm install
fi

# 启动API服务器
echo "🔧 启动反馈API服务器..."
cd server
if [ ! -f "package.json" ]; then
    echo '{"name":"feedback-api","version":"1.0.0","dependencies":{"express":"^4.18.0","cors":"^2.8.5"}}' > package.json
    npm install
fi

# 后台启动API服务器
node api.js &
API_PID=$!
echo "✅ API服务器已启动 (PID: $API_PID)"

# 回到前端目录
cd ..

# 启动React开发服务器
echo "🎨 启动React前端..."
npm run start &
REACT_PID=$!
echo "✅ React应用已启动 (PID: $REACT_PID)"

echo ""
echo "🎉 系统启动完成！"
echo "📱 React前端: http://localhost:3002"
echo "🔗 API服务器: http://localhost:3003"
echo ""
echo "使用方法："
echo "1. 在浏览器中打开 http://localhost:3002"
echo "2. 填写反馈表单并提交"
echo "3. 运行训练集成脚本处理反馈数据："
echo "   cd ../../.. && tsx scripts/web-feedback-integration.ts"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待中断信号
trap 'echo "🛑 正在停止服务..."; kill $API_PID $REACT_PID 2>/dev/null; exit 0' INT

# 保持脚本运行
wait