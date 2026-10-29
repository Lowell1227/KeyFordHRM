# Contract Subject Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 为合同主体提供 HR 维护入口，并让任职与合同记录通过稳定 ID 共用主体目录。

**Architecture:** 增量增加合同主体表与两个可空外键，沿用原名称字段保存快照。复用现有员工草稿、资料审核、任职生效和审计，不更改组织公司枚举、部门或数据范围。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Vue 3、Element Plus、现有业务列表组件、Jest、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-29-contract-subject-maintenance-design.md`（用户已确认）。

## Global Constraints

- 按用户同日补充授权，主体维护复用 `employee_archive_edit`：`hr`、`system_admin` 及获该能力的 `hr_user` 可写；仅审核能力的普通 HR 只读，员工及无能力用户不可读。
- 历史名称保留；缺失主体字段是未修改，显式 null 是清空；旧草稿不能清空当前关联。
- 不自动回填主体、不生成法律名称、不更改组织归属、审批关系或冻结绩效数据；不发布、不写生产数据。
- 仅本任务文件可暂存；保留四个原有未提交文件。main 已安全快进至 `9d132b8`，原有修改已恢复并有 patch/stash 备份。
- 不加依赖、不改产品版本；名称 150 字、唯一且 trim；不物理删除。

## Review Focus

- 旧草稿缺字段或目录改名时，关联与旧名称快照不丢失、不自动刷新（Task 1/2 测试）。
- 已停用主体可原样保留但不得新选；提交后停用应在审核生效校验中明确失败（Task 1/2）。
- 只关联相同名称的新 ID 仍形成真实审核差异；防止伪造快照及越权写目录（Task 1/2）。
- 再入职、生效、补任职记录不能漏存或错误继承主体（Task 2/3）。
- 空目录、接口失败、长名称、小屏和刷新目录不能丢当前表单（Task 3）。

### Task 1: 主体目录与稳定数据关联（API）

**Files:** `api/prisma/schema.prisma`、新增 migration；`api/src/contract-subjects/`、`api/src/app.module.ts`。

**Interfaces:**
- `ContractSubject { id: UUID, name: string, isActive: boolean, createdAt, updatedAt }`。
- `GET /contract-subjects?includeInactive=true` 返回数组；默认仅启用。`POST {name}`；`PATCH /:id {name?,isActive?}`。写权限复用档案编辑能力，写入与 audit 同事务。
- `EmploymentRecord.contractSubjectId`、`EmployeeContract.contractSubjectId` 为可空外键。名称快照分别沿用 `companyText`、`signingCompany`。
- 内部引用归一化使用 PrismaService/transaction client；新增或变更关联查库校验启用并取名称，同一已有 ID 保留原快照；避免为无主体的旧请求额外要求 mock delegate。

- [x] 先写并运行失败测试：名称校验、防重、权限与增量 schema。
- [x] 实现最小目录与迁移，生成 Prisma client，只使用隔离数据库应用迁移。
- [x] 运行相关 Jest 和 API build；保存红绿证据。

### Task 2: 员工草稿、审核及任职链路（API）

**Files:** `api/src/employee-archives/` 中 archive/onboarding DTO、archives/reviews/onboarding services 和新增定向测试；必要的其他任职记录写入点。

**Interfaces:** 消费 Task 1 外键与归一化契约；员工资料 `employee.contractSubjectId`、合同 `contracts[].contractSubjectId`；再入职 `contractSubjectId?: string|null`。API 返回 ID 与快照名称，不返回额外个人信息。

- [x] 先写失败测试覆盖创建/草稿/修订/审核写入、仅 ID 变化、旧字段缺失保留、显式清空、目录改名/停用、客户端伪造快照。
- [x] 贯通白名单、DTO、base/proposed、并发检查、差异判断、落库和审核时引用校验。新选择在提交冻结名称，审核保留冻结快照。
- [x] 核对所有 employmentRecord/employeeContract 创建点，保证再入职、补任职和生效保留请求中的关联。
- [x] 运行定向 Jest；全量 API Jest 与 build 由主协调者统一执行。

### Task 3: 目录与两类表单（Web）

**Files:** 新增 `web/src/api/contract-subjects.api.ts`、`web/src/views/admin/ContractSubjectManageView.vue`、`web/src/components/common/ContractSubjectSelect.vue`；修改 `web/src/router/routes.ts`、`web/src/api/employee-archives.api.ts`、`web/src/views/admin/components/` 下创建/编辑/任职/再入职和审核/历史展示；新增独立 Playwright spec/config。

**Interfaces:** 消费 Task 1 HTTP 数组接口；选择器 `modelValue?: string|null`、名称快照原文、更新 ID 与名称事件。新关联从服务端目录选择；旧未关联名称保留展示。选择器可刷新主体、可另开维护页且不丢当前表单。

- [x] 读取 business-list-page-standard、record-list 模板和验收清单；用现有公共组件搭建简洁目录。
- [x] 先写失败 Playwright：管理员与有档案编辑能力的普通 HR 维护、仅审核 HR 只读；两处选同目录且草稿恢复；旧文字与停用引用保留；1440/1024/390px。
- [x] 实现目录路由、权限、字段底部校验；新建员工“所属公司（合同主体）”与原“组织归属”明确区分，合同签约公司共用选择器。
- [x] 贯通 API 类型、再入职/任职表单、快照显示、仅 ID 变更显示。不要编辑已有脏 `UserManageView.vue`、`DepartmentCreateDrawer.vue`、`23-employee-data-review.spec.ts`。
- [x] 运行 Playwright、type-check、build，保存截图；针对语义改变更新旧公司文字用例，避免无关用例断言漂移。

### Task 4: 联合验证与独立复核（主协调者）

- [x] 检查 API/Web 契约、只读权限和增量迁移，在隔离 PostgreSQL 执行真实服务持久化与审核测试。
- [x] 执行全量 API Jest、API build、Web type-check/build，联合相关员工/再入职/审核用例；记录真实失败，不伪装全通过。
- [x] 独立审查增量 diff，修复必需问题并针对重验；核对四个原有改动与基线 patch 一致。
- [x] 更新本计划的实施证据；只暂存本任务文件并 diff-check，留在本地 main，不推送或发布。报告实现、提交、上线、真实角色验收分别状态。


## 实施结果（2026-10-29）

API 全量 113 套/1548 项、隔离 HTTP/PostgreSQL 8 项、Web 7 组联合72项及1024×768补验1项通过；前后端构建、Web类型检查通过。独立复核及限定修复复核无剩余阻断项。迁移仅应用于合成隔离库，无生产修改。详细证据见 docs/acceptance/2026-10-29-contract-subject-maintenance.md。

用户随后要求交给 HR 相关人员维护；按 `employee_archive_edit` 复用现有权限，页面和接口同步调整。该轮复验 API 全量 113 套/1550 项、真实 HTTP/隔离数据库 8 项、Web 定向 18 项与前后端构建通过。未新增角色、权限项或修改任何真实人员授权。
