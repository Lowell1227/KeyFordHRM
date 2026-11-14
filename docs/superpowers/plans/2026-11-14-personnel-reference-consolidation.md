# 人事基础资料统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展现有基础资料，统一人员表单来源，并与既有人员一致性修缮共同交付隔离预览。
**Architecture:** 复用 PersonnelReferenceData、现有权限/审计与选择器；只增加八类资料及增量迁移，不新建平行字典系统。正式数据只读核对，历史快照不重写。
**Tech Stack:** NestJS、Prisma/PostgreSQL、Vue 3/Element Plus、Jest、Playwright。
**Spec:** `docs/superpowers/specs/2026-11-14-personnel-reference-consolidation-design.md`

## Global Constraints

- 保留已有未提交 F/N 修缮，不暂存提交、不上线、不改正式员工。
- 预览固定 http://localhost:5173，真实隔离后端，虚构数据、关闭外部副作用。
- 字典候选不等于正式更正授权；未知公司/职系不猜测，敏感误填不输出原值。

## Review Focus

- 新增类目的权限和后端校验不能只靠前端菜单。
- 老值/停用值保留与新选值有效性分开；自动草稿不阻塞。
- 下拉框切换类目/保存时的迟到响应不能改错类目。
- 导入不能把未维护值绕过统一来源；预览需明确问题且确认重验。
- 字典停用/改名不得静默改写员工或冻结的绩效/任职历史。

### T1 后端目录与校验

Files: `api/prisma/schema.prisma`、新增仅枚举增量迁移、`api/src/personnel-reference-data/*`、人员提交/入职/导入相关服务及测试。
Interfaces: 原 /personnel-reference-data/:kind API；八类新增 kind 见 Spec；共用校验接受当前值以保护历史。
- [x] 添加新增类型、权限、非法名称、历史保留和新值禁用的失败用例。
- [x] 扩展枚举与迁移、权限 allowlist、集中约束与业务调用；不自动 seed 正式库。
- [x] 相关测试与构建；共享调用进入最终全量和隔离集成。

### T2 前端统一入口与表单

Files: `web/src/api/personnel-reference-data.api.ts`、新增类目元数据、`BasicDataView.vue`、`PersonnelReferenceManageView.vue`、`PersonnelReferenceSelect.vue`、人员抽屉/编辑表单及针对测试。
Interfaces: 类目元数据统一提供 label、管理 tab 和手工填写策略，复用现有 API；服务器 fieldErrors 就近展示。
- [x] 针对新增类目、老值保留、停用选项、管理入口与并发类目保护先补失败用例。
- [x] 将适用字段接入共用选择器，保留银行/合同名称手填；不增加新的一级菜单。
- [x] 类型检查/构建、针对真实 PC/手机预览验证。

### T3 待办与正式数据核对清单

Files: 既有人员验收记录；只在任务所需模块修复可复现 O01；本机受限报告目录。
- [x] 复核既有 F/N 证据，仅重验受本轮影响部分；O01 留存复现/结果，根因未明仍作为风险，不宣称修复。
- [x] 正式库 READ ONLY 提取安全候选和待确认归属，不输出敏感异常原值，不执行清洗。
- [x] 隔离数据库迁移与 API 全量、关键关联真实集成，记录失败与修正而非掩盖。
- [x] 更新合并验收记录和固定预览链接；待用户验收及另外授权发布。
- [ ] 用户预览验收与正式资料映射确认。
- [ ] 用户另行明确授权后执行生产发布或正式数据更正。
