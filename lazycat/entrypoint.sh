#!/bin/bash
# 懒猫微服启动脚本

set -e

echo "🚀 启动 Quote0-MCP 服务..."

# 安装依赖（仅在首次运行时）
if [ ! -f /app/.initialized ]; then
    echo "📦 首次运行，安装依赖..."
    
    # 更新 apt 并安装 Chromium
    apt-get update
    apt-get install -y chromium fonts-liberation curl unzip git
    
    # 安装 Bun
    if [ ! -d /root/.bun ]; then
        echo "🔧 安装 Bun..."
        curl -fsSL https://bun.sh/install | bash
    fi
    
    export PATH="/root/.bun/bin:$PATH"
    
    # 进入应用目录
    cd /app
    
    # 检查是否有代码
    if [ ! -f package.json ]; then
        echo "⚠️ 警告: 未找到代码，请将代码上传到 /lzcapp/var/app"
        echo "等待代码上传..."
        sleep 30
        exit 1
    fi
    
    # 安装依赖
    echo "📦 安装项目依赖..."
    bun install
    
    # 创建必要目录
    mkdir -p processed-images/widgets/news
    
    # 标记已初始化
    touch /app/.initialized
    echo "✅ 初始化完成"
fi

export PATH="/root/.bun/bin:$PATH"
cd /app

# 等待依赖服务
echo "⏳ 等待数据库连接..."
sleep 10

# 启动服务
echo "🎯 启动 API 服务..."
exec bun src/api/server.ts
