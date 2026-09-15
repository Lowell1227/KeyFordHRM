# HRM 业务列表页面模板与技能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立三类可复用业务列表页面基础组件，用申诉记录、转正管理和员工档案三个代表页面验证效果，再分批统一本轮范围内的现有列表，并生成可复用的 `hrm-business-page-builder` 技能。

**Architecture:** 运行时只增加 `BusinessListPage`、`BusinessDetailDrawer`、`SplitListLayout` 三个无业务依赖的薄组件；页面继续持有请求、字段、权限、状态和动作。管理台账使用普通抽屉，流程任务使用列表子路由驱动的宽抽屉，主数据使用 PC 分栏和手机范围选择。现有独立详情路由保留为兼容入口。

**Tech Stack:** Vue 3、TypeScript、Vue Router 4、Element Plus、Playwright、现有 `QueryFilterPanel` / `MobileResultCard` / `ListPagination` / `EmptyState`。

**Spec:** `docs/superpowers/specs/2026-09-15-business-list-page-templates-and-skill-design.md`

## Global Constraints

- 每个任务开始前运行 `git status --short --branch`，与任务文件重叠的未提交改动必须跳过并记录，不能覆盖或回退。
- 当前已知非本任务工作必须保留：`web/components.d.ts`、`docs/requirements/2026-09-14-probation-confirmation.original-untracked.md`。
- 不修改 API、请求参数、业务状态、权限、数据范围、按钮可见条件和正式数据。
- 不新增前端依赖，不建设 JSON 配置驱动的万能页面引擎。
- 继续使用 768px 断点；验收视口固定为 1440×900、1024×768、390×844。
- PC 使用表格、手机使用业务卡片，二者读取同一列表数据和权限判断；不得在 CSS 中缩放整张表格冒充移动适配。
- 流程详情可以使用抽屉，但必须由子路由驱动；浏览器返回先关闭抽屉，列表筛选、页码、排序和滚动位置保持。
- 弹窗只承载确认、退回原因或少量字段；禁止抽屉嵌套抽屉。
- 每次提交只暂存当前任务文件，提交前运行 `git diff --cached --check` 并核对 `git diff --cached --name-only`。
- 本计划不包含生产发布。代码完成、提交、上线和业务验收分别报告。

## File and Interface Map

### New runtime files

- `web/src/components/common/business-list/BusinessListPage.vue`
- `web/src/components/common/business-list/BusinessDetailDrawer.vue`
- `web/src/components/common/business-list/SplitListLayout.vue`
- `web/src/components/common/business-list/types.ts`

### New verification and documentation files

- `web/e2e/specs/56-business-list-page-templates.spec.ts`
- `docs/ui/business-list-page-standard.md`
- `C:/Users/lwei/.codex/skills/hrm-business-page-builder/SKILL.md`
- `C:/Users/lwei/.codex/skills/hrm-business-page-builder/templates/record-list-page.vue`
- `C:/Users/lwei/.codex/skills/hrm-business-page-builder/templates/workflow-list-page.vue`
- `C:/Users/lwei/.codex/skills/hrm-business-page-builder/templates/split-master-list-page.vue`
- `C:/Users/lwei/.codex/skills/hrm-business-page-builder/references/acceptance-checklist.md`

### Stable component contracts

```ts
export type BusinessListVariant = 'record' | 'workflow' | 'split-master';
export type BusinessDrawerVariant = 'standard' | 'workflow' | 'wide';
export type DrawerBeforeClose = (done: () => void) => void;
```

`BusinessListPage.vue` props and slots:

```ts
interface Props {
  variant: BusinessListVariant;
  loading?: boolean;
}

type Slots = {
  title: () => unknown;
  subtitle?: () => unknown;
  'primary-action'?: () => unknown;
  summary?: () => unknown;
  filters?: () => unknown;
  feedback?: () => unknown;
  'desktop-list': () => unknown;
  'mobile-list': () => unknown;
  pagination?: () => unknown;
  detail?: () => unknown;
};
```

`BusinessDetailDrawer.vue` props and events:

```ts
interface Props {
  modelValue: boolean;
  title: string;
  subtitle?: string;
  variant?: BusinessDrawerVariant;
  loading?: boolean;
  saving?: boolean;
  beforeClose?: DrawerBeforeClose;
}

interface Emits {
  (event: 'update:modelValue', value: boolean): void;
  (event: 'closed'): void;
}
```

`SplitListLayout.vue` props and slots:

