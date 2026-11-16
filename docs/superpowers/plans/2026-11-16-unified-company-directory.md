# 公司目录统一实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Track verification evidence separately from release.

**Goal:** 公司无需维护旧映射即可在员工档案、入离职和合同中选用，展示及导出口径统一。

**Architecture:** 复用 ContractSubject ID 和名称快照；旧任职组织码可空且仅兼容历史。部门权限维度不迁移。

**Tech Stack:** NestJS / Prisma / PostgreSQL / Vue 3 / Element Plus / Jest / Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-unified-company-directory-design.md`

## Global Constraints

- 不改生产数据、角色、部门范围或冻结绩效任务；不自动按名称映射。
- 保留历史快照、草稿并发和原入离职流程；旧接口代码仍需校验合法性。
- 独立工作树实施；不覆盖另一个审计批次，不提交或发布。

## Review Focus

- 旧草稿不含主体字段时不能清空已有公司；同值保存不制造变更。
- 新建及再入职没有旧代码时完整生效，不能到审核/到岗才报错。
- 已停用公司保留与新选分开；改名不刷新既有名称快照。
- 老导出字段与选择缓存兼容，不能出现两个公司列或500。
- 缺失公司信息不从部门/默认值冒充员工公司，也不改变HR范围。

## Task 1: API 公司引用与历史兼容

**Files:** `api/prisma/schema.prisma`、新迁移、`api/src/contract-subjects/*`、`api/src/employee-archives/*`及其DTO/测试。
**Interfaces:** 公司选择使用 `contractSubjectId` + `companyText`；`company`可空但历史合法码原样保留；标准化/验证仍沿用既有函数。

- [x] 先写/修改用例，证明未映射启用公司被旧逻辑拒绝。
- [x] 解除旧公司码必填，移除映射校验与写入；新公司引用由服务器验证、快照。
- [x] 修复新建、再入职、申请重放、到岗生效及无变更判断中的旧码默认/必填；旧组织建树仅显式有效旧码可用。
- [x] 跑相关 Jest、Prisma generate 和 API build；记录证据，不提交。

## Task 2: 公司目录和各表单

**Files:** `ContractSubjectManageView.vue`、`ContractSubjectSelect.vue`、`EmployeeCompanySelect.vue`、公司/API类型、四类员工抽屉、`UserManageView.vue`、`onboarding-validation.ts`及用例。
**Interfaces:** 不再生成 `internalCompany` 或要求旧 `company`；主体ID必需处仍按既有新建要求校验，历史空值兼容。

- [x] 改直接覆盖的选择/提交用例，先证明未映射公司无法选用。
- [x] 移除映射栏、选项禁用和映射错误提示；统一业务名称，公司和合同独立选用。
- [x] 检查草稿保存/恢复、任职历史与审核差异展示；Web type-check/build和直接覆盖的Playwright。

## Task 3: 导出与集成验证

**Files:** `api/src/users/roster-export-catalog.ts`、`roster-export-data.ts`、相关测试和前端导出选择兼容。

同时覆盖转正申请/详情公司显示，读取正式任职的公司快照；授权仍使用既有部门范围。

- [x] 测试旧 `organization` 字段映射到 `companyText`、去重，字段目录不再出现重复分类。
- [x] 保留公司快照优先、旧数据只读兜底；不从部门推断公司。
- [x] 运行 API 全量、最终 Web 检查、隔离数据库迁移/生命周期集成；独立代码复核。
- [ ] 与主工作区审计批次对齐后提供固定真实预览；当前未获发布授权。

验证与交付状态见 `docs/acceptance/2026-11-16-unified-company-directory.md`。固定预览中有另一批待验收改动，合入方式等待用户答复。
