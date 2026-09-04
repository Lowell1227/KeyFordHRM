# 孚德智能绩效管理系统（Kayford Performance）

杭州孚德品牌管理有限公司内部绩效考核系统（128 人）。Monorepo：NestJS 后端 + Vue3 前端 + Docker。

当前产品版本：**0.8**（前后端包版本 `0.8.0`）。

## 目录结构

```
HRM/
├── api/                # NestJS 10 + Prisma 5 后端
│   ├── prisma/         # schema.prisma + seed.ts + MANUAL_SUPPLEMENTS.sql
│   └── src/            # common(基础设施) / prisma / health / 业务模块
├── web/                # Vue3.4 + Element Plus 前端
├── deploy/             # nginx / postgres init / 运维脚本
├── docker-compose.yml          # 基础（dev/prod 共用）
├── docker-compose.dev.yml      # 开发 override
├── docker-compose.prod.yml     # 生产 override
└── .env.example
```

## 评审决策（覆盖原始设计文档的冲突处）

1. **不做字段级加密**：分数/评语保持明文 `DECIMAL`/`TEXT`，安全靠 TLS + 卷加密 + 行级权限 + AuditLog，保证算分/校准/报表可用。（修正 PRD 10.2）
2. **schema 管理**：Prisma 管表结构；CHECK 约束、触发器、部分/trgm 索引由 `api/prisma/migrations/MANUAL_SUPPLEMENTS.sql` 补充。**已移除** DDL 中语义错误的 `chk_grade_ratio`（四上限之和=1.00）。
3. **审批权与角色解耦**：审批资格只看 `departments.approver_id`；`sys_role` 仅控菜单可见性；李宏（董事长）`can_view_all=true` 表全量只读，审批权另由 approver_id 决定。
4. **逻辑缺陷修正**：豁免计算含离职日期（`users.leave_date`）；加/减分维度直加直减不乘维度权重；`published` 态即可申诉；多模板按 applicableUsers > applicableDepts 匹配 snapshot。

## 快速开始（开发，需 Node 20 + Docker Desktop）

```bash
cp .env.example .env          # 填写各项密钥/密码

# 1) 起基础设施（Postgres + Redis + MinIO）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis minio

# 2) 执行已提交的 baseline 迁移（表 + CHECK + 触发器 + 索引一次性创建）
cd api && npx prisma migrate deploy

# 3) 写入种子数据（系统配置 + 部门结构）
npx prisma db seed
# 可选：SEED_ADMIN_PASSWORD=xxx npx prisma db seed，自动创建 employeeNo=ADMIN 的测试管理员

# 4) 启动前后端（热重载）
cd ..
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d api web

# 前端：http://localhost:5173   API：http://localhost:3000/api/v1/health
```

> 本机若未装 Node/Docker，所有源码已就绪，在装好工具链的机器上执行上述命令即可。

## 迁移到新电脑（无数据）

```bash
# 1) 克隆仓库
git clone <repo> HRM && cd HRM

# 2) 准备环境文件
cp .env.example .env
# 编辑 .env，填写 POSTGRES_PASSWORD、REDIS_PASSWORD、JWT_SECRET 等

# 3) 启动基础设施
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis minio

# 4) 执行数据库迁移（首次会自动创建扩展、表、约束、触发器、索引）
cd api
npx prisma migrate deploy

# 5) 写入种子数据
npx prisma db seed
# 可选：设置 SEED_ADMIN_PASSWORD 环境变量，会自动创建 admin 用户

# 6) 启动后端并验证
cd ..
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d api
curl http://localhost:3000/api/v1/health
# 期望返回 {"status":"ok","db":"ok"}

# 7) 启动前端（开发模式）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d web
# 访问 http://localhost:5173
```

> 生产环境使用 `docker-compose.prod.yml` 替代 `docker-compose.dev.yml`，不暴露 3000/5173 端口。

## 带数据迁移（备份恢复）

若需将生产数据迁移到新机器：

```bash
# 1) 在原机器执行备份
cd HRM
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup run --rm backup
# 备份文件位于 ./deploy/backups/kayford_perf_YYYYMMDD_HHMMSS.sql.gz

# 2) 将备份文件复制到新机器 deploy/backups/ 目录

# 3) 新机器上先起干净 Postgres（不要执行 migrate deploy / seed）
cd HRM
cp .env.example .env
# 填写与原机器一致的数据库名/用户名/密码
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres

# 4) 执行恢复脚本
cd deploy/scripts
./restore.sh kayford_perf_20260614_030000.sql.gz

# 5) 验证数据完整性后启动应用
cd ../..
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d api web
curl http://localhost:3000/api/v1/health
```

> 恢复脚本会 **DROP 并重建** 目标数据库，请确保 `.env` 中的 `POSTGRES_DB` 正确。  
> 恢复后无需再运行 `prisma migrate deploy` 或 `seed`，因为备份已包含完整 schema + 数据。

## 实现进度

## 真实演示数据

尚未上线的本机 Docker `hrm` 环境可按[真实演示数据运行手册](docs/operations/realistic-demo-data.md)执行预览、受控写入、验证、密码轮换与清理。共享验收密码必须在运行时安全提供，不得写入仓库。

- [x] Step 1 monorepo 骨架（api/web 目录、配置、Dockerfile）
- [x] Step 2 Docker compose（postgres/redis/minio/api/web）
- [x] Step 3 Prisma schema（对照 DDL）+ seed + 约束补充 SQL
- [x] 后端基座：统一响应/异常、JWT 守卫、角色守卫、health
- [ ] Step 4 业务模块：auth → users/departments → indicators/templates → cycles → tasks → calibration → approval → publish → appeals → reports → notifications/scheduler
- [ ] 前端：完整路由 + 任务详情 / 校准 / 审批 / 看板 / 报表
```