```ts
interface Props {
  scopeOpen: boolean;
  scopeTitle?: string;
  selectedScopeLabel?: string;
}

interface Emits {
  (event: 'update:scopeOpen', value: boolean): void;
}

type Slots = {
  scope: () => unknown;
  default: () => unknown;
};
```

---

## Task 1: Lock the representative-page acceptance contract

**Files:**

- Create: `web/e2e/specs/56-business-list-page-templates.spec.ts`
- Reference: `web/e2e/specs/21-unified-list-workspace.spec.ts`
- Reference: `web/e2e/specs/51-performance-query-filters.spec.ts`

- [ ] **Step 1: Add shared API stubs and three failing template assertions**

Create one Playwright spec that logs in with mocked role data, stubs only the APIs needed by `/appeals`, `/confirmation-applications/manage`, and `/users`, and uses stable selectors:

```ts
await expect(page.getByTestId('business-list-page')).toHaveAttribute('data-list-variant', 'record');
await expect(page.getByTestId('business-list-page')).toHaveAttribute('data-list-variant', 'workflow');
await expect(page.getByTestId('split-list-layout')).toBeVisible();
```

Add assertions for desktop table/mobile card switching and page overflow:

```ts
await page.setViewportSize({ width: 390, height: 844 });
await expect(page.locator('.desktop-result-table')).toBeHidden();
await expect(page.locator('.mobile-result-list')).toBeVisible();
await expect.poll(() => page.evaluate(() => ({
  documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
}))).toEqual({ documentOverflow: 0, bodyOverflow: 0 });
```

- [ ] **Step 2: Run the new spec and confirm it fails for the missing template selectors**

Run from `web/`:

```powershell
npm run test:e2e -- 56-business-list-page-templates.spec.ts
```

Expected: assertions for `business-list-page` and `split-list-layout` fail; authentication or unrelated route setup must not be the failure cause.

- [ ] **Step 3: Commit only the failing acceptance contract**

```powershell
git add web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "test(web): define business list template contracts"
```

## Task 2: Implement the shared list shell and migrate the appeals ledger

**Files:**

- Create: `web/src/components/common/business-list/types.ts`
- Create: `web/src/components/common/business-list/BusinessListPage.vue`
- Create: `web/src/components/common/business-list/BusinessDetailDrawer.vue`
- Modify: `web/src/views/appeals/AppealsView.vue`
- Test: `web/e2e/specs/56-business-list-page-templates.spec.ts`

- [ ] **Step 1: Add the shared types**

```ts
export type BusinessListVariant = 'record' | 'workflow' | 'split-master';
export type BusinessDrawerVariant = 'standard' | 'workflow' | 'wide';
export type DrawerBeforeClose = (done: () => void) => void;
```

- [ ] **Step 2: Implement `BusinessListPage` as a slot-only layout shell**

The root must expose the template selector and preserve existing class names used by regression tests:

```vue
<div
  class="page-stack app-list-page business-list-page"
  data-testid="business-list-page"
  :data-list-variant="variant"
>
  <ChartCard class="business-list-page__header">
    <template #title><slot name="title" /></template>
    <template v-if="$slots['primary-action']" #extra><slot name="primary-action" /></template>
    <div v-if="$slots.subtitle" class="business-list-page__subtitle"><slot name="subtitle" /></div>
    <slot name="summary" />
    <slot name="filters" />
  </ChartCard>
  <ChartCard class="list-result-card business-list-page__results" :padded="false">
    <slot name="feedback" />
    <div class="desktop-result-table"><slot name="desktop-list" /></div>
    <div class="mobile-result-list"><slot name="mobile-list" /></div>
    <slot name="pagination" />
  </ChartCard>
  <slot name="detail" />
</div>
```

At widths up to 768px, hide `.desktop-result-table`, show `.mobile-result-list`, stack header content, and keep the result card inside the viewport. At larger widths, apply the inverse display rule.

- [ ] **Step 3: Implement `BusinessDetailDrawer` with fixed header/footer and mobile fullscreen behavior**

Map variants to width without exposing arbitrary CSS from business pages:

```ts
const drawerSize = computed(() => ({
  standard: 'min(620px, 96vw)',
  workflow: 'min(960px, 96vw)',
  wide: 'min(1180px, 98vw)',
}[props.variant]));
```

Render `summary`, default body, and `footer` slots. Bind Element Plus `before-close`, disable body overflow leaks, and add:

