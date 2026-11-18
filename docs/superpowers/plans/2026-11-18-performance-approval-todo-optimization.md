# Performance Approval and To-do Entry Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工作台、绩效待办、目标变更待办准确汇集当前由我办理的事项，并使审批详情、意见和记录清晰一致。

**Architecture:** 保留 NestJS/Prisma 的业务流程与任务快照，补齐 API 的审批权限和数据遮蔽；从后端动作权限派生待办与详情操作，Vue 入口共用业务标识和受控路由。页面采用「当前待办—关键依据—展开详情和记录—固定操作」的布局。分批独立提交和验证，不将纯布局工作与权限/数据修复混成一个不可审查的发布。

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue 3, Element Plus, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-performance-approval-todo-optimization-design.md`

## Global Constraints

- 实施前重查 `AGENTS.md`、`docs/project-memory.md`、当前工作区、`main`、`origin/main`、生产 API/Web 和已有未提交工作；本计划不是上线授权。
- 已启动任务继续使用冻结的绩效上级、部门负责人和分管领导。保留现行目标计划链路：员工填写 → 绩效上级 → 部门负责人 → 员工确认 → 分管领导；同人合并及本人审核跳过规则不变。结果评估的现有节点不因本方案改写。
- 目标变更授权仍由 HR 管理；快捷入口、通知和菜单不授予审批权限。任何新委托、转交、撤销后在办事项处置政策均暂不实现。
- 不修改生产业务数据，不抹掉历史办理/审计记录。退回意见和草稿的可见范围按角色控制；员工不得提前看到上级草稿。
- 按风险分层验证：权限、共享审批和 API 契约走严格档；页面层级走 Web 快速档；性能需隔离数据库中有足够历史量。真实角色 PC/手机预览与上线后的业务验收分别记录。

## Review Focus

- 先核实审查项在实施基线仍存在；如果已被并行提交修复，标记证据，不再重复改。
- A1/A2/A3/E1–E4 是优先收敛点。R4 是潜在历史数据边界，查明后再定修复范围；U4 为可用性收尾。
- 每批提交只暂存本批文件，做 `git diff --cached --check` 和清单核对。涉及迁移先准备备份与可回退方案；用户明确授权上线后才发布相关 API/Web。

---

### Task 1: 审批权限、隐私和周期退回契约

**Files:**
- Modify: `api/src/final-grade/final-grade.service.ts`, `api/src/final-grade/final-grade.service.spec.ts`
- Modify: `api/src/period-reviews/period-reviews.service.ts`, `api/src/period-reviews/period-reviews.service.spec.ts`
- Modify: `api/src/cycles/dto/review-cycle.dto.ts`, `api/src/cycles/cycles.service.ts` and related cycle review tests
- Inspect/modify if confirmed: `api/src/tasks/team-tasks.service.ts` and tests

**Interfaces:** 终评提交只认任务指定办理人；员工读取月评时只见已提交的上级评价；周期计划退回必须有非空理由，审核历史可返回结论/时间/意见。

- [ ] Step 1: 在最新代码重放 A1/A2/A3/R4 的权限负向用例，固定现状和预期，覆盖兼任经理、HR、管理员、历史自任任务。
- [ ] Step 2: 修正 API 鉴权、字段遮蔽和退回 DTO 校验；保留审计与冻结任务关系，不改现有评分。
- [ ] Step 3: 跑相关 Jest、API build、共享审批全量 API 测试；用隔离真实数据库核验事务和角色拒绝，记录任何既有失败。
- [ ] Step 4: 核对 API 响应是否足够支撑 UI 的「当前节点、下一步、退回原因、审核历史」；只补必要字段。

### Task 2: 待办聚合、通知直达与首页阶段

**Files:**
- Modify: `web/src/views/dashboard/DashboardTaskEntries.vue`, `web/src/views/task/task-stage.ts`
- Modify: `web/src/components/layout/notification-target.ts` and notification tests
- Modify: `web/src/views/goal-changes/GoalChangeListView.vue`, `web/src/api/goal-changes.api.ts`
- Inspect/modify: `api/src/goal-changes/goal-changes.service.ts`, goal-change tests, notification producers and DingTalk to-do mapping
- Add/modify focused E2E: `web/e2e/specs/42-dashboard-multi-cycle.spec.ts`, `web/e2e/specs/68-goal-changes.spec.ts` and relevant notification specs

**Interfaces:** 待办源返回「当前 actor 可执行的业务动作、业务 ID、目标路径/状态、员工、周期」，前端按同一口径计数；深链仍由详情 API 再鉴权。

- [ ] Step 1: 固定四个缺陷的失败用例：变更/改进通知无跳转、本人兼经理目标通知跳错、未完成目标时提示进展、代发起上级收到退回后找不到变更。
- [ ] Step 2: 梳理工作台、绩效待办、目标变更、HR 授权页和钉钉待办的现有动作来源；为同一业务 ID 定义唯一当前办理者口径和去重规则。
- [ ] Step 3: 补目标变更「待我处理」及工作台快捷入口，覆盖待修改、待提交和待审核；已处理/只读只进相关记录。目标变更授权入口保持 HR 独立页。
- [ ] Step 4: 修受控通知路由和个人/团队判断；目标生效后才提示目标进展。过期通知展示明确状态，不产生过期操作。
- [ ] Step 5: 跑相关 API/Jest、Web type-check、PC/390px Playwright 与真实角色预览；核对三处待办数量、条目、跳转和后端实际权限一致。

### Task 3: 审批详情布局、动作表单与办理记录

**Files:**
- Modify: `web/src/views/admin/CycleManageView.vue`, `web/src/views/admin/components/CycleWorkspaceShell.vue`, `CycleCompactTable.vue`
- Modify: `web/src/views/approval/ApprovalView.vue`, `web/src/views/calibration/CalibrationView.vue`
- Modify: `web/src/views/task/components/DepartmentReviewWorkspace.vue`, `GoalReviewWorkspace.vue`
- Modify: `web/src/views/goal-changes/GoalChangeDetailView.vue`, `GoalChangeGoals.vue`, `goal-change-labels.ts`
- Reuse/modify if necessary: `web/src/components/common/PerformanceResultEvidence.vue`, shared history components and focused E2E

**Interfaces:** 不改原审批状态流；当前待办、关键依据、可展开证据和倒序记录按统一顺序呈现。详情操作与列表权限一致。

- [ ] Step 1: 为周期计划退回、部门复核、校准、结果审批、目标变更建立 PC/手机页面基线；记录首屏信息、长表单/抽屉滚动和真实操作位。
- [ ] Step 2: 先改高频办理页：可办列表移到图表前，详情/抽屉固定操作区；校准配额等决策约束留在首屏。按钮按当前节点命名，未授权只读。
- [ ] Step 3: 周期计划支持「通过 / 退回」及必填退回原因；详情显示结论、时间、意见，确认弹窗移走无关公司负责人说明。
- [ ] Step 4: 统一记录为「节点、办理人、动作、时间、意见」倒序；员工确认写「员工确认」；目标变更先显示变更摘要和有变化指标，未变内容可展开。
- [ ] Step 5: 退回输入改原位多行表单和字段错误；网络失败保留文本、弹窗和滚动位置，成功后才清空。检查列表与详情都能完成同一动作。
- [ ] Step 6: 跑 Web type-check/生产构建、覆盖上述页面的 Playwright；PC 与 390px 核验固定底栏、长意见、横向溢出、焦点和读屏标签。

### Task 4: 读取失败、竞态、导航及列表规模

**Files:**
- Modify: `web/src/views/admin/CycleManageView.vue`, `web/src/views/approval/ApprovalView.vue`, `web/src/views/calibration/CalibrationView.vue`, `web/src/views/task/TaskListView.vue`, `web/src/views/task/FinalGradeView.vue`
- Modify: `web/src/views/goal-changes/GoalChangeListView.vue`
- Modify: `api/src/goal-changes/goal-changes.service.ts`, controller/DTO and tests; `web/src/api/goal-changes.api.ts`

**Interfaces:** 失败态与空态分开；按请求序号防止旧响应覆盖新筛选；后端分页在服务端权限过滤后返回 `items/total`，列表不再拉取所有历史。

- [ ] Step 1: 写失败/慢响应用例，验证列表读失败、退回失败、创建后跳转失败和快速切换周期；测目标变更查询的行数、查询次数与响应时间基线。
- [ ] Step 2: 为每个失败态加贴近内容的错误与重试，不把旧数据/空数据当作成功；详情导航失败时留下可恢复入口。
- [ ] Step 3: 目标变更列表改服务端分页与批量加载；保持原授权范围、状态过滤、排序和总数。前端同步分页参数和筛选。
- [ ] Step 4: 跑相关 API/Jest、API build、Web type-check、PC/手机 Playwright 和隔离库有历史量的查询验证；保存性能前后数据。

### Task 5: 可用性收尾与分层交付

**Files:**
- Modify as confirmed: `web/src/views/task/FinalGradeView.vue`, `web/src/views/task/components/GoalReviewSupportPanel.vue`, `web/src/views/admin/components/CycleCompactTable.vue` and relevant tests
- Add: focused acceptance record under `docs/acceptance/` after execution

- [ ] Step 1: 实测终评等级、目标复核侧栏、周期卡片的键盘/读屏行为；仅修复确认的问题。
- [ ] Step 2: 按角色逐条走「工作台待办 → 详情 → 审批/退回 → 记录」及通知/钉钉直达，覆盖员工、兼任经理、绩效上级、部门负责人、分管领导、HR、管理员；PC 和 390px 各验一次。
- [ ] Step 3: 记录代码实现、提交、隔离预览、生产发布和真人业务验收五个独立状态。发布前检查生产基线、备份/迁移、回退镜像；仅在用户明确授权上线后发布受影响服务并做外网冒烟。

## Out of Scope / Decision Queue

- 改进计划暂停态的 HR 处置、目标变更授权撤销后在办申请如何处理、审批委托/转交都涉及新业务权力，本次先保留为待决策项。
- 不因为同一人的多个身份而自动合并非连续环节；现有冻结流程、本人跳过和同人连续合并规则继续有效。
- 不用菜单和通知的前端隐藏代替 API 鉴权，不把绩效审批人加入考核范围。
