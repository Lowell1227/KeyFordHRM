# 绩效待办表单统一布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让四类高频绩效待办表单使用同一页面骨架、辅助信息位置和业务术语。

**Architecture:** 扩展现有 `PerformanceFormWorkspace`，通过具名插槽承载左侧主表单、右侧辅助信息和跨列底部操作区。业务页面保留原有数据请求和事件，仅迁移布局；主管目标审核新增专用辅助信息面板，复用已有参考目标和操作记录组件。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-02-performance-task-form-layout-design.md`

## Global Constraints

- 不改 API、权限、任务状态、路由键和数据库枚举。
- 用户可见术语统一使用设计文档中的名称。
- 桌面双栏、小于 1100px 单栏、手机辅助信息可折叠。
- 修改直接落在当前领先 `main`，发布时只替换 Web。

---

### Task 1: 共享表单骨架

**Files:**
- Modify: `web/src/views/task/components/PerformanceFormWorkspace.vue`
- Test: `web/e2e/specs/28-monthly-review-responsive.spec.ts`

**Interfaces:**
- Consumes: `main`、`reference` 具名插槽和现有 `showReference` 属性。
- Produces: 统一双栏布局、`actions` 具名插槽和一致的辅助信息标题。

- [ ] **Step 1:** 在月度跟进响应式测试中断言主表单、右栏和底部操作区的桌面位置及窄屏顺序。
- [ ] **Step 2:** 运行对应 Playwright 用例，确认因缺少统一操作区而失败。
- [ ] **Step 3:** 为 `PerformanceFormWorkspace` 增加跨列 `actions` 插槽并统一响应式样式。
- [ ] **Step 4:** 将员工月度跟进和主管评分的操作栏迁入 `actions` 插槽，运行用例至通过。

### Task 2: 主管目标审核辅助信息

**Files:**
- Create: `web/src/views/task/components/GoalReviewSupportPanel.vue`
- Modify: `web/src/views/task/components/GoalReviewWorkspace.vue`
- Test: `web/e2e/specs/10-team-performance-contract.spec.ts`

**Interfaces:**
- Consumes: `cycleId`、`employeeId`、指标数组和流程记录。
- Produces: “参考目标 / 操作记录”双页签辅助面板。

- [ ] **Step 1:** 修改目标审核契约，断言右栏在主表单右侧、操作记录不在主内容底部。
- [ ] **Step 2:** 运行用例，确认因当前操作记录位置错误而失败。
- [ ] **Step 3:** 创建辅助面板并让 `GoalReviewWorkspace` 使用共享骨架；审核操作迁入 `actions` 插槽。
- [ ] **Step 4:** 运行目标审核契约至通过。

### Task 3: 员工目标制定与统一术语

**Files:**
- Modify: `web/src/views/task/TaskDetailView.vue`
- Modify: `web/src/views/task/components/IndicatorSnapshot.vue`
- Modify: `web/src/views/task/components/PerformanceReferencePanel.vue`
- Modify: `web/src/views/task/components/EmployeePeriodReviewWorkspace.vue`
- Modify: `web/src/views/task/components/ManagerPeriodReviewWorkspace.vue`
- Test: `web/e2e/specs/29-goal-setting-responsive.spec.ts`
- Test: `web/e2e/specs/28-monthly-review-responsive.spec.ts`

**Interfaces:**
- Consumes: 现有参考信息、操作记录、保存与提交事件。
- Produces: 员工目标制定右栏和统一的月度跟进/操作记录术语。

- [ ] **Step 1:** 修改目标制定测试，断言桌面右栏可见且旧参考信息抽屉不存在。
- [ ] **Step 2:** 运行测试，确认现有抽屉布局导致失败。
- [ ] **Step 3:** 启用共享右栏、去除重复抽屉和重复操作记录，并统一用户可见文案。
- [ ] **Step 4:** 运行目标制定和月度跟进用例至通过。

### Task 4: 回归与 Web-only 发布

**Files:**
- Test: `web/e2e/specs/10-team-performance-contract.spec.ts`
- Test: `web/e2e/specs/28-monthly-review-responsive.spec.ts`
- Test: `web/e2e/specs/29-goal-setting-responsive.spec.ts`

**Interfaces:**
- Consumes: 完成后的 Web 构建产物。
- Produces: 已提交、已推送、可回滚且外网已验证的 Web 版本。

- [ ] **Step 1:** 运行三组相关 Playwright 契约、Vue 类型检查、生产构建和 `git diff --check`。
- [ ] **Step 2:** 提交并推送当前领先 `main`，不包含用户现有的无关修改。
- [ ] **Step 3:** 为线上 Web 镜像创建回滚标签，构建并冒烟候选镜像。
- [ ] **Step 4:** 使用正式 `.env`、两份 Compose 文件和 `kayford-deploy` 项目名仅替换 Web。
- [ ] **Step 5:** 验证线上版本、外网首页、健康接口、目标页面静态产物及其余容器 ID 未变化。