```vue
<el-drawer
  :model-value="modelValue"
  :title="title"
  :size="drawerSize"
  :before-close="beforeClose"
  class="business-detail-drawer"
  data-testid="business-detail-drawer"
  :data-drawer-variant="variant"
  @update:model-value="$emit('update:modelValue', $event)"
  @closed="$emit('closed')"
>
```

- [ ] **Step 4: Replace the appeals page shell and full edit dialog**

Wrap the existing filters, table, mobile cards and pagination in `BusinessListPage variant="record"`. Replace the full `el-dialog` with `BusinessDetailDrawer variant="standard"`; keep the same form model, validation, API calls, permission checks and save handler. The existing button labels and visible fields must not change.

Use the slots directly:

```vue
<BusinessListPage variant="record" :loading="loading">
  <template #title>申诉记录</template>
  <template #primary-action>
    <el-button v-if="canMaintainAppeals" type="primary" @click="openCreate">新增申诉记录</el-button>
  </template>
  <template #desktop-list><el-table :data="list" v-loading="loading" /></template>
  <template #mobile-list><MobileResultCard v-for="item in list" :key="item.id" /></template>
  <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" @change="loadList" /></template>
  <template #detail>
    <BusinessDetailDrawer v-model="dialogVisible" :title="editingId ? '编辑申诉记录' : '新增申诉记录'" variant="standard" />
  </template>
</BusinessListPage>
```

- [ ] **Step 5: Add and run the appeals drawer assertions**

Add assertions that opening “编辑” displays `data-drawer-variant="standard"`, the old full-form dialog is absent, a failed save preserves entered values, and the same visible action is available at 1440px and 390px.

```powershell
npm run test:e2e -- 56-business-list-page-templates.spec.ts --grep "appeals"
npm run type-check
```

Expected: the appeals scenario passes and type checking succeeds.

- [ ] **Step 6: Commit the record-template vertical slice**

```powershell
git add web/src/components/common/business-list/types.ts web/src/components/common/business-list/BusinessListPage.vue web/src/components/common/business-list/BusinessDetailDrawer.vue web/src/views/appeals/AppealsView.vue web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat(web): add reusable record list template"
```

## Task 3: Implement the route-driven workflow drawer on confirmation management

**Files:**

- Modify: `web/src/router/routes.ts`
- Modify: `web/src/views/confirmation/ConfirmationManageView.vue`
- Modify: `web/src/views/confirmation/ConfirmationDetailView.vue`
- Test: `web/e2e/specs/56-business-list-page-templates.spec.ts`
- Test: `web/e2e/specs/28-confirmation-employee-draft.spec.ts`
- Test: `web/e2e/specs/53-prepublication-confirmation.spec.ts`

- [ ] **Step 1: Add a failing route-drawer test**

The test must open a known row from `/confirmation-applications/manage`, assert the URL becomes `/confirmation-applications/manage/:id`, verify the list stays mounted behind the drawer, then call browser back and verify the drawer closes without resetting the current page.

```ts
await page.getByRole('button', { name: '查看' }).first().click();
await expect(page).toHaveURL(/\/confirmation-applications\/manage\/confirmation-1$/);
await expect(page.getByTestId('business-detail-drawer')).toHaveAttribute('data-drawer-variant', 'workflow');
await expect(page.getByTestId('business-list-page')).toBeAttached();
await page.goBack();
await expect(page.getByTestId('business-detail-drawer')).toBeHidden();
await expect(page.getByTestId('business-list-page')).toHaveAttribute('data-list-variant', 'workflow');
```

Run the scenario and confirm it fails because the current click leaves the list page:

```powershell
npm run test:e2e -- 56-business-list-page-templates.spec.ts --grep "confirmation workflow"
```

- [ ] **Step 2: Add a child detail route while preserving the standalone route**

Nest the workflow detail below the management list:

```ts
{
  path: '/confirmation-applications/manage',
  name: 'ConfirmationManage',
  component: () => import('@/views/confirmation/ConfirmationManageView.vue'),
  children: [{
    path: ':id',
    name: 'ConfirmationManageDetail',
    component: () => import('@/views/confirmation/ConfirmationDetailView.vue'),
    props: { embedded: true },
    meta: { requiresAuth: true, title: '转正申请详情', activeNavigationPath: '/confirmation-applications/manage' },
  }],
  meta: {
    requiresAuth: true,
    title: '转正管理',
    roles: ['hr'],
    hrCapabilities: ['confirmation_manage'],
    navigation: { module: 'performance', label: '转正管理', order: 160, group: 'performance-probation', groupLabel: '试用期与转正' },
  },
}
```

