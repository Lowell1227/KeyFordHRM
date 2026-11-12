# 员工档案查询、导出、详情与编辑完善

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Implement and verify each bounded task.

**Goal:** 落实已采纳的五项反馈，修复本次审查中已复现的查询、详情和保存不一致。
**Architecture:** 沿用 Vue 页面、NestJS 档案服务及审核机制；导出使用字段白名单，合同使用共享展示函数，草稿保留版本控制。
**Tech Stack:** Vue 3 / Element Plus / TypeScript / NestJS / Jest / Playwright。
**Spec:** ../specs/2026-11-12-roster-contract-feedback-design.md

## 约束
- 不修改真实员工数据、权限规则或数据库结构；用户补充文案调整后已明确授权将本轮修复提交、推送并上线。
- 只修改本任务文件，保留其他任务的未提交工作。
- 请求失败保留输入并提供明确重试；无变更不创建审核。
- 司龄与合同展示仅描述现有正式数据，不自动修补日期或历史。

## 验证重点
- 已保存草稿改回正式原值后，重新打开不能恢复旧修改。
- 明确清空与省略字段分别表示清空和保留。
- 退回申请续编保留原申请身份与版本。
- 迟到的列表或详情响应不能覆盖当前用户选择。
- 导出筛选与已查询结果一致，选列不扩大权限和敏感数据范围。

## 任务
- [x] API 导出：扩展 users DTO/service/excel 白名单选列及审计，增加统一司龄计算与边界测试；先验证缺失行为，再实现。
- [x] 档案编辑：修复空草稿回退、nullable 清空、旧手机号回填、history.canResume；真实服务内存测试先失败再通过。
- [x] 合同展示：共享标题与最新排序，转签主体复用目录，审核和详情一致；折叠不改变保存集合。
- [x] 查询和详情：已应用筛选快照、请求代次、失败反馈、导出选列弹窗、当前任职 null 语义、钉钉操作响应保护。
- [x] 定向 Playwright 使用全部 mock API，覆盖 PC / 平板 / 手机、导出字段、查询并发、错误重试、合同历史与详情。
- [x] 执行 API 全量单测和构建、Web 类型检查/构建及直接覆盖问题的 Playwright；复核 diff 与剩余风险。
- [x] 区分实现、测试、提交、上线、业务验收状态，交付本地改动及验证记录。

## 当前交付状态

本地实现和专项验证完成，用户已授权发布，生产发布结果将记录在 [验收记录](../../acceptance/2026-11-12-employee-archive-quality.md)。没有修改正式数据或数据库结构。真实 HR 操作和生产业务验收尚未执行。
