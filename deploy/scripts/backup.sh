#!/bin/sh
# 每日全量备份，保留30天
# 生产服务器 crontab：0 3 * * * docker compose -f ... --profile backup run --rm backup

set -e

BACKUP_DIR=/backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="${BACKUP_DIR}/kayford_perf_${TIMESTAMP}.sql.gz"

echo "[$(date)] 开始备份..."

PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --no-owner \
  --no-acl \
  | gzip > "${FILENAME}"

echo "[$(date)] 备份完成：${FILENAME}（$(du -sh ${FILENAME} | cut -f1)）"

# 清理30天前的备份
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +30 -delete
echo "[$(date)] 已清理30天前的旧备份"

# 列出当前所有备份
echo "[$(date)] 当前备份文件："
ls -lh "${BACKUP_DIR}"/*.sql.gz 2>/dev/null || echo "无备份文件"
