# Talent Expert Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 修复独立评审F1～F6，明确U1/U2，完成真实预览复验。
**Architecture:** 保留现有人才/应聘/面试/档案边界；复用身份、审批、乐观版本和现有抽屉。新增应聘请求幂等键，不引入通用工作流或新权限。
**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue3, Element Plus, Jest, Playwright。
**Spec:** `docs/superpowers/specs/2026-11-20-talent-expert-fixes-design.md`。

## Global Constraints

- 不修改生产业务资料、通知/日程和模型调用开关；本轮无发布授权。
- 使用当前codex/talent-feedback-20261120隔离工作区，保持main上的并行人才删除未提交工作。
- 原身份与历史申请来源不改写，权限和档案审核/到岗确认门槛不变。
- 应聘每次招聘可重复同岗位；仅同一创建请求重放去重。
- 版本0.9.1，现有依赖不新增；声明、缓存和私有配置不提交。
- 代理不碰Git索引/提交，主智能体串行整理本轮文件。

## Review Focus

- 匹配应聘被撤回/删除、多个匹配时，不跳到无关动作目标。
- 初次取消后已有有效任职、未决申请、已离职再入职，不能误走身份复用路径。
- 并发同请求、同键改内容/换候选人、响应丢失后的真实重放。
- 反馈刷新时参与人/阶段已变化，不绕过权限而假装可保存。
- 表单只加载/未修改、恢复解析结果、保存成功、切换候选人与关闭事件不能误报/丢失。

## T1 页面上下文与表单（代理独占List/Detail/Form/ApplicationPanel，F4面板须等释放）
- [x] 正确行为UI红灯：历史筛选与详情一致、三关闭入口保护、邮箱字段错误。
- [x] F1/F5/F6和U1最小实现，局部测试与类型检查。

## T2 应聘幂等、面试反馈与岗位归属
- [x] F3/F4 API红灯与最小实现；新增唯一requestId迁移，旧行NULL。
- [x] 反馈UI版本刷新；T1释放ApplicationPanel后接请求ID；U2岗位/批次只按既有HR权限展示。
- [x] DTO/服务及Web局部红绿、真实并发PG测试。

## T3 取消首次入职后新应聘闭环
- [x] 先形成实际服务/DB正确结果红灯，明确复用边界。
- [x] 沿原入口新建独立首次入职申请、复用未到岗身份，旧来源不改。
- [x] 原审核/到岗/真实角色UI与拒绝分支覆盖。

## T4 待答复规则及最终集成（主智能体）
- [ ] B1/B2用户答复后补设计及实现；未答复不推断。（未收到答复，本轮保留原行为，不阻塞已确定修复）
- [x] 独立任务审查与全分支审查；统一最终全量API、构建/类型及直接覆盖缺陷的真实UI。
- [x] 更新固定5173，复验1440/1024/390和多角色完整业务链；记录已实现/提交/上线/业务验收。
- [x] 交付预览及限制，不复用上一轮上线授权。