Keep `/confirmation-applications/:id` and route name `ConfirmationDetail` unchanged for notifications, bookmarks and backward compatibility.

- [ ] **Step 3: Make the confirmation detail embeddable without duplicating business logic**

Add an `embedded` prop defaulting to `false`. In embedded mode, suppress only the standalone page header/back chrome; keep the same detail request, role checks, form state, field errors, dialogs and mutation handlers. Emit `changed` after successful mutations so the list can refresh the current page.

```ts
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });
const emit = defineEmits<{ (event: 'changed'): void }>();
```

The generic standalone route must still render the full page when `embedded` is false.

- [ ] **Step 4: Wrap the list in the workflow template and host the child route in a drawer**

Change both desktop and mobile “查看” actions to:

```ts
const openDetail = (id: string) => router.push({
  name: 'ConfirmationManageDetail',
  params: { id },
  query: route.query,
});

const closeDetail = () => router.push({
  name: 'ConfirmationManage',
  query: route.query,
});
```

Render the matched child component inside `BusinessDetailDrawer variant="workflow"`. Use `router.back()` for an ordinary user close when the child route was opened from this list; use the named list route as the direct-entry fallback.

```vue
<template #detail>
  <BusinessDetailDrawer
    :model-value="Boolean(route.params.id)"
    title="转正申请详情"
    variant="workflow"
    @update:model-value="value => { if (!value) closeDetail(); }"
  >
    <RouterView v-slot="{ Component }">
      <component :is="Component" @changed="loadList" />
    </RouterView>
  </BusinessDetailDrawer>
</template>
```

Do not put the existing “待关注” drawer inside the detail drawer. It remains a peer drawer and must be unavailable while the workflow detail is open.

- [ ] **Step 5: Verify route history, refresh, direct access, mobile fullscreen and existing confirmation flows**

```powershell
npm run test:e2e -- 56-business-list-page-templates.spec.ts --grep "confirmation workflow"
npm run test:e2e -- 28-confirmation-employee-draft.spec.ts 53-prepublication-confirmation.spec.ts
npm run type-check
```

Expected: direct access loads the list shell plus open drawer; refresh keeps it open; browser back closes it; at 390px the drawer fills the viewport and its fixed footer does not cover body content.

- [ ] **Step 6: Commit the workflow-template vertical slice**

```powershell
git add web/src/router/routes.ts web/src/views/confirmation/ConfirmationManageView.vue web/src/views/confirmation/ConfirmationDetailView.vue web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat(web): open confirmation workflow in route drawer"
```

## Task 4: Implement the split master-data layout on the employee roster

**Files:**

- Create: `web/src/components/common/business-list/SplitListLayout.vue`
- Modify: `web/src/views/admin/UserManageView.vue`
- Test: `web/e2e/specs/56-business-list-page-templates.spec.ts`
- Test: `web/e2e/specs/15-user-management-concepts.spec.ts`
- Test: `web/e2e/specs/23-employee-data-review.spec.ts`

- [ ] **Step 1: Add a failing responsive split-layout test**

At 1440px and 1024px, assert the organization/range panel and roster list are side by side. At 390px, assert the persistent range panel is hidden, “选择范围” opens a full-height scope drawer, selecting a scope updates the visible summary, and the page has no horizontal overflow.

- [ ] **Step 2: Implement `SplitListLayout`**

Use one external selection model and render the `scope` slot in desktop aside or mobile drawer according to the breakpoint. The component owns layout only:

```vue
<section class="split-list-layout" data-testid="split-list-layout">
  <aside class="split-list-layout__scope"><slot name="scope" /></aside>
  <section class="split-list-layout__content">
    <el-button class="split-list-layout__scope-trigger" @click="$emit('update:scopeOpen', true)">选择范围</el-button>
    <span v-if="selectedScopeLabel" class="split-list-layout__scope-label">{{ selectedScopeLabel }}</span>
    <slot />
  </section>
  <el-drawer
    class="split-list-layout__mobile-scope"
    :model-value="scopeOpen"
    :title="scopeTitle"
    direction="ltr"
    size="100%"
    @update:model-value="$emit('update:scopeOpen', $event)"
  >
    <slot name="scope" />
  </el-drawer>
</section>
```

- [ ] **Step 3: Migrate only the employee roster region of `UserManageView`**

Wrap the employee roster page in `BusinessListPage variant="split-master"`; place the existing organization/range tree in `SplitListLayout #scope` and the existing query, desktop table, mobile cards and pagination in the content area. Keep employee archive detail as the existing wide drawer because it spans multiple business domains.

