#!/bin/bash
set -e

# 一键全量 E2E 脚本
# 用法：bash scripts/e2e-full.sh

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT_DIR/api"
WEB_DIR="$ROOT_DIR/web"
REPORT_DIR="$ROOT_DIR/e2e-report"

mkdir -p "$REPORT_DIR"

echo "══════════════════════════════════════════════════"
echo "  HRM 全场景端到端自动化测试"
echo "══════════════════════════════════════════════════"

# ─────────────────────────────────────────────────
# 1. 启动测试数据库（如果未通过 DATABASE_URL 指定）
# ─────────────────────────────────────────────────
if [ -z "$DATABASE_URL" ]; then
  echo "▶ 未设置 DATABASE_URL，尝试用 docker-compose 启动测试 PG"
  docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.test.yml" up -d postgres-e2e

  # 等待 PG 就绪
  for i in {1..30}; do
    if docker exec hrm-postgres-e2e pg_isready -U postgres -d hrm_e2e >/dev/null 2&1; then
      echo "✓ PostgreSQL 就绪"
      break
    fi
    sleep 1
  done

  export DATABASE_URL="postgresql://postgres:postgres@localhost:15432/hrm_e2e"
fi

# ─────────────────────────────────────────────────
# 2. 层A：后端 API E2E
# ─────────────────────────────────────────────────
echo ""
echo "▶ 层A：后端 API E2E"
cd "$API_DIR"
npm run test:e2e
LAYER_A_EXIT=$?

# 复制报告
cp -f "$API_DIR/test-reports/junit-e2e.xml" "$REPORT_DIR/" 2>/dev/null || true
cp -f "$API_DIR/test-reports/e2e-report.html" "$REPORT_DIR/" 2>/dev/null || true

# ─────────────────────────────────────────────────
# 3. 启动后端供层B 使用
# ─────────────────────────────────────────────────
echo ""
echo "▶ 启动后端 dev server 供层B"
cd "$API_DIR"
npm run start:dev &
API_PID=$!
sleep 5

# 4. 准备 Playwright 测试数据
echo "▶ 准备 Playwright 测试数据"
cd "$API_DIR"
npx ts-node prisma/seed-e2e-playwright.ts

# ─────────────────────────────────────────────────
# 5. 层B：前端 Playwright
# ─────────────────────────────────────────────────
echo ""
echo "▶ 层B：前端 Playwright"
cd "$WEB_DIR"
npx playwright install chromium
npx playwright test
LAYER_B_EXIT=$?

# 复制报告
cp -rf "$WEB_DIR/playwright-report" "$REPORT_DIR/" 2>/dev/null || true

# ─────────────────────────────────────────────────
# 6. 聚合报告
# ─────────────────────────────────────────────────
echo ""
echo "▶ 生成 PM 汇总报告"
cd "$API_DIR"
npx ts-node --project tsconfig.json ../scripts/e2e-summary.ts

# ─────────────────────────────────────────────────
# 7. 清理
# ─────────────────────────────────────────────────
echo ""
echo "▶ 停止后端 dev server"
kill $API_PID 2>/dev/null || true

# 如果是脚本启动的 PG，则停止
if [ -z "${DATABASE_URL_BEFORE:-}" ] && [ -z "${KEEP_DB:-}" ]; then
  docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.test.yml" down 2>/dev/null || true
fi

# ─────────────────────────────────────────────────
# 8. 输出结果
# ─────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
if [ $LAYER_A_EXIT -eq 0 ]; then
  echo "  层A：通过"
else
  echo "  层A：失败（exit $LAYER_A_EXIT）"
fi

if [ $LAYER_B_EXIT -eq 0 ]; then
  echo "  层B：通过"
else
  echo "  层B：失败（exit $LAYER_B_EXIT）"
fi
echo "  报告目录：$REPORT_DIR"
echo "══════════════════════════════════════════════════"

exit $((LAYER_A_EXIT + LAYER_B_EXIT))
