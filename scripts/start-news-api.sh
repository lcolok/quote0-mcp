#!/bin/bash

# Quote0 News API 启动脚本
# 使用方法: ./scripts/start-news-api.sh [image_tag]
# 示例: ./scripts/start-news-api.sh v1.0.3

set -e

# 默认镜像标签
IMAGE_TAG=${1:-v1.0.3}
IMAGE_NAME="dev.logic.heiyu.space/friday/quote0-mcp-api:${IMAGE_TAG}"
CONTAINER_NAME="mefridayquote0-mcp-news-api-1"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 启动 Quote0 News API${NC}"
echo -e "${YELLOW}镜像: ${IMAGE_NAME}${NC}"
echo -e "${YELLOW}容器: ${CONTAINER_NAME}${NC}"

# 检查 .env 文件
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env 文件不存在${NC}"
    exit 1
fi

# 读取 .env 文件中的配置
echo -e "${GREEN}📖 读取 .env 配置...${NC}"

# 从 .env 文件加载环境变量
set -a
source .env
set +a

# 停止并删除现有容器
echo -e "${YELLOW}🛑 停止现有容器...${NC}"
lcctl remote docker stop ${CONTAINER_NAME} 2>/dev/null || true
lcctl remote docker rm ${CONTAINER_NAME} 2>/dev/null || true

# 启动新容器
echo -e "${GREEN}🚀 启动新容器...${NC}"
lcctl remote docker run -d \
  --name ${CONTAINER_NAME} \
  --network host \
  -e NODE_ENV=production \
  -e PORT=3001 \
  -e HOST=0.0.0.0 \
  -e DATABASE_URL="${DATABASE_URL}" \
  -e POSTGRES_HOST="${POSTGRES_HOST}" \
  -e POSTGRES_PORT="${POSTGRES_PORT}" \
  -e POSTGRES_DB="${POSTGRES_DB}" \
  -e POSTGRES_USER="${POSTGRES_USER}" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -e MINIO_ENDPOINT="${MINIO_ENDPOINT}" \
  -e MINIO_PORT="${MINIO_PORT}" \
  -e MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
  -e MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
  -e MINIO_BUCKET="${MINIO_BUCKET}" \
  -e MINIO_USE_SSL="${MINIO_USE_SSL}" \
  -e REDIS_URL="${REDIS_URL}" \
  -e REDIS_HOST="${REDIS_HOST}" \
  -e REDIS_PORT="${REDIS_PORT}" \
  -e LLM_PROVIDER="${LLM_PROVIDER}" \
  -e LLM_BASE_URL="${LLM_BASE_URL}" \
  -e LLM_API_KEY="${LLM_API_KEY}" \
  -e LLM_MODEL="${LLM_MODEL}" \
  -e LLM_FAST_MODEL="${LLM_FAST_MODEL}" \
  -e LLM_MAX_TOKENS="${LLM_MAX_TOKENS}" \
  -e LLM_TEMPERATURE="${LLM_TEMPERATURE}" \
  -e MINDRESET_DEVICE_ID="${MINDRESET_DEVICE_ID}" \
  -e MINDRESET_DEVICE_SECRET="${MINDRESET_DEVICE_SECRET}" \
  -e TZ=Asia/Shanghai \
  -e PUPPETEER_SKIP_DOWNLOAD=true \
  -v /lzcsys/run/app/me.friday.quote0-mcp/.env:/app/.env \
  -v /lzcsys/run/app/me.friday.quote0-mcp/processed-images:/app/processed-images \
  --restart unless-stopped \
  ${IMAGE_NAME}

# 等待容器启动
echo -e "${YELLOW}⏳ 等待容器启动...${NC}"
sleep 10

# 检查容器状态
echo -e "${GREEN}📊 检查容器状态...${NC}"
lcctl remote docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}"

# 检查健康状态
echo -e "${GREEN}🏥 检查健康状态...${NC}"
sleep 20
lcctl remote docker logs ${CONTAINER_NAME} --tail 20

echo -e "${GREEN}✅ 启动完成！${NC}"
echo -e "${YELLOW}查看日志: lcctl remote docker logs ${CONTAINER_NAME} -f${NC}"
echo -e "${YELLOW}健康检查: lcctl remote docker exec ${CONTAINER_NAME} curl -s localhost:3001/api/health${NC}"