Do not restructure department merge, batch assignment, personnel settings, leader or approver dialogs in this task. Do not alter roster-master or DingTalk identity behavior.

- [ ] **Step 4: Verify roster behavior and existing personnel concepts**

```powershell
npm run test:e2e -- 56-business-list-page-templates.spec.ts --grep "employee roster"
npm run test:e2e -- 15-user-management-concepts.spec.ts 23-employee-data-review.spec.ts
npm run type-check
```

Expected: current organization selection and data requests are unchanged; only the responsive container changes.

- [ ] **Step 5: Commit the split-template vertical slice**

```powershell
git add web/src/components/common/business-list/SplitListLayout.vue web/src/views/admin/UserManageView.vue web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat(web): add responsive master data split layout"
```

## Task 5: Stabilize shared behavior and document the verified template API

**Files:**

- Modify: `web/src/components/common/business-list/BusinessListPage.vue`
- Modify: `web/src/components/common/business-list/BusinessDetailDrawer.vue`
- Modify: `web/src/components/common/business-list/SplitListLayout.vue`
- Modify: `web/e2e/specs/56-business-list-page-templates.spec.ts`
- Create: `docs/ui/business-list-page-standard.md`

- [ ] **Step 1: Add edge-case assertions before changing shared components**

Cover empty state, loading state, long title/department/status text, scrollable drawer body, sticky footer, keyboard focus after close, 1024px table width, and unsaved-close interception. The close test must supply a real `beforeClose` callback and assert the drawer remains open until `done()` is called.

- [ ] **Step 2: Make the smallest component fixes needed for all edge cases**

Keep responsive styles inside the three components unless an existing global token in `web/src/styles/theme.css` is the correct source. Do not introduce page-specific selectors into shared components.

- [ ] **Step 3: Write the repository source-of-truth standard**

Document:

- the three template decision rules;
- the stable props, emits and slots;
- route-drawer URL/back/direct-entry behavior;
- when a full detail page is still appropriate;
- desktop/mobile field selection and overflow rules;
- copy-ready imports and one complete small example per template;
- the acceptance checklist and status-report format.

Every example must import the actual files implemented in Tasks 2–4 and pass `npm run type-check` when copied into a temporary view.

- [ ] **Step 4: Run all representative template checks**

```powershell
npm run test:e2e -- 56-business-list-page-templates.spec.ts
npm run test:e2e -- 21-unified-list-workspace.spec.ts 51-performance-query-filters.spec.ts
npm run type-check
npm run build
```

- [ ] **Step 5: Commit stable shared behavior and documentation**

```powershell
git add web/src/components/common/business-list/BusinessListPage.vue web/src/components/common/business-list/BusinessDetailDrawer.vue web/src/components/common/business-list/SplitListLayout.vue web/e2e/specs/56-business-list-page-templates.spec.ts docs/ui/business-list-page-standard.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(web): publish business list page standard"
```

## Task 6: Migrate the remaining management-ledger pages

**Files:**

- Modify: `web/src/views/interview/InterviewListView.vue`
- Modify: `web/src/views/interview/InterviewDrawer.vue`
- Modify: `web/src/views/admin/IndicatorLibraryView.vue`
- Modify: `web/src/views/admin/TemplateManageView.vue`
- Modify: `web/src/views/admin/PositionDirectoryView.vue`
- Modify: `web/e2e/specs/21-unified-list-workspace.spec.ts`
- Modify: `web/e2e/specs/51-performance-query-filters.spec.ts`
- Modify: `web/e2e/specs/56-business-list-page-templates.spec.ts`

- [ ] **Step 1: Record each page's current fields and permissions in the test before migration**

For every page, assert the current query inputs, table headers, one representative mobile-card field, row actions and permission-hidden actions. These assertions are the behavior lock; do not change labels while migrating layout.

- [ ] **Step 2: Confirm the batch files are clean**

```powershell
git status --short --branch
git diff -- web/src/views/interview/InterviewListView.vue web/src/views/interview/InterviewDrawer.vue web/src/views/admin/IndicatorLibraryView.vue web/src/views/admin/TemplateManageView.vue web/src/views/admin/PositionDirectoryView.vue
```

If any file has unrelated uncommitted changes, omit that page from this batch and list it as deferred in the completion report.

- [ ] **Step 3: Migrate all clean pages to `BusinessListPage variant="record"`**

