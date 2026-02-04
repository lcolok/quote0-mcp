#!/bin/bash
#
# 数据迁移脚本：将 Docker 卷数据迁移到绑定挂载目录
# 用法: ./scripts/migrate-data-to-bind-mount.sh
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 数据目录
DATA_DIR="/Volumes/Mac Mini M4 Plus APFS/DockerOrigData/quote0-mcp"
BACKUP_DIR="$DATA_DIR/backup"

# 创建备份目录
mkdir -p "$BACKUP_DIR"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Quote0-MCP 数据迁移工具${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "目标数据目录: $DATA_DIR"
echo "备份目录: $BACKUP_DIR"
echo ""

# 检查 Docker 容器状态
echo -e "${YELLOW}步骤 1: 检查容器状态...${NC}"
if docker ps | grep -q "quote0-"; then
    echo -e "${YELLOW}⚠️  检测到 Quote0 容器正在运行${NC}"
    echo "需要先停止容器以确保数据一致性"
    read -p "是否停止容器? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "停止容器中..."
        docker-compose down
        echo -e "${GREEN}✓ 容器已停止${NC}"
    else
        echo -e "${RED}✗ 迁移取消${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ 容器已停止${NC}"
fi

echo ""

# 备份现有数据
echo -e "${YELLOW}步骤 2: 备份现有 Docker 卷数据...${NC}"

# 备份 PostgreSQL
if docker volume ls | grep -q "quote0-mcp_postgres_data"; then
    echo "备份 PostgreSQL 数据..."
    docker run --rm \
        -v quote0-mcp_postgres_data:/source:ro \
        -v "$BACKUP_DIR":/backup \
        alpine:latest \
        tar czf "/backup/postgres_backup_$(date +%Y%m%d_%H%M%S).tar.gz" -C /source .
    echo -e "${GREEN}✓ PostgreSQL 备份完成${NC}"
else
    echo -e "${YELLOW}⚠️  PostgreSQL 卷不存在，跳过${NC}"
fi

# 备份 MinIO
if docker volume ls | grep -q "quote0-mcp_minio_data"; then
    echo "备份 MinIO 数据..."
    docker run --rm \
        -v quote0-mcp_minio_data:/source:ro \
        -v "$BACKUP_DIR":/backup \
        alpine:latest \
        tar czf "/backup/minio_backup_$(date +%Y%m%d_%H%M%S).tar.gz" -C /source .
    echo -e "${GREEN}✓ MinIO 备份完成${NC}"
else
    echo -e "${YELLOW}⚠️  MinIO 卷不存在，跳过${NC}"
fi

# 备份 Redis
if docker volume ls | grep -q "quote0-mcp_redis_data"; then
    echo "备份 Redis 数据..."
    docker run --rm \
        -v quote0-mcp_redis_data:/source:ro \
        -v "$BACKUP_DIR":/backup \
        alpine:latest \
        tar czf "/backup/redis_backup_$(date +%Y%m%d_%H%M%S).tar.gz" -C /source .
    echo -e "${GREEN}✓ Redis 备份完成${NC}"
else
    echo -e "${YELLOW}⚠️  Redis 卷不存在，跳过${NC}"
fi

echo ""
echo -e "${GREEN}✓ 所有备份已保存到: $BACKUP_DIR${NC}"
echo ""

# 恢复数据到绑定挂载目录
echo -e "${YELLOW}步骤 3: 恢复数据到绑定挂载目录...${NC}"

# 恢复 PostgreSQL
if [ -f "$BACKUP_DIR"/postgres_backup_*.tar.gz ]; then
    echo "恢复 PostgreSQL 数据..."
    LATEST_POSTGRES=$(ls -t "$BACKUP_DIR"/postgres_backup_*.tar.gz | head -1)
    docker run --rm \
        -v "$DATA_DIR/postgres":/target \
        -v "$LATEST_POSTGRES":/backup.tar.gz:ro \
        alpine:latest \
        sh -c "rm -rf /target/* && tar xzf /backup.tar.gz -C /target"
    echo -e "${GREEN}✓ PostgreSQL 数据已恢复到: $DATA_DIR/postgres${NC}"
fi

# 恢复 MinIO
if [ -f "$BACKUP_DIR"/minio_backup_*.tar.gz ]; then
    echo "恢复 MinIO 数据..."
    LATEST_MINIO=$(ls -t "$BACKUP_DIR"/minio_backup_*.tar.gz | head -1)
    docker run --rm \
        -v "$DATA_DIR/minio":/target \
        -v "$LATEST_MINIO":/backup.tar.gz:ro \
        alpine:latest \
        sh -c "rm -rf /target/* && tar xzf /backup.tar.gz -C /target"
    echo -e "${GREEN}✓ MinIO 数据已恢复到: $DATA_DIR/minio${NC}"
fi

# 恢复 Redis
if [ -f "$BACKUP_DIR"/redis_backup_*.tar.gz ]; then
    echo "恢复 Redis 数据..."
    LATEST_REDIS=$(ls -t "$BACKUP_DIR"/redis_backup_*.tar.gz | head -1)
    docker run --rm \
        -v "$DATA_DIR/redis":/target \
        -v "$LATEST_REDIS":/backup.tar.gz:ro \
        alpine:latest \
        sh -c "rm -rf /target/* && tar xzf /backup.tar.gz -C /target"
    echo -e "${GREEN}✓ Redis 数据已恢复到: $DATA_DIR/redis${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  数据迁移完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "数据目录结构:"
echo "  $DATA_DIR/postgres  - PostgreSQL 数据"
echo "  $DATA_DIR/minio     - MinIO 对象存储数据"
echo "  $DATA_DIR/redis     - Redis 缓存数据"
echo "  $DATA_DIR/backup    - 备份文件"
echo ""
echo "下一步操作:"
echo "  1. 使用新配置启动服务: docker-compose up -d"
echo "  2. 检查服务状态: docker-compose ps"
echo "  3. 验证数据完整性"
echo ""
echo "如需回滚，备份文件位于: $BACKUP_DIR"
