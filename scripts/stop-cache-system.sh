#!/bin/bash

# Quote0 MCP 容器化缓存系统停止脚本

set -e

echo "🛑 停止 Quote0 MCP 容器化缓存系统..."

# 停止所有容器
docker compose down

echo "🧹 清理容器和网络..."

# 可选：清理所有数据卷（谨慎使用）
if [ "$1" = "--clean" ]; then
    echo "⚠️ 清理所有数据卷..."
    docker compose down -v
    docker volume prune -f
    echo "🗑️ 数据卷已清理"
fi

# 可选：清理镜像（谨慎使用）
if [ "$1" = "--clean-all" ]; then
    echo "⚠️ 清理镜像和构建缓存..."
    docker compose down -v --rmi all
    docker system prune -a -f
    echo "🗑️ 镜像和缓存已清理"
fi

echo "✅ 容器化缓存系统已停止"

# 显示清理信息
echo ""
echo "💡 清理选项:"
echo "  ./scripts/stop-cache-system.sh --clean      # 清理数据卷"
echo "  ./scripts/stop-cache-system.sh --clean-all  # 清理所有镜像和缓存"