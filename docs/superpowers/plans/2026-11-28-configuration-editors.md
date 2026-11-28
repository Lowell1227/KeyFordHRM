# 配置页与招聘菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐总览配置的实际维护闭环，并按招聘业务流排序菜单。

**Architecture:** 复用现有AI/通知/薪酬授权；新增受控加密的SystemConfig草稿、生效快照及管理员API，运行端统一读取。前端用一个按项目呈现的维护页，现成AI维护不重写。

**Tech Stack:** NestJS、Prisma、PostgreSQL、Vue3、Element Plus；不新增依赖或迁移。

**Spec:** `docs/superpowers/specs/2026-11-28-configuration-editors-design.md`

## Global Constraints

- 产品0.9.3，最新主线隔离开发；生产只读，不配置真实集成或发布。
- API仅管理员，敏感字段加密、不回显、不写审计明文；秘密留空保留旧值。
- 保存、核验、应用分离，乐观版本锁，失效测试不能用于新版本；不自动同步/发送。
- 固定真实后端预览5173，虚构资料，保留其他演练与原工作树改动。

## Review Focus

1. 同AppKey更换Secret后不能复用旧token；一次调用不能混合不同版本的企业身份。
2. 草稿不能改变运行；当前生效版本可重启恢复，坏密文不能静默回退。
3. 已配置且通过的DeepSeek必须可发现，解析与目标助手启用互不误导。
4. 邮箱测试只读指定目录，新范围不能带旧游标或偷偷导入历史。
5. 非管理员/撤权旧令牌/过时版本不能改配置或获得秘密；手机错误输入不丢失。

## Task 1 · 导航（独立任务）

Files: `web/src/router/routes.ts`及直接导航测试。

- [x] 按需求改顺序，保留权限与路由。
- [x] 更新受影响的既有默认入口预期，Node22导航测试35项通过。
- [ ] PC/手机与整体验证由Task4覆盖。

## Task 2 · 后端配置与运行生效

Files: 新增 `api/src/system-configuration/` 服务/DTO/controller/运行读取层/测试；现有 `system-configuration.controller.ts`、AppModule及相应消费者。

Produces: Spec的 `SystemConfigurationView`、GET/PUT/test/apply与公开登录参数。

- [ ] 先写并运行失败测试：加密不回显、保存不生效、版本冲突、管理员资格、未知字段、旧测试失效、恢复与配置回退。
- [ ] 实现草稿和生效存储、核验与快照，复用既有SystemConfig/AES模式。
- [ ] 接入全部对应运行消费者；针对token/邮箱构造缓存/公开登录参数写行为测试。
- [ ] 按用户追加要求实现多邮箱集合、稳定ID、独立scope/lease/cursor/失败恢复及经办选择，不沿用全局primary。
- [ ] 完成模块及相关测试，提供严格全量验证入口；不提交或发布。

## Task 3 · 前端维护页与完整总览

Files: `web/src/api/system-configuration.api.ts`、新增维护视图、configuration-targets/routes、ConfigurationStatusPanel、AiServiceConfigView与LoginView及直接测试。

Consumes: Task2明确的view契约。与导航任务改同文件时仅增加新路由，不覆盖顺序改动。

- [ ] 先写直接覆盖问题的行为测试：全部项目可见/DeepSeek默认不隐藏、目标路由可维护、秘密省略、409保留输入。
- [ ] 新增一个管理员维护页，读取服务端字段，保存/核验/应用动作清楚，错误贴近字段，已有秘密只显示已保存。
- [ ] 所有平台目标连接真实页；AI复用，解析入口标题与开关独立，登录读取公开后端参数。
- [ ] 邮箱管理页列出多个账号，新增/编辑复用字段维护器；收件页明确选择邮箱，并显示可追溯来源。
- [ ] Web类型及相关测试，PC/手机表单和固定操作区可用；不发真实邮件/日程。

## Task 4 · 集成与交付（root）

- [ ] 复核任务边界和前后端契约，独立评审共享配置及权限。
- [ ] 完整API回归/构建，Web类型/构建，真实隔离PG/HTTP和PC/手机直接问题用例。
- [ ] 更新固定5173，保留虚构演练；记录实际通过与第三方剩余边界。
- [ ] 交付预览和待验收项；只有新上线授权后发布。

当前执行授权来自用户“请统一加上”；采用本会话并行实施，不额外让用户选择执行工具。配置与导航之外的招聘体验清单保留为后续待办。
