#!/bin/bash
# 生产部署（构建 → 迁移 → 滚动重启 → 健康检查）
# 使用方式：./deploy/scripts/deploy.sh

set -e

echo "===== 孚德绩效系统 生产部署 ====="
echo "[1/5] 拉取最新代码..."
git pull origin main

echo "[2/5] 构建镜像..."
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  build --no-cache api web

echo "[3/5] 运行数据库迁移..."
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  run --rm api sh -c "npx prisma migrate deploy"

echo "[4/5] 滚动重启服务..."
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d --no-deps api web

echo "[5/5] 健康检查..."
sleep 5
HEALTH=$(curl -sf http://localhost/api/v1/health || echo "FAILED")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "✅ 部署成功！API 健康检查通过"
else
  echo "❌ 健康检查失败，请查看日志："
  docker compose logs --tail=50 api
  exit 1
fi

echo "===== 部署完成 ====="
docker compose ps