Preserve each page's existing `QueryFilterPanel`, table columns, mobile-card content, pagination and business handlers. Use `BusinessDetailDrawer variant="standard"` for full view/edit forms; retain a short dialog only for confirmation or a small reason field. `InterviewDrawer.vue` may keep its file boundary but must use the shared drawer shell.

- [ ] **Step 4: Run management-list regression**

```powershell
npm run test:e2e -- 21-unified-list-workspace.spec.ts 51-performance-query-filters.spec.ts 56-business-list-page-templates.spec.ts
npm run type-check
```

- [ ] **Step 5: Commit only clean migrated pages**

```powershell
git add web/src/views/interview/InterviewListView.vue web/src/views/interview/InterviewDrawer.vue web/src/views/admin/IndicatorLibraryView.vue web/src/views/admin/TemplateManageView.vue web/src/views/admin/PositionDirectoryView.vue web/e2e/specs/21-unified-list-workspace.spec.ts web/e2e/specs/51-performance-query-filters.spec.ts web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor(web): unify management ledger layouts"
```

## Task 7: Migrate confirmation and probation role lists

**Files:**

- Modify: `web/src/router/routes.ts`
- Modify: `web/src/views/confirmation/ConfirmationApprovalView.vue`
- Modify: `web/src/views/confirmation/ConfirmationMineView.vue`
- Modify: `web/src/views/probation/ProbationManageView.vue`
- Modify: `web/src/views/probation/ProbationManagerView.vue`
- Modify: `web/src/views/probation/ProbationMineView.vue`
- Modify: `web/src/views/probation/ProbationDetailView.vue`
- Modify: `web/src/views/probation/components/ProbationList.vue`
- Modify: `web/e2e/specs/28-confirmation-employee-draft.spec.ts`
- Modify: `web/e2e/specs/56-business-list-page-templates.spec.ts`

- [ ] **Step 1: Add role-specific route-drawer tests**

For HR, approving manager and employee, assert stable child URLs, list persistence, visible actions, no unauthorized action on PC/mobile, and browser-back close. Add child routes below the existing list routes, for example `approvals/:id`, `mine/:id`, `probation-reviews/manage/:id`, `manager/:id`, and `mine/:id`. Keep the generic standalone detail routes.

- [ ] **Step 2: Migrate the six clean list views to `variant="workflow"`**

Reuse the embedded detail component for each domain. Do not copy business mutations into list pages. `ProbationList.vue` remains a domain component and supplies the table/mobile-card slots; it must not become a second generic page framework.

- [ ] **Step 3: Verify role boundaries and route history**

```powershell
npm run test:e2e -- 28-confirmation-employee-draft.spec.ts 56-business-list-page-templates.spec.ts
npm run type-check
```

- [ ] **Step 4: Commit the confirmation/probation batch**

```powershell
git add web/src/router/routes.ts web/src/views/confirmation/ConfirmationApprovalView.vue web/src/views/confirmation/ConfirmationMineView.vue web/src/views/probation/ProbationManageView.vue web/src/views/probation/ProbationManagerView.vue web/src/views/probation/ProbationMineView.vue web/src/views/probation/ProbationDetailView.vue web/src/views/probation/components/ProbationList.vue web/e2e/specs/28-confirmation-employee-draft.spec.ts web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor(web): unify probation and confirmation lists"
```

## Task 8: Migrate performance-operation workflow lists

**Files:**

- Modify: `web/src/views/task/DepartmentReviewListView.vue`
- Modify: `web/src/views/approval/ApprovalView.vue`
- Modify: `web/src/views/publish/PublishView.vue`
- Modify: `web/src/views/calibration/CalibrationView.vue`
- Modify: `web/e2e/specs/51-performance-query-filters.spec.ts`
- Modify: `web/e2e/specs/56-business-list-page-templates.spec.ts`

- [ ] **Step 1: Lock current scope, status, row-action and request-count behavior in Playwright**

The tests must assert that opening/closing a detail does not duplicate list requests or reset filters. Pages that already use a domain result drawer may place that drawer in the `detail` slot; do not wrap one drawer inside another.

- [ ] **Step 2: Migrate clean pages to the workflow list shell**

Unify page header, filters, result surface, desktop/mobile switch and pagination. Keep calibration's complex workbench/editor outside the ordinary list shell; only its queue/list surface is migrated.

- [ ] **Step 3: Run performance-operation regression**

```powershell
npm run test:e2e -- 51-performance-query-filters.spec.ts 53-prepublication-confirmation.spec.ts 56-business-list-page-templates.spec.ts
npm run type-check
```

