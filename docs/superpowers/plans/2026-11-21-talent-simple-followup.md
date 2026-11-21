# Talent Simple Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 明确当前跟进安排、完成/取消和负责范围，保持历史与招聘流程独立。
**Architecture:** 现有FollowUp追加计划状态；共享应聘筛选谓词；现有时间线与紧凑选择框，不新建平行模块。
**Tech Stack:** Nest/Prisma/PostgreSQL、Vue/Element Plus、Jest/Playwright。
**Spec:** docs/superpowers/specs/2026-11-21-talent-simple-followup-design.md。

## Global Constraints

- 版本0.9.1、现有依赖与权限保持。
- 只用虚构隔离库，不改生产或通知/日程/模型配置。
- 未提交声明及其他工作树保持。
- 固定预览原授权解析开关保留，不执行解析。
- 列表、详情应聘目标、Excel使用同条应聘筛选；历史沟通不改写。
- 代理不暂存/提交，根串行提交；不推送、不上线。

## Review Focus

- 两个HR先后改安排，旧页完成不能结束新安排。
- 补录旧沟通及取消后，旧计划不得复活；未来仍可待跟进。
- 应聘负责人/岗位/阶段分在不同应聘时不能错误匹配或导出。
- 迁移每人才仅保留原显示的一条pending，无原文/日期改写。
- 保存失败/409保留输入，取消按钮不生成假的沟通记录。

## T1 后端与迁移（独占API）

Files: schema.prisma、新迁移、talent-follow-ups.service、DTO/controller、talents.service、talent-application-filter及对应单元/PG测试。
Interfaces: 严格按spec的planStatus/expectedPlanId/completePlanId/cancel路由/responsibilityScope。
- [x] 正确行为红灯：完成/补录/取消、并发、同条负责人岗位阶段与导出。
- [x] 迁移及最小事务实现，沿既有审计和权限。
- [x] 相关API与真实PG迁移检查，报告源码冻结；最终全API由根统一运行。

## T2 前端与真实交互（独占Web）

Files: talent.types.ts、talent-pool.api.ts、TalentFollowUpTimeline.vue、TalentListView.vue、TalentDetailDrawer.vue、TalentApplicationPanel.vue及相关e2e。
Consumes: spec明确契约；可向T1核对，不改API源。
- [x] 正向UI红灯后实现当前安排+完成/补充/取消、三范围、匹配目标、简洁对象标签。
- [x] 409/失败保留输入，刷新不擅自覆盖；PC/手机可操作。
- [x] Web局部/类型/构建；根更新真实预览后验证三尺寸、多经办、筛选和Excel。

## T3 集成与交付（根）

- [x] 核对T1/T2共享契约和状态边界，集中最终全量API/构建。
- [ ] 一次统一更新5173，真实PG/UI，独立审查与必要修复。
- [ ] 精确本地提交、记录技术/业务/生产状态，交付固定预览。
