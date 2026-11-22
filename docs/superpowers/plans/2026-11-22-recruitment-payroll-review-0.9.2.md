# 招聘与薪酬独立评审及 0.9.2 收口计划

> **For agentic workers:** use superpowers:executing-plans for local changes. Independent reviewers are read-only and do not share write ownership.

**Goal:** 评审今天招聘和薪酬增量，核实缺陷、最小修复，并将源码产品版本统一为 0.9.2。

**Architecture:** 保持现有模块化单体和独立薪酬权限。不修改生产配置、真实业务数据、工资规则或正式权限。当前工作区可复用，其他工作区的未提交内容保留。

**Tech Stack:** NestJS、Prisma、PostgreSQL、Vue 3、Element Plus、Jest、Playwright。

**Spec:** AGENTS.md；docs/requirements/2026-11-22-payroll-requirements.md；今天的 REC、人才删除和薪酬首批验收记录。

## 约束与评审重点

- 基线 HEAD / origin/main 为 d66f9407，生产 API/Web 为 caec3862，生产薪酬关闭；这些是本轮开始时现场核验值。
- 招聘评审从 8aede43e 起检查今天增量及关联服务；薪酬检查整个新域。只报告具体可复现的问题，不把待确认正式规则变成默认值。
- 招聘跟进/录用/入职准确关联、移除参与者通知、部分删除失败及二次确认不得绕过既定规则。
- 薪酬检查主体隔离、未提交草稿、独立审批、来源变化、防重、结算和工资文件边界；纯算法另行检查自然月、覆盖、金额与绩效来源。
- 所有验证使用虚构数据，关闭外部通知/日程；不运行生产写入、不调用付费 AI。
- 本次用户明确要求评审及版本更新，没有再次授权生产发布。固定预览交付后另等发布指令。

## 执行清单

- [x] 核验工作区、远端 main、生产镜像和项目规范，确认当前工作区干净。
- [x] 启动招聘、薪酬交易权限、核算数据三位独立只读评审，主集成检查页面及版本。
- [x] 统一 README、AGENTS、前后端 package/lockfile、SystemOverviewView 版本为 0.9.2；关联测试不固定旧版本。
- [x] 复核专家每个发现的调用链和前置，列清缺陷、继承风险和业务待定项；缺陷先补直接回归用例再最小修改。
- [x] 按实际风险集中验证一次：版本/展示走 Web 检查与 PC/手机页面；若触及授权/核算/审批则严格档 API 全量、构建及必要真实隔离集成。
- [x] 出具评审结论及九项处置表，记录固定预览入口、未验证边界与实现/提交/上线/业务验收状态。最终金融出口另补真实双连接PG先红后绿，不对未变更范围机械重跑全量。

## 文件边界

版本只改七处权威声明和相应系统概览测试，旧发布记录保留历史版本。缺陷文件按核实后的处置表补充，不做无关重构。最终评审记录放在 docs/acceptance/2026-11-22-recruitment-payroll-review-0.9.2.md。
