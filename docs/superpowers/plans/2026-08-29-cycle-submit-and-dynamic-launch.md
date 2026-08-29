# 绩效周期提交复核与动态发起实施计划

> **For agentic workers:** Execute this plan task by task with focused verification after each behavior change.

**Goal:** 让绩效周期创建/编辑只在“下一步”触发复核判断，并把详情页发起流程简化为“开始发起 / 预约发起”两个常驻操作，点击后自动检查、通过后最终确认。

**Architecture:** 保留现有 Cycle API、审核状态机和 launch preflight 语义，只调整 Vue 页面编排与工作区操作呈现。`CycleManageView.vue` 继续负责表单快照、API 调用和确认框；`CycleWorkspaceShell.vue` 只负责展示两个业务操作及检查结果。所有写入继续复用现有 create/update/preflight/launch/schedule 接口。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Playwright、Vite、Docker Compose。

**Spec:** 本会话已确认的绩效周期创建/编辑和发起流程；不改变后端审核状态机、权限或接口语义。

## Global Constraints

- 直接在 `main` 修改，保留工作区内非本任务改动。
- 已审核周期的任一业务字段变化都需重新审核；无变化时保留审核状态。
- 创建流程“下一步”完成校验并进入待审核详情；编辑流程只在确需重新审核时弹确认。
- 月度模式只显示月度时间行；整周期模式只显示“整个周期”行，两者不能同时出现。
- 普通 HR 在开放时间前点击“开始发起”时只给出预约引导；系统管理员可填写原因提前发起。
- “开始发起”和“预约发起”均先调用 preflight；检查不通过只展示阻断项；检查通过后保留最终确认。
- Web-only 发布必须留存回滚镜像，只替换 Web 容器并核对 API、PostgreSQL、Redis、MinIO 容器未变化。

### Task 1: 锁定周期表单提交复核交互

**Files:**
- Modify: `web/e2e/specs/25-cycle-scoring-plan.spec.ts`
- Modify: `web/src/views/admin/CycleManageView.vue`

1. 先把原“页面常驻重新审核提示”用例改为以下行为断言：修改后页面无常驻提示；点击“下一步”出现“重新提交周期审核”确认；取消不发 update；确认后 update 并进入详情。
2. 添加非评分字段（周期名称或员工通知）变化也触发相同确认的覆盖，确保“全部业务字段”不是只覆盖评分频率。
3. 运行聚焦用例并确认在旧实现上因缺少提交时确认而失败。
4. 在 `handleCreate` 完成表单和计划校验后、写请求前，以 `reviewResetRequired` 为条件显示确认框；移除模板里的常驻 warning。
5. 更新创建/编辑成功文案，使“下一步”体现已提交审核、草稿按钮仍体现保存草稿；不新增后端接口。
6. 重跑聚焦用例直至通过，并确认未修改时仍不发 update、直接进入详情。

### Task 2: 锁定详情页两个动态发起操作

**Files:**
- Modify: `web/e2e/specs/14-cycle-management-compact.spec.ts`
- Modify: `web/e2e/specs/25-cycle-scoring-plan.spec.ts`
- Modify: `web/src/views/admin/components/CycleWorkspaceShell.vue`
- Modify: `web/src/views/admin/CycleManageView.vue`

1. 将旧的“开始发起检查”用例改为始终可见“开始发起”和“预约发起”，并断言不再出现独立检查按钮。
2. 添加开始发起阻断分支：只调用 preflight，展示阻断项，不调用 launch。
3. 添加开始发起成功分支：preflight 通过后出现包含参与人数和不可撤销说明的最终确认，确认后调用 launch。
4. 添加预约发起成功分支：preflight 通过后出现包含预约时间和参与人数的最终确认，确认后调用 schedule。
5. 添加普通 HR 提前点击开始发起的引导分支，以及系统管理员填写原因后提前发起的分支。
6. 运行聚焦用例并确认旧实现因仍存在独立检查按钮、缺少自动 preflight/最终确认而失败。
7. 让 `handleLaunch` / `handleSchedule` 在每次操作开始时调用统一的 preflight helper；保留检查结果供页面展示。
8. 在 `CycleWorkspaceShell.vue` 中常驻两个按钮，按钮 loading 只作用于当前操作；阻断项和检查摘要按需显示。
9. 重跑聚焦用例直至通过，并验证 390px 视口无横向滚动、底部操作不遮挡内容。

### Task 3: 聚焦回归与另一会话结果验证

**Files:**
- Verify: `web/e2e/specs/14-cycle-management-compact.spec.ts`
- Verify: `web/e2e/specs/25-cycle-scoring-plan.spec.ts`
- Verify: `web/e2e/specs/29-goal-setting-responsive.spec.ts`
- Verify: `web/src/views/performance/**`

1. 执行三个聚焦 Playwright 文件，使用 `PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA=0` 隔离验收数据准备。
2. 执行 `npm run type-check`。
3. 执行 `npm run build`。
4. 核对另一会话提交 `d96c277` 的完整/简洁模式入口、按钮文案和权限开关覆盖仍通过。
5. 检查 `git diff --check` 和最终差异，不覆盖无关改动。

### Task 4: 提交、Web-only 上线与生产验收

**Files:**
- Modify: `docs/superpowers/plans/2026-08-29-cycle-submit-and-dynamic-launch.md`
- Deploy: production Web image/container only

1. 将已验证改动提交到本地 `main`，记录提交哈希。
2. 读取线上 Compose 工作目录、配置文件、当前 Web 镜像 ID/摘要和 API、PostgreSQL、Redis、MinIO 容器 ID。
3. 将当前 Web 镜像标记为带时间戳的 rollback tag。
4. 从当前 `main` 构建候选 Web 镜像，独立 smoke 后使用正式 `.env`、`docker-compose.yml` 和 `docker-compose.prod.yml` 只重建 Web。
5. 验证本机与外部首页、`/api/v1/health`、Web 容器 80:80、镜像/修订标签，以及非 Web 容器 ID 未变化。
6. 在真实线上页面验证本轮周期交互，并验证另一会话目标制定优化也已出现。

### Task 5: 推送并核对远端 main

1. 使用非强制 `git push origin main`。
2. `git fetch origin main` 后比较 `HEAD` 与 `origin/main`。
3. 最终汇报修改页面、PC/手机呈现、实际请求、聚焦测试、上线版本、回滚标记和仍需确认的业务规则。
