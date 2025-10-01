#!/bin/bash

# 新闻质量标注系统 - 快速启动脚本

set -e

echo "🚀 启动新闻质量标注系统..."
echo ""

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker未运行，请先启动Docker Desktop"
    exit 1
fi

# 启动所有服务
echo "📦 启动Docker服务..."
docker-compose up -d postgres redis minio news-api annotation-web

echo ""
echo "⏳ 等待服务就绪..."
sleep 10

# 检查服务健康状态
echo ""
echo "🔍 检查服务状态..."
echo ""

# 检查PostgreSQL
if docker exec quote0-postgres pg_isready -U quote0_user > /dev/null 2>&1; then
    echo "✅ PostgreSQL: 运行中"
else
    echo "❌ PostgreSQL: 未就绪"
fi

# 检查Redis
if docker exec quote0-redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis: 运行中"
else
    echo "❌ Redis: 未就绪"
fi

# 检查MinIO
if docker exec quote0-minio curl -f http://localhost:9000/minio/health/live > /dev/null 2>&1; then
    echo "✅ MinIO: 运行中"
else
    echo "❌ MinIO: 未就绪"
fi

# 检查News API
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✅ News API: 运行中"
else
    echo "⚠️  News API: 正在启动中..."
fi

# 检查Annotation Web
if curl -s http://localhost:3002 > /dev/null 2>&1; then
    echo "✅ Annotation Web: 运行中"
else
    echo "⚠️  Annotation Web: 正在启动中..."
fi

echo ""
echo "✨ 标注系统启动完成！"
echo ""
echo "📱 访问地址:"
echo "  • 标注Web应用: http://localhost:3002"
echo "  • API服务: http://localhost:3001"
echo "  • API文档: http://localhost:3001/api/docs"
echo ""
echo "📖 使用指南:"
echo "  1. 访问 http://localhost:3002/import 导入新闻数据"
echo "  2. 访问 http://localhost:3002/annotate 开始标注"
echo "  3. 访问 http://localhost:3002/export 导出训练样本"
echo ""
echo "📊 查看服务日志:"
echo "  docker-compose logs -f annotation-web"
echo "  docker-compose logs -f news-api"
echo ""
echo "🛑 停止服务:"
echo "  docker-compose stop"
echo ""