- [ ] **Step 4: Commit the performance-operation batch**

```powershell
git add web/src/views/task/DepartmentReviewListView.vue web/src/views/approval/ApprovalView.vue web/src/views/publish/PublishView.vue web/src/views/calibration/CalibrationView.vue web/e2e/specs/51-performance-query-filters.spec.ts web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor(web): unify performance operation lists"
```

## Task 9: Migrate improvement plans only after an explicit clean-file check

**Files:**

- Modify: `web/src/router/routes.ts`
- Modify: `web/src/views/improvement-plans/ImprovementPlanListView.vue`
- Modify: `web/src/views/improvement-plans/ImprovementPlanDetailView.vue`
- Modify: `web/e2e/specs/56-business-list-page-templates.spec.ts`
- Test: existing improvement-plan E2E specs selected by `rg -l "improvement-plans" web/e2e/specs`

- [ ] **Step 1: Check for overlap with the recent improvement-plan work**

```powershell
git status --short --branch
git log -5 --oneline -- web/src/views/improvement-plans/ImprovementPlanListView.vue web/src/views/improvement-plans/ImprovementPlanDetailView.vue
git diff -- web/src/views/improvement-plans/ImprovementPlanListView.vue web/src/views/improvement-plans/ImprovementPlanDetailView.vue
```

If either view has unrelated uncommitted changes, stop this task and record it as deferred. Do not stash or commit another person's work.

- [ ] **Step 2: Add the list child route and embed the existing detail**

Add `/improvement-plans/:id` as a child route under the list using a new route name such as `ImprovementPlanDrawerDetail`; move the existing generic standalone detail to `/improvement-plan-details/:id` with a redirect from old external entry only if route matching requires it. Prefer preserving the existing `/improvement-plans/:id` URL by making it the child and rendering the list shell around it.

The business detail code stays in `ImprovementPlanDetailView.vue` with an `embedded` prop; no mutation handler is duplicated.

- [ ] **Step 3: Verify form consistency, failed-save preservation and browser-back behavior**

```powershell
$improvementSpecs = rg -l "improvement-plans" web/e2e/specs
npm run test:e2e -- $improvementSpecs 56-business-list-page-templates.spec.ts
npm run type-check
```

- [ ] **Step 4: Commit the improvement-plan batch when clean**

```powershell
git add web/src/router/routes.ts web/src/views/improvement-plans/ImprovementPlanListView.vue web/src/views/improvement-plans/ImprovementPlanDetailView.vue web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor(web): open improvement plans in route drawer"
```

## Task 10: Migrate the remaining in-scope master-data and review queues

**Files:**

- Modify: `web/src/views/admin/UserManageView.vue`
- Modify: `web/src/views/admin/PersonnelReviewView.vue`
- Modify: `web/src/views/admin/components/PersonnelPendingReviews.vue`
- Modify: `web/e2e/specs/23-employee-data-review.spec.ts`
- Modify: `web/e2e/specs/54-personnel-resignation-archive.spec.ts`
- Modify: `web/e2e/specs/56-business-list-page-templates.spec.ts`

- [ ] **Step 1: Inventory remaining list regions without touching complex archive detail**

Identify every ordinary table/card list in the three files and classify it as `record`, `workflow`, or `split-master`. Employee full archive detail, employment timeline and cross-domain drawers remain dedicated domain components.

- [ ] **Step 2: Add regression assertions for roster authority and review permissions**

Tests must preserve the distinction that HRM roster data is authoritative and DingTalk is login/identity binding only. Assert ordinary HR read versus administrator/edit capability exactly as currently implemented.

- [ ] **Step 3: Apply the corresponding shells to clean list regions**

Use one `BusinessListPage` per real page surface; do not nest page shells. `PersonnelPendingReviews.vue` may remain a child component and populate the parent's desktop/mobile slots.

- [ ] **Step 4: Verify personnel flows**

```powershell
npm run test:e2e -- 23-employee-data-review.spec.ts 54-personnel-resignation-archive.spec.ts 56-business-list-page-templates.spec.ts
npm run type-check
```

- [ ] **Step 5: Commit the remaining in-scope migration**

```powershell
git add web/src/views/admin/UserManageView.vue web/src/views/admin/PersonnelReviewView.vue web/src/views/admin/components/PersonnelPendingReviews.vue web/e2e/specs/23-employee-data-review.spec.ts web/e2e/specs/54-personnel-resignation-archive.spec.ts web/e2e/specs/56-business-list-page-templates.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor(web): unify personnel list workspaces"
```

