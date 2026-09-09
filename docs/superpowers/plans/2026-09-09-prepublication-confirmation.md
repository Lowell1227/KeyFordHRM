# 公示前确认和 HR 申诉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 让员工在 HR 公示前确认结果，HR 代录线下申诉后走原有重新评定审批链路。

**Architecture:** 沿用任务状态和批准/确认/公示时间，以公示事实隔离结果可见和报表统计；申诉通过 FlowService 和任务锁驱动回退并保留过程。前后端按设计文档接口契约独立实现，集成时统一检查状态。

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue 3, Element Plus, Jest, Playwright。

**Spec:** docs/superpowers/specs/2026-09-09-prepublication-confirmation-design.md

## Global Constraints

- 不新增在线员工申诉入口；HR 发起，直属上级重新评定。
- 不修改生产人员或成绩，不触发测试钉钉通知，无数据库迁移。
- 保护主工作区其他任务的未提交筛选改动；仅在本独立工作区实现，合并时保留最新基线。
- 未公示结果不能进入已公示统计；员工只能提前查看自己的已审批结果且遵守字段可见设置。

## Task 1: API 流转、可见性与申诉（独立 API 实现者）

**Files:** api/src/tasks/{flow.service,tasks.service,review-history}.ts; api/src/appeals/*; api/src/approval/approval.service.ts; api/src/publish/publish.service.ts; api/src/final-grade/final-grade.service.ts; API 中使用 confirmed 作为公示依据的读取及统计入口；相关 spec。

**Interfaces:** 提供设计文档中的申诉候选、申诉元数据、公示状态；沿用 employee-confirm 路由。

- [ ] 编写失败测试并运行：审批已通过但未公示的本人可以确认；未批准拒绝；确认前发布拒绝；HR 申诉返回上级、保留月份、清除旧批准和确认；新申诉拒绝旧 resolve 改判。
  ```ts
  await expect(service.employeeConfirm(task.id, employee)).resolves.toMatchObject({ status: 'confirmed' });
  await expect(publish.publish(cycle.id, { taskIds: [unconfirmed.id] }, hr)).rejects.toThrow();
  ```
- [ ] 实现原子转换：锁任务、校验批准/公示、写流程与审计；申诉记录原结果快照，新的员工确认结束本轮申诉。
- [ ] 实现候选和详情契约，修正员工结果遮罩、本人待办以及发布计数；为审批后待员工确认生成站内待办。
- [ ] 运行相关 API Jest，再运行全量 Jest 和构建；提交仅 API 文件并报告证据。

## Task 2: Web 入口与一致状态（控制者负责 UI 和集成）

**Files:** web/src/{api/appeals.api,types/api.types,composables/usePermission,utils/performance-result-presentation,views/task/task-stage}.ts; web/src/views/{task/TaskDetailView,appeals/AppealsView,publish/PublishView,approval/ApprovalView}.vue; 公共结果摘要和相关 E2E。

**Interfaces:** 消费 Task 1 的兼容字段，申诉候选用专用只读接口。

- [ ] 编写针对性 Playwright：审批后员工可确认且无异议按钮；HR 候选为未公示任务；新申诉显示流程且无改判表单；未确认的公示行不可选择；PC 与 390px。
  ```ts
  await expect(page.getByRole('button', { name: '确认结果', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提出异议', exact: true })).toHaveCount(0);
  ```
- [ ] 实现状态/权限和页面契约；旧申诉按原记录呈现；移除新录入流程的假附件上传（材料在 HR 线下核实，本次文本事由）。
- [ ] 运行 Web 类型检查、生产构建及新旧直接相关 E2E，保存 PC/手机证据。

## Task 3: 集成评审、合并与发布

**Files:** 两服务的最终分支 diff、隔离验证脚本和证据（tmp 下不提交）。

- [ ] 独立评审批准可见范围、申诉回退、确认/公示竞态和跨节点状态，并修正必要问题。
- [ ] 核对主工作区、worktree 和 origin，整合最新筛选基线，仅提交本任务文件。
- [ ] 从目标提交构建 API/Web，保留当前生产镜像；无迁移，保留已有生产数据库。
- [ ] 验证角色流程及外部资源后发布；核验外部健康、两个镜像提交和正式资源内容，报告开发/提交/上线/验收边界。
