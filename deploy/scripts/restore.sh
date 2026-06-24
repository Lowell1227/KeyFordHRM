#!/bin/sh
# 使用方式：./restore.sh kayford_perf_20260614_030000.sql.gz

set -e

BACKUP_FILE=$1
if [ -z "${BACKUP_FILE}" ]; then
  echo "用法：./restore.sh <备份文件名>"
  exit 1
fi

echo "⚠️  警告：此操作将覆盖现有数据库 ${POSTGRES_DB}"
echo "按 Ctrl+C 取消，或按 Enter 继续..."
read _

echo "[$(date)] 开始恢复..."

# 终止现有连接
PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  -h "${POSTGRES_HOST}" -U "${POSTGRES_USER}" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB}' AND pid <> pg_backend_pid();"

# 重建数据库
PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  -h "${POSTGRES_HOST}" -U "${POSTGRES_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB}; CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};"

# 还原
gunzip -c "${BACKUP_FILE}" | PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  -h "${POSTGRES_HOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

echo "[$(date)] 恢复完成 ✓"