## Task 11: Generate and verify the reusable Codex skill from the final implementation

**Files:**

- Create: `C:/Users/lwei/.codex/skills/hrm-business-page-builder/SKILL.md`
- Create: `C:/Users/lwei/.codex/skills/hrm-business-page-builder/templates/record-list-page.vue`
- Create: `C:/Users/lwei/.codex/skills/hrm-business-page-builder/templates/workflow-list-page.vue`
- Create: `C:/Users/lwei/.codex/skills/hrm-business-page-builder/templates/split-master-list-page.vue`
- Create: `C:/Users/lwei/.codex/skills/hrm-business-page-builder/references/acceptance-checklist.md`
- Modify: `docs/ui/business-list-page-standard.md`

- [ ] **Step 1: Invoke the required skill-authoring guidance**

Before creating the skill, read and apply `skill-creator` and `superpowers:writing-skills`. The installed skill must point back to `AGENTS.md`, the approved design spec, and `docs/ui/business-list-page-standard.md` as project rules.

- [ ] **Step 2: Write `SKILL.md` with narrow triggers and stop conditions**

The skill workflow must:

1. inspect worktree and related pages;
2. classify the page into one of the three templates or explicitly reject the fit;
3. list business object, filters, desktop columns, mobile fields, scope, role actions and detail complexity;
4. copy the chosen template;
5. preserve API/permissions/business states;
6. add a failing targeted Playwright check;
7. verify 1440px, 1024px and 390px;
8. report implemented/committed/deployed/accepted separately.

It must stop for ambiguous business meaning, permission expansion, production data, conflicting dirty files, nested-drawer pressure, or a complex workbench that does not fit the templates.

- [ ] **Step 3: Create three copy-ready template resources**

Each template must import the final shared components by their real aliases and contain working local state for its structural concerns. The workflow template must include Vue Router child-detail open/close code. The split template must include mobile scope state. Do not include fake API endpoints or fake permission values.

- [ ] **Step 4: Verify the skill against a scratch page outside tracked source**

Copy each template into a temporary directory, replace only named business slots with a minimal local array, and confirm its imports and TypeScript signatures match the repository. Run the skill's validation script if generated by `skill-creator`; otherwise run the skill validator prescribed by that skill.

- [ ] **Step 5: Synchronize repository documentation with the installed skill**

Update `docs/ui/business-list-page-standard.md` with the local skill location, version date and exact template filenames. The repository document remains authoritative if the local skill is absent.

- [ ] **Step 6: Commit the repository-side skill reference**

```powershell
git add docs/ui/business-list-page-standard.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(web): link reusable business page builder skill"
```

## Task 12: Run final verification and produce the acceptance handoff

**Files:**

- Verify: all files changed by Tasks 1–11
- Do not modify: production configuration or deployment files

- [ ] **Step 1: Verify the worktree and changed-file scope**

```powershell
git status --short --branch
git diff --check origin/main..HEAD
git diff --name-only origin/main..HEAD
```

Confirm unrelated baseline changes and the two known uncommitted files were not staged or altered by this work.

- [ ] **Step 2: Run focused and broad Web checks**

```powershell
npm run test:e2e -- 21-unified-list-workspace.spec.ts 28-confirmation-employee-draft.spec.ts 51-performance-query-filters.spec.ts 53-prepublication-confirmation.spec.ts 54-personnel-resignation-archive.spec.ts 56-business-list-page-templates.spec.ts
npm run type-check
npm run build
```

If a pre-existing unrelated test fails, rerun the failing spec once, capture the exact error, and report it separately; do not weaken the assertion to make the suite green.

- [ ] **Step 3: Perform visible browser acceptance at all three widths**

Open the three representative pages and one page from each later migration batch. Verify title density, filters, table/card fields, action alignment, pagination, drawer scrolling, sticky footer, browser back, direct URL refresh, long text, empty state and failed-save preservation.

Use the relevant real roles for employee, direct manager, HR/approver and system administrator. A mocked Playwright role proves regression behavior but does not substitute for production or business acceptance.

- [ ] **Step 4: Produce a status-separated handoff**

Report in this order:

1. implemented components, templates and migrated pages;
2. test commands and exact results;
3. commit hashes and whether they are pushed;
4. pages skipped because of dirty overlap or template mismatch;
5. remaining business-role acceptance;
6. production status as “not deployed” unless the user separately authorizes release.

Do not claim the migration complete if a listed in-scope page was skipped; mark the code batch partial and name the reason.
