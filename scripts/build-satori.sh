#!/bin/bash

# Satori 优化版构建脚本
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 构建 Satori 优化版镜像${NC}"

# 1. 构建优化版基础镜像
echo -e "${YELLOW}📦 步骤 1/3: 构建基础镜像...${NC}"
docker build -t dev.logic.heiyu.space/library/node:22-slim-bun-satori -f Dockerfile.base.satori .

# 2. 推送基础镜像到 registry
echo -e "${YELLOW}📤 步骤 2/3: 推送基础镜像...${NC}"
docker push dev.logic.heiyu.space/library/node:22-slim-bun-satori

# 3. 构建应用镜像
echo -e "${YELLOW}📦 步骤 3/3: 构建应用镜像...${NC}"
docker build -t dev.logic.heiyu.space/friday/quote0-mcp-api:v1.0.3-satori -f Dockerfile.api.satori .

echo -e "${GREEN}✅ 构建完成！${NC}"
echo -e "${YELLOW}镜像大小:${NC}"
docker images | grep -E "quote0-mcp-api|node:22-slim-bun"

echo -e "${YELLOW}推送到 LC03:${NC}"
echo "docker push dev.logic.heiyu.space/friday/quote0-mcp-api:v1.0.3-satori"
echo ""
echo -e "${YELLOW}在 LC03 上部署:${NC}"
echo "lcctl remote docker pull dev.logic.heiyu.space/friday/quote0-mcp-api:v1.0.3-satori"
echo "./scripts/start-news-api.sh v1.0.3-satori"