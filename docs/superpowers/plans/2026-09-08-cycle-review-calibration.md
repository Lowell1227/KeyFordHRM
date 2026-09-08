# 周期复核与负责人校准实施计划

> For agentic workers: 使用 superpowers:executing-plans 在本任务内按步骤执行，验证后请求独立代码审查。

**Goal:** 同人兼任合并提交并保留两个环节记录，周期负责人在限定周期内处理校准，禁止校准本人结果。
**Architecture:** 复用任务冻结关系、FlowService 事务、现有周期 hrOwnerId 和 HR 校准能力。后端逐接口校验周期范围，前端按后端返回权限展示操作，不修改员工权限档案，不迁移数据库。
**Tech Stack:** NestJS、Prisma、PostgreSQL、Vue 3、Element Plus、Jest、Playwright。
**Spec:** 用户于本任务确认的流程与职责；docs/project-memory.md 第 7 节记录既有规则，本次更新同人办理与负责人范围。

## 全局约束

- 保留月度平均分、独立 ABCD 等级及周期评语；审批、公示独立。
- 按钮保持“提交评定”，职责说明仅出现在提交确认弹窗。
- 不修改历史审核记录或真实员工结果，不发送测试钉钉消息。
- 同人合并仅应用于后续主动提交；本人校准操作一律拒绝，负责人本人的未公示结果不因管理入口泄露。
- 继续在已获授权的 main 上最小修改，确认当前线上基线后发布 API/Web。

## 任务 1：同人合并办理

涉及 final-grade.service.ts / .spec.ts、FinalGradeView.vue、api.types.ts、45-manager-period-context.spec.ts。

- [ ] 先写同人/不同人测试；验证同人路径原先只有一次流转，因此测试失败。
- [ ] 详情返回 `departmentReview: { combined: boolean; reviewerName: string | null }`，依据冻结的 managerId/deptHeadId。
- [ ] 同一事务内先流转 manager_scoring → dept_review，再以更新后版本流转 dept_review → hr_calibration，第二条记录为实际提交人的合并复核，并设置 deptReviewedAt。
```ts
await flow.transitionTx(tx, { task, action: 'submit', targetStatus: 'dept_review', ...submission });
await flow.transitionTx(tx, { task: { ...task, status: 'dept_review' }, action: 'approve', targetStatus: 'hr_calibration', ...combinedReview });
```
- [ ] 弹窗按该元数据显示合并职责或下一复核人，按钮/标题不加提示。

## 任务 2：周期范围与本人边界

涉及 calibration.service.ts / .spec.ts、calibration.controller.ts / module.ts、通知接收人辅助函数、web 校准 API/页面及路由。

- [ ] 测试负责人可以访问自己的周期；仅创建人、无关用户访问失败；所有列表/分布/详情/确认/退回接口均检查身份。
- [ ] 独立 `/calibration/cycles` 返回有权限的活动周期，既有全局校准能力保留；负责人依据 hrOwnerId 获得限定周期范围。
```ts
const allowed = hasHrCapability(viewer, 'performance_calibration') || cycle.hrOwnerId === viewer.id;
if (!allowed) throw new ForbiddenException();
```
- [ ] 本人行仅返回流程信息，不返回分数、等级；本人详情和确认/退回拒绝，分布也排除本人。批量操作包含本人时整批拒绝。
- [ ] 写入事务在任务锁后复核周期负责人，阻止负责人变更后旧请求写入。
- [ ] API 返回 `canCalibrate`、`canViewDetail`、`actionHint`，页面据此控制勾选、详情、确认、退回；切换周期清空旧选择与抽屉。
- [ ] 同人提交涉及周期负责人本人的结果时，通知有校准能力的冻结部门负责人/直属上级，兜底其他有权限 HR，避免通知本人处理。

## 任务 3：验证与发布

- [ ] API 全量 Jest 与 build；Web type-check、角色路由及原问题 Playwright。
- [ ] 独立 PostgreSQL 验证合并提交的事务回滚、双记录、重复提交冲突、负责人确认/退回、自身及其他周期禁止访问。
- [ ] 独立代码审查权限与事务，修复实际问题。
- [ ] 推送 main，备份数据库并保留回滚镜像，从提交构建候选 API/Web，用候选进行只读生产范围核验和隔离 UI 测试。
- [ ] 只替换 API/Web，验证外网资源哈希、健康、迁移与快捷登录关闭；记录上线与尚未执行的真实用户操作验收。

## 实施验证记录（2026-09-08）

- 同人合并、范围校准和弹窗已实现。独立审查发现旧任务/审批概览/报表和催办存在本人结果旁路，已按既有公示前不可见规则一并修复；审批写权限不变。
- API 全量 77 套件 / 925 项通过，API build 与 Web type-check 通过。
- 独立 PostgreSQL 14 项通过：真实事务回滚、并发唯一提交、负责人变更后的旧请求拒绝，以及校准 → 独立审批 → 独立公示。
- Web 主问题与角色导航 29 项、周期选择上下文 5 项通过，包含 PC / 手机布局。审查复核 6 套件 / 47 项通过，无剩余阻断。
- 测试通知使用替身，数据库测试完全隔离。生产验收仅做只读查询；未提交真实员工结果。发布前候选镜像与发布后证据存于 `tmp/qa-cycle-review-scope-20260908/release/`，不能用上述构建/测试代替真实用户业务验收。
