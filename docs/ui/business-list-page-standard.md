# 业务列表页面标准

本规范是 HRM 新增和统一业务列表页面的仓库内权威入口。批准的设计依据见 [业务列表页面模板与建设技能设计](../superpowers/specs/2026-09-15-business-list-page-templates-and-skill-design.md)。

## 适用范围

包含查询、列表、分页、详情或维护动作的普通业务页面，应先选择以下三种结构之一。Dashboard、Reports、CycleWorkspace、校准工作台等多面板复杂页面不强行套用。

| 结构 | 适用场景 | 详情方式 | 已验证代表页 |
|---|---|---|---|
| 管理台账型 `record` | 申诉、面谈、指标、模板、岗位目录 | `standard` 右侧抽屉 | `AppealsView.vue` |
| 流程任务型 `workflow` | 转正、审批、复核、公示、改进计划 | 子路由驱动的 `workflow` 宽抽屉，手机全屏 | `ConfirmationManageView.vue` |
| 主数据分栏型 `split-master` | 组织人员、花名册、先选范围再看记录 | PC 左侧范围、手机全屏范围抽屉 | `UserManageView.vue` 人员名册 |

普通详情默认使用抽屉。弹窗只用于二次确认、退回原因或少量字段；禁止抽屉嵌套抽屉。跨多个独立业务域的超长档案可保留独立详情页。

## 公共组件

组件位于 `web/src/components/common/business-list/`：

- `BusinessListPage.vue`：统一标题、主操作、查询、反馈、PC 表格、手机卡片、分页和详情承载位置。业务页面通过插槽提供内容。
- `BusinessDetailDrawer.vue`：提供 `standard`、`workflow`、`wide` 三种宽度，手机端全屏，正文滚动、底部操作固定。
- `SplitListLayout.vue`：PC 左右分栏；768px 及以下隐藏常驻左栏，通过“选择范围”打开全屏抽屉。

公共组件不请求业务数据，不定义业务字段，不判断角色权限，不执行状态转换。页面继续复用 `QueryFilterPanel`、`ListPagination`、`MobileResultCard` 和当前 API/composable。

## 页面装配约定

1. 每个真实页面表面只放一个 `BusinessListPage`，不得嵌套页面外壳。
2. PC 表格和手机卡片读取同一列表数据，操作使用同一权限谓词；手机只保留 3–5 个当前决策必需字段。
3. 查询条件、页码、排序和滚动位置由列表页面维护。打开或关闭详情不卸载列表；业务操作成功后刷新当前记录与当前页。
4. 表单校验贴近字段；网络失败保留输入；权限失败说明无权执行的真实动作。
5. 布局统一不得改变 API、请求参数、数据范围、权限、状态、按钮可见条件或主数据来源。

## 流程子路由

流程列表保留父页面挂载，并把详情注册为子路由：

```ts
{
  path: '/business-records',
  name: 'BusinessWorkflowList',
  component: () => import('@/views/business/BusinessWorkflowListView.vue'),
  children: [{
    path: ':id',
    name: 'BusinessWorkflowDetail',
    component: () => import('@/views/business/BusinessWorkflowDetailView.vue'),
    props: { embedded: true },
  }],
}
```

打开详情使用 `router.push`；从列表打开时关闭使用 `router.back()`，直接访问详情 URL 时关闭使用 `router.replace` 返回父列表。浏览器返回先关闭抽屉，再离开列表；关闭后保留原查询和分页。

## 可复用技能与模板

本机 Codex 技能安装于 `C:/Users/lwei/.codex/skills/hrm-business-page-builder/`，当前模板定版日期为 2026-09-15：

- `templates/record-list-page.vue`
- `templates/workflow-list-page.vue`
- `templates/split-master-list-page.vue`
- `references/acceptance-checklist.md`

新增或统一列表页时可调用 `$hrm-business-page-builder`。技能缺失或迁移到其他机器时，以本规范、设计文档和仓库内公共组件为准恢复，不把项目标准只保存在个人技能目录。

## 最低验收

- 先增加直接覆盖页面结构或交互的 Playwright 用例，并确认它在实现前因目标缺失而失败。
- 验证 1440×900、1024×768、390×844，覆盖长文本、空状态、请求失败、保存失败、字段错误和页面横向溢出。
- 流程页覆盖直接 URL、刷新、浏览器返回、关闭、保存后刷新以及未保存内容保护。
- 运行相关 Playwright、`npm run type-check` 和 Web 生产构建。
- 分别报告代码已实现、已提交、已推送、已上线和业务已验收；构建通过不等于真实角色验收。
