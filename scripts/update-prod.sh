#!/usr/bin/env bash
# ============================================================
# 一键更新 prod 栈到仓库当前代码（数据保留）
# ------------------------------------------------------------
# 用法（在 Git Bash 里，仓库根目录执行）：
#     bash scripts/update-prod.sh
#
# 前提：
#   - 最新代码已在本仓库（Codex 改完工作区即可；若已配 git 远程，会自动 git pull）。
#   - prod 栈与开发栈共用本仓库目录，靠「项目名」隔离：
#       prod = kayford-deploy（本脚本）   dev = hrm（docker-compose.dev.yml）
#   - 项目名固定为 kayford-deploy，确保复用现有数据卷，更新不丢数据。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."          # 切到仓库根目录

# 若已配置 git 远程，拉取最新；没有远程就用当前工作区代码（构建读的是磁盘文件，不依赖提交）
if git remote | grep -q .; then
  echo "▶ 拉取最新代码 (git pull)..."
  git pull --ff-only
else
  echo "▶ 无 git 远程，使用当前工作区代码。"
fi

echo "▶ 构建并更新 prod 栈（项目名 kayford-deploy，复用数据卷）..."
docker compose -p kayford-deploy \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --build

echo "▶ 等待启动（约 15s）..."
sleep 15

echo "▶ 健康检查："
if curl -s -m 8 http://localhost/api/v1/health | grep -q '"status":"ok"'; then
  echo "  ✓ 健康检查通过"
else
  echo "  ✗ 健康检查未通过，请看日志： docker compose -p kayford-deploy logs -f api"
  exit 1
fi

echo "✓ 更新完成。本机 http://localhost ，同事走花生壳外网地址。"
