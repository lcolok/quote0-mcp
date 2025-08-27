#!/bin/bash

# Quote0 MCP 容器化缓存系统启动脚本

set -e

echo "🐳 启动 Quote0 MCP 容器化缓存系统..."

# 检查Docker和Docker Compose是否可用
if ! command -v docker &> /dev/null; then
    echo "❌ Docker未安装，请先安装Docker"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose未安装，请先安装Docker Compose"
    exit 1
fi

# 确保环境变量文件存在
if [ ! -f .env.docker ]; then
    echo "⚠️ 未找到.env.docker文件，请先配置环境变量"
    exit 1
fi

# 复制环境变量文件
cp .env.docker .env

echo "📁 环境变量已加载"

# 创建必要的目录
mkdir -p docker/postgres/init
mkdir -p processed-images/widgets

echo "📂 目录结构已创建"

# 启动服务
echo "🚀 启动容器化服务..."

# 仅启动基础设施服务（不启动应用容器）
docker compose up -d postgres minio redis

echo "⏳ 等待服务启动..."

# 等待PostgreSQL启动
echo "🐘 等待PostgreSQL启动..."
sleep 10

# 检查PostgreSQL连接
max_attempts=30
attempt=1
while [ $attempt -le $max_attempts ]; do
    if docker compose exec postgres pg_isready -U quote0_user -d quote0_cache > /dev/null 2>&1; then
        echo "✅ PostgreSQL已就绪"
        break
    fi
    echo "⏳ PostgreSQL启动中... (尝试 $attempt/$max_attempts)"
    sleep 2
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "❌ PostgreSQL启动失败"
    exit 1
fi

# 等待MinIO启动
echo "📦 等待MinIO启动..."
sleep 5

max_attempts=30
attempt=1
while [ $attempt -le $max_attempts ]; do
    if curl -f http://localhost:9000/minio/health/live > /dev/null 2>&1; then
        echo "✅ MinIO已就绪"
        break
    fi
    echo "⏳ MinIO启动中... (尝试 $attempt/$max_attempts)"
    sleep 2
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "❌ MinIO启动失败"
    exit 1
fi

# 检查Redis连接
echo "🔴 检查Redis连接..."
if docker compose exec redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis已就绪"
else
    echo "❌ Redis连接失败"
    exit 1
fi

echo ""
echo "🔧 执行数据库初始化检查..."

# 执行数据库初始化脚本（幂等操作）
echo "📋 运行数据库初始化脚本..."
if docker compose exec postgres psql -U quote0_user -d quote0_cache -f /docker-entrypoint-initdb.d/01-init-database.sql > /dev/null 2>&1; then
    echo "✅ 数据库初始化完成"
else
    echo "⚠️ 数据库初始化脚本执行可能有问题，但系统会自动处理"
fi

# 验证表是否存在
echo "🔍 验证数据库表结构..."
table_count=$(docker compose exec postgres psql -U quote0_user -d quote0_cache -t -c "
    SELECT COUNT(*) FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN (
        'news_cache', 'processing_tasks', 'rss_snapshots', 'image_cache', 'cache_stats'
    );
" 2>/dev/null | tr -d ' ')

if [ "$table_count" = "5" ]; then
    echo "✅ 数据库表结构完整 (5/5)"
else
    echo "⚠️ 数据库表结构不完整 ($table_count/5)，应用程序将自动创建缺失的表"
fi

echo ""
echo "🎉 容器化缓存系统启动成功！"
echo ""
echo "📋 服务状态:"
echo "  🐘 PostgreSQL: http://localhost:5432"
echo "  📦 MinIO API: http://localhost:9000"
echo "  🖥️  MinIO Console: http://localhost:9001"
echo "  🔴 Redis: localhost:6379"
echo ""
echo "🔑 MinIO登录信息:"
echo "  用户名: quote0_minio"
echo "  密码: quote0_minio_password"
echo ""
echo "💡 使用以下命令测试系统:"
echo "  bun widget news technology 0 ax-optimized"
echo ""
echo "🛑 停止服务:"
echo "  docker compose down"
echo ""
echo "📊 查看日志:"
echo "  docker compose logs -f [postgres|minio|redis]"