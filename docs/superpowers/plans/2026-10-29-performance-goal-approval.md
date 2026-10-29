# 目标计划五步审批 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已确认五步链办理目标计划，提供HR绩效专员全过程只读，并将规则与计划绑定。

**Architecture:** 复用现有NestJS任务状态机和Vue任务入口，新增独立目标流程版本、两个目标状态及终审标记。目标读取使用专用投影，保持结果评估和通用数据权限不变。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Vue3/Element Plus、Jest、Playwright；无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-29-performance-goal-approval-design.md`

## Global Constraints

- 新目标链：员工 → 绩效上级 → 部门负责人 → 员工确认 → 分管领导；终审前不得激活基线。
- 连续同人合并并留痕、跳过本人审核；部门/分管退回绩效上级，重走后续；结果链保持。
- 旧计划流程版本和冻结关系不变；不改 `workflowVersion` 与 `planVersion` 原义。
- HR专员组合能力识别，目标全员只读；不得扩大结果或档案范围，不新增代审权。
- 只用隔离测试数据；无生产发布或生产任务创建。

## Review Focus

- 员工确认后时间开放：月度、自评、目标进展均不能绕过分管终审。
- 同人连续审核和跨员工确认的非连续同人：前者合并、后者必须再审核。
- HR专员跨部门查看：只返回目标字段，评分/自评/校准内容不得泄漏。
- 新旧流程与评分版本交叉：旧预约哈希、旧任务和期末结果保持。
- 退回后并发终审或旧页面操作：不能沿用已失效的员工确认。

## Task 1: 数据契约、计划版本与后续业务闸门

**Files:** `api/prisma/schema.prisma`、新迁移；`api/src/cycles/*`、`api/src/scheduler/*`、`api/src/period-reviews/*`、`api/src/objectives/*`、相关业务待办状态投影。

**Interfaces:** 周期字段 `goalWorkflowVersion: number` 默认1、新建2；任务 `goalApprovedAt: Date|null`；状态和节点取Spec的确切名称。消费Task2的纯函数 `hasApprovedGoalBaseline(task, goalWorkflowVersion?)`。

- [ ] 先补新计划版本绑定、旧预约哈希、终审前禁止月度/进展的失败用例，运行确认红灯。
- [ ] 增加迁移、创建时绑定版本、发起快照、相关查询中的版本字段及终审闸门；不改评分版本判断。
- [ ] 生成Prisma客户端，运行相关 `launch/scheduler/period-reviews/goal-tracking` 测试，确认通过。
- [ ] 迁移在隔离库中验证，补全新旧目标版本与评分版本交叉回归。

## Task 2: 五步目标状态机、单条和批量审核

**Files:** `api/src/tasks/goal-workflow.ts`（纯规则）、`api/src/tasks/tasks.service.ts`、`team-tasks.service.ts`、`flow.service.ts`、相关controller/DTO/module及测试。

**Interfaces:** 导出 `usesFiveStepGoalWorkflow(version?:number|null):boolean`、`hasApprovedGoalBaseline(task:{indicatorConfirmedAt?:Date|null;goalApprovedAt?:Date|null;cycle?:{goalWorkflowVersion?:number|null}|null}, version?:number|null):boolean`。新增 `POST /tasks/:id/indicators/approve`（当前冻结审核人，通过动作，携带expectedUpdatedAt）；沿用现有目标退回和批量接口，按阶段办理。

- [ ] 编写新链、同人/本人、退回、HR不能代审、并发、旧链兼容的失败用例并确认红灯。
- [ ] 实现两新增目标节点，保留员工确认但推迟V1激活至分管终审；部门/分管仅审批不改内容。
- [ ] 单条和批量使用一致的冻结处理人及阶段规则，清除被退回的下游确认，补通知/当前处理人和周期阶段同步。
- [ ] 运行 `tasks/team-tasks/flow/indicator-version` 相关测试及结果流程回归。

## Task 3: HR目标计划只读资源

**Files:** `api/src/goal-plans/*`（DTO/controller/service/module/tests）、`api/src/app.module.ts`。

**Interfaces:** `GET /goal-plans?scope=mine|review|monitor&cycleId&deptId&employeeName&status`；`GET /goal-plans/:id`。列表为分页目标摘要，详情只含目标与目标审批记录；不含结果、月度评分或HR校准内容。`monitor` 仅绩效专员组合能力、HR管理员、系统管理员可用。

- [ ] 先写跨部门专员读取、普通HR拒绝、结果字段不泄漏、只读身份无写权的失败用例。
- [ ] 实现独立读取投影及范围，不改共享DataScope；我的计划按本人，待我审核按当前阶段冻结审核人。
- [ ] 返回 `goalWorkflowVersion`、当前节点、办理人和只读标志；以Schema选取字段避免事后删减遗漏。
- [ ] 运行目标只读权限测试，并为集成测试准备一致的合成角色fixture。

## Task 4: 统一目标入口、阶段动作与响应式体验

**Files:** `web/src/types/*`、`web/src/api/*`、任务列表/详情/审核组件、工作台待办、周期进度标签，相关Playwright用例。

**Interfaces:** 消费Task1/2字段和Task3资源；沿用 `/tasks` 与 `/tasks/:id` 组件，目标模式使用专用读取，结果模式继续原API。

- [ ] 先补PC/手机角色用例：五步按钮和状态、确认后待终审、无直属下属的领导待办、专员只读且无评分正文。
- [ ] 同步状态文案、流程图、当前办理人、待办入口和目标进度；只给当前业务审核人显示动作。
- [ ] 复用目标内容/参考/历史组件和现有业务列表原语；不复制第二份目标维护页。
- [ ] 运行Web类型检查、生产构建及针对性Playwright，验证1440×900、1024×768、390×844。

## Task 5: 整合、隔离角色验收与收尾

- [ ] 对Spec逐项检查，补真实API+隔离PostgreSQL的完整五步及结果回归、权限与版本交叉验证。
- [ ] API全量测试和构建，Web针对性检查；如有失败明确记录并修复本任务引起的问题。
- [ ] 独立代码审查，修复阻塞问题；仅提交本任务文件，核对暂存清单和差异。
- [ ] 明确报告实现/测试/提交状态；生产仍保持原版本，待用户明确上线后再发布。
