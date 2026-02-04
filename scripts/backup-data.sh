#!/bin/bash
#
# 日常数据备份脚本
# 建议添加到 crontab 定时执行
# 例如: 0 2 * * * /path/to/backup-data.sh
#

set -e

# 数据目录
DATA_DIR="/Volumes/Mac Mini M4 Plus APFS/DockerOrigData/quote0-mcp"
BACKUP_DIR="$DATA_DIR/backup"
DATE=$(date +%Y%m%d_%H%M%S)

# 保留最近 N 天的备份
KEEP_DAYS=7

# 创建备份目录
mkdir -p "$BACKUP_DIR"

echo "========================================"
echo "  Quote0-MCP 数据备份"
echo "  时间: $(date)"
echo "========================================"
echo ""

# 备份 PostgreSQL
echo "[1/3] 备份 PostgreSQL 数据库..."
if docker ps | grep -q "quote0-postgres"; then
    docker exec quote0-postgres pg_dump \
        -U quote0_user \
        -d quote0_cache \
        --clean \
        --if-exists \
        > "$BACKUP_DIR/postgres_dump_$DATE.sql"
    echo "✓ PostgreSQL 备份完成: postgres_dump_$DATE.sql"
else
    echo "⚠️  PostgreSQL 容器未运行，跳过数据库备份"
fi

# 备份 MinIO 数据
echo ""
echo "[2/3] 备份 MinIO 数据..."
if [ -d "$DATA_DIR/minio" ]; then
    tar czf "$BACKUP_DIR/minio_data_$DATE.tar.gz" -C "$DATA_DIR/minio" .
    echo "✓ MinIO 备份完成: minio_data_$DATE.tar.gz"
else
    echo "⚠️  MinIO 数据目录不存在"
fi

# 备份 Redis 数据
echo ""
echo "[3/3] 备份 Redis 数据..."
if docker ps | grep -q "quote0-redis"; then
    # 触发 BGSAVE
    docker exec quote0-redis redis-cli BGSAVE
    # 等待保存完成
    sleep 2
    # 复制 dump.rdb
    docker cp quote0-redis:/data/dump.rdb "$BACKUP_DIR/redis_dump_$DATE.rdb"
    echo "✓ Redis 备份完成: redis_dump_$DATE.rdb"
else
    echo "⚠️  Redis 容器未运行，跳过备份"
fi

# 清理旧备份
echo ""
echo "清理 $KEEP_DAYS 天前的旧备份..."
find "$BACKUP_DIR" -name "postgres_dump_*.sql" -mtime +$KEEP_DAYS -delete
find "$BACKUP_DIR" -name "minio_data_*.tar.gz" -mtime +$KEEP_DAYS -delete
find "$BACKUP_DIR" -name "redis_dump_*.rdb" -mtime +$KEEP_DAYS -delete
echo "✓ 旧备份清理完成"

echo ""
echo "========================================"
echo "  备份完成！"
echo "  备份目录: $BACKUP_DIR"
echo "  当前备份文件:"
ls -lh "$BACKUP_DIR" | grep "$DATE" || echo "  (无)"
echo "========================================"
