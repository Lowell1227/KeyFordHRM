# 绩效结果四环节展示统一

> 使用 superpowers:subagent-driven-development 分工实施，并使用 verification-before-completion 核验交付。

**目标：**按用户 2026-09-09 确认要求统一部门复核、绩效校准、结果审批、结果公示列表与详情抽屉。

**设计依据：**本轮四张截图及上一轮已讨论的公共字段方案。现有流程不重设计，绩效专员由用户使用系统管理员自行配置。

**技术：**Vue 3、Element Plus、NestJS、Prisma；复用现有查询权限和详情摘要。

## 范围与接口

- 公共字段顺序：员工（姓名与工号）、部门、岗位、周期得分、周期等级、当前环节、场景字段、操作。跨周期复核保留考核周期；校准保留绩效直属上级；公示保留公示时间。
- 所有结果分数显示两位小数，等级沿用 ABCD，不改变算分或定级规则。
- 统一页面标题 16px/600、分区标题 14px/600、表头及正文 13px；表头 40px、表体最小 56px。公共列宽一致，长文本按需提示。只作用于本轮绩效页面。
- 共用 PerformanceResultDrawer：modelValue/title，宽 min(720px,100vw)，统一头部/正文/底部、默认关闭按钮，支持 footer 插槽和 close 事件；class performance-result-drawer，保留各页 testid。
- 共用 PerformancePeriodResults：periods，字段 periodKey/selfScoreTotal/managerScoreTotal/selfGrade/managerGrade；统一月度回顾表格。
- 样式类：performance-result-page、performance-result-table、performance-result-toolbar、performance-result-actions、performance-result-employee、performance-result-meta、performance-result-score。
- 部门复核在列表内打开复用 DepartmentReviewWorkspace 的抽屉，完成操作刷新名单；现有任务详情入口继续有效。
- 查询仅补齐当前已授权任务的展示字段（工号、岗位、approvedAt、已有校准等级），不扩大查询范围或修改生产业务数据。当前环节应区分已审批待公示。
- 不增加权限、不设置真实账号、不发送钉钉、不修改流程条件。审批历史查询改造不包含在本次样式范围。

## 实施与验收

- [x] 公共样式、摘要、月度回顾和抽屉；校准页接入。
- [x] 复核名单/抽屉接入，补齐各现有查询的必要展示字段和类型。
- [x] 审批、公示列表与抽屉接入公共结构。
- [x] 针对性 API 查询测试、Web 类型检查、PC/手机 Playwright 验证列顺序、真实渲染字号/宽度、抽屉滚动、长文本、关闭与操作刷新；测试使用虚拟数据。
- [ ] 审查差异、只提交本轮文件、合入 main 并推送；保留回滚镜像，仅发布必要服务；核对外部资源、健康状态及未更改的生产数据边界。

## 当前基线

- HEAD/main/origin/main/API/Web：5d8365cd2db46b004215f27d33117102342cc153。
- 工作区干净，无数据库迁移或依赖变更计划。

验证：API 83 套/984 项和 API/Web 构建通过；本地 33 条角色行为回归通过，8 条表格/抽屉几何检查通过。发布镜像仍需完整复跑 41 条 UI 用例后再替换生产 API/Web。
