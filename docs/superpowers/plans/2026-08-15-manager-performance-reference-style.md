# Manager Performance Reference Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the manager goal-review and manager-evaluation workspaces visually match the supplied reference screens while preserving HRM's current fields, permissions, routes, and workflow behavior.

**Architecture:** Keep `TeamTaskWorkspaceShell.vue` as the shared full-page shell, and add a dedicated `PerformanceReviewTable.vue` for always-visible, table-shaped manager review rows. `GoalReviewWorkspace.vue` and `ManagerEvaluationWorkspace.vue` provide stage-specific columns and editors through slots, while the existing disclosure-based `PerformanceIndicatorList.vue` remains unchanged for employee pages.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Element Plus, scoped CSS/container queries, Playwright contract tests, Vite.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Use the supplied goal-review and manager-scoring screenshots as the visual baseline.
- Use shallow white cards on a pale gray page, a compact top bar, a narrow employee rail, and wide flat indicator rows.
- Goal review and manager evaluation share geometry but expose only their own existing business fields.
- Do not add screenshot-only features such as horizontal view, vertical view, custom columns, or fabricated fields.
- Do not change APIs, permissions, direct-report authorization, task status transitions, URL state, return behavior, save/submit/approve/reject/withdraw behavior, attachment handling, or dirty-form guards.
- Preserve the existing disclosure presentation used by employee performance pages.
- At 390×844, the document must not horizontally overflow and every key action must remain reachable.
- Follow TDD: add or change the focused contract first, observe failure, implement the smallest matching change, and re-run the focused contract.
- Use focused checks only during development; do not run the entire repository audit.
- Never stage the user's unrelated `README.md`, `docs/acceptance/`, `docs/operations/`, or `tmp/` changes.

---

## File Map

- Create `web/src/views/task/components/PerformanceReviewTable.vue`: shared flat table semantics, row focus/validation, weight total, and responsive field stacking.
- Modify `web/src/views/task/components/TeamTaskWorkspaceShell.vue`: reference-style top bar, employee rail, profile strip, gray page background, and responsive shell geometry.
- Modify `web/src/views/task/components/GoalReviewWorkspace.vue`: stage-specific table columns, inline editors, reference-info drawer, and goal-review card styling.
- Modify `web/src/views/task/components/ManagerEvaluationWorkspace.vue`: stage-specific table columns, inline self/manager evaluation, row-level extra scores, and separate summary card.
- Modify `web/e2e/specs/10-team-performance-contract.spec.ts`: replace manager disclosure expectations with flat-table contracts and add visual geometry/responsive assertions.
- Preserve `web/src/views/task/components/PerformanceIndicatorList.vue`: employee pages continue using disclosure controls.

---

### Task 1: Restyle the shared full-page manager shell

**Files:**
- Modify: `web/src/views/task/components/TeamTaskWorkspaceShell.vue`
- Test: `web/e2e/specs/10-team-performance-contract.spec.ts`

**Interfaces:**
- Consumes: existing `title`, `cycleName`, `members`, `selectedTaskId`, `task`, `loading`, and `error` props and existing `back`, `select-member`, and `retry` events.
- Produces: stable `team-task-workspace__bar`, `team-task-workspace__members`, `team-task-workspace__profile`, and `team-task-workspace__content` regions used by both stages.

- [ ] **Step 1: Add the failing shell geometry contract**

```ts
test('full-page manager workspace uses a compact reference-style shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockGoalReviewWorkspace(page);
  await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');

  const shell = page.getByTestId('team-task-workspace');
  await expect(shell).toHaveClass(/is-reference-style/);
  await expect(shell.getByTestId('team-task-profile')).toBeVisible();

  const geometry = await shell.evaluate((element) => {
    const bar = element.querySelector<HTMLElement>('.team-task-workspace__bar')!;
    const members = element.querySelector<HTMLElement>('.team-task-workspace__members')!;
    const profile = element.querySelector<HTMLElement>('.team-task-workspace__profile')!;
    return {
      barHeight: bar.getBoundingClientRect().height,
      memberWidth: members.getBoundingClientRect().width,
      profileHeight: profile.getBoundingClientRect().height,
      background: getComputedStyle(element).backgroundColor,
    };
  });
  expect(geometry.barHeight).toBeLessThanOrEqual(58);
  expect(geometry.memberWidth).toBeGreaterThanOrEqual(150);
  expect(geometry.memberWidth).toBeLessThanOrEqual(170);
  expect(geometry.profileHeight).toBeLessThanOrEqual(92);
  expect(geometry.background).not.toBe('rgb(255, 255, 255)');
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
cd web
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts --grep "compact reference-style shell"
```

Expected: FAIL because `is-reference-style` and `team-task-profile` do not exist.

- [ ] **Step 3: Add explicit shell hooks and reference-style spacing**

Change only the opening tags of the existing outer shell and profile; leave every current child and event handler in place:

```vue
<section class="team-task-workspace is-reference-style" data-testid="team-task-workspace">
</section>

<section class="team-task-workspace__profile" data-testid="team-task-profile">
</section>
```

Apply the reference dimensions:

```css
.team-task-workspace { min-width: 0; min-height: calc(100vh - 48px); background: #f4f6fa; }
.team-task-workspace__bar {
  min-height: 52px; padding: 0 20px; border-bottom: 1px solid #edf0f5; background: #fff;
}
.team-task-workspace__layout { grid-template-columns: 160px minmax(0, 1fr); background: #f4f6fa; }
.team-task-workspace__members {
  padding: 10px 8px; border-right: 1px solid #e8ecf2; background: #fff;
}
.team-task-workspace__member { min-height: 42px; padding: 6px 8px; border: 0; border-radius: 8px; }
.team-task-workspace__member.is-current { background: #e8f3ff; color: #1677ff; }
.team-task-workspace__main { min-width: 0; padding: 16px; background: #f4f6fa; }
.team-task-workspace__profile {
  min-height: 76px; padding: 12px 16px; border: 0; border-radius: 14px;
  background: #fff; box-shadow: 0 1px 2px rgb(31 45 61 / 4%);
}
.team-task-workspace__content { min-width: 0; margin-top: 14px; }

@media (max-width: 720px) {
  .team-task-workspace__bar { padding: 0 10px; }
  .team-task-workspace__layout { display: block; }
  .team-task-workspace__members {
    display: flex; gap: 6px; overflow-x: auto;
    border-right: 0; border-bottom: 1px solid #e8ecf2;
  }
  .team-task-workspace__member { flex: 0 0 auto; min-width: 112px; }
  .team-task-workspace__main { padding: 10px; }
}
```

- [ ] **Step 4: Run focused shell/navigation contracts**

```powershell
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts --grep "compact reference-style shell|full-page team workspace|restores the exact list"
```

Expected: PASS.

- [ ] **Step 5: Commit only the shell task**

```powershell
git add -- web/src/views/task/components/TeamTaskWorkspaceShell.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "style(web): align manager workspace shell"
```

---

### Task 2: Replace goal-review disclosure cards with a flat review table

**Files:**
- Create: `web/src/views/task/components/PerformanceReviewTable.vue`
- Modify: `web/src/views/task/components/GoalReviewWorkspace.vue`
- Test: `web/e2e/specs/10-team-performance-contract.spec.ts`

**Interfaces:**
- Consumes: `PerformanceIndicatorRow`, `rows`, `columns`, `invalidIndicatorIds`, and `weightTotal`.
- Produces: slots `cell-indicator`, `cell-weight`, `cell-description`, `cell-primary`, `cell-secondary`, and `row-extra`; test ids `performance-review-table`, `indicator-row-*`, `indicator-details-*`, and `indicator-weight-total`.

- [ ] **Step 1: Add the failing flat goal-review contract**

```ts
test('goal review renders all business fields in a reference-style flat table', async ({ page }) => {
  await mockGoalReviewWorkspace(page);
  await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending&taskId=task-1');

  const table = page.getByTestId('performance-review-table');
  for (const label of ['名称', '权重', '指标描述', '对齐', '可见范围']) {
    await expect(table.getByRole('columnheader', { name: label })).toBeVisible();
  }
  await expect(page.getByTestId('indicator-details-ind-1')).toBeVisible();
  await expect(page.getByTestId('indicator-toggle-ind-1')).toHaveCount(0);
  await expect(page.getByTestId('indicator-expand-all')).toHaveCount(0);
  await expect(page.getByTestId('indicator-visibility-ind-1')).toBeVisible();

  await expect(page.getByTestId('goal-review-reference-open')).toBeVisible();
  await expect(page.getByTestId('performance-reference-panel')).toHaveCount(0);
  await page.getByTestId('goal-review-reference-open').click();
  await expect(page.getByTestId('performance-reference-panel')).toBeVisible();
});
```

Update existing manager goal-review tests to use already-visible fields. Remove clicks on `indicator-toggle-*`, `indicator-expand-all`, and `indicator-collapse-all`; retain save, visibility, validation, rejection focus, approve, and reject assertions. Do not change the employee snapshot disclosure test.

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts --grep "reference-style flat table|keeps rows compact|automatically opens and focuses"
```

Expected: FAIL because the flat table and reference button do not exist.

- [ ] **Step 3: Create `PerformanceReviewTable.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { normalizeDisplayedWeightTotal } from '../indicator-weight';
import type { PerformanceIndicatorRow } from './PerformanceIndicatorList.vue';

export interface PerformanceReviewColumn {
  key: 'indicator' | 'weight' | 'description' | 'primary' | 'secondary';
  label: string;
  width: string;
}

const props = withDefaults(defineProps<{
  rows: PerformanceIndicatorRow[];
  columns: PerformanceReviewColumn[];
  invalidIndicatorIds?: string[];
  weightTotal?: number;
}>(), {
  invalidIndicatorIds: () => [],
  weightTotal: undefined,
});

const rootRef = ref<HTMLElement>();
const gridColumns = computed(() => props.columns.map((column) => column.width).join(' '));
const total = computed(() => props.weightTotal ?? props.rows.reduce(
  (sum, row) => sum + Number(row.weight || 0), 0,
));
const displayedTotal = computed(() => normalizeDisplayedWeightTotal(total.value));

watch(
  () => JSON.stringify([props.invalidIndicatorIds, props.rows.map((row) => row.id)]),
  async () => {
    const firstId = props.invalidIndicatorIds.find((id) => props.rows.some((row) => row.id === id));
    if (!firstId) return;
    await nextTick();
    const row = rootRef.value?.querySelector<HTMLElement>(
      `[data-indicator-row-id="${CSS.escape(firstId)}"]`,
    );
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  },
  { immediate: true, flush: 'post' },
);
</script>

<template>
  <section ref="rootRef" class="performance-review-table" data-testid="performance-review-table">
    <div class="performance-review-table__head" :style="{ gridTemplateColumns: gridColumns }" role="row">
      <span v-for="column in columns" :key="column.key" role="columnheader">{{ column.label }}</span>
    </div>
    <article
      v-for="(row, index) in rows" :key="row.id"
      class="performance-review-table__row"
      :class="{ 'is-invalid': invalidIndicatorIds.includes(row.id) }"
      :data-testid="`indicator-row-${row.id}`"
      :data-indicator-row-id="row.id"
      tabindex="-1"
    >
      <div class="performance-review-table__cells" :style="{ gridTemplateColumns: gridColumns }" role="row">
        <div
          v-for="column in columns" :key="column.key"
          class="performance-review-table__cell"
          :data-column="column.key" :data-label="column.label" role="cell"
        >
          <slot :name="`cell-${column.key}`" :row="row" :index="index" />
        </div>
      </div>
      <div :data-testid="`indicator-details-${row.id}`" class="performance-review-table__extra">
        <div v-if="row.rejectionReason" class="performance-review-table__rejection">
          <strong>驳回原因</strong><span>{{ row.rejectionReason }}</span>
        </div>
        <slot name="row-extra" :row="row" :index="index" />
      </div>
    </article>
    <footer class="performance-review-table__total" data-testid="indicator-weight-total">
      <span>权重</span><strong>{{ displayedTotal.percentText }}</strong><span>/100%</span>
    </footer>
  </section>
</template>
```

Add the flat desktop grid and labeled mobile rows:

```css
.performance-review-table { min-width: 0; container: performance-review / inline-size; }
.performance-review-table__head,
.performance-review-table__cells { display: grid; min-width: 0; column-gap: 20px; }
.performance-review-table__head {
  min-height: 38px; align-items: center; color: #8791a3; font-size: 13px;
}
.performance-review-table__row { border-top: 1px solid #edf0f5; outline: none; }
.performance-review-table__cells { align-items: start; padding: 16px 0; }
.performance-review-table__cell { min-width: 0; overflow-wrap: anywhere; }
.performance-review-table__row.is-invalid { box-shadow: inset 3px 0 #e34d59; }
.performance-review-table__total {
  display: flex; justify-content: flex-end; gap: 5px;
  padding: 14px 0 0; border-top: 1px solid #edf0f5;
}
@container performance-review (max-width: 720px) {
  .performance-review-table__head { display: none; }
  .performance-review-table__cells { display: block; padding: 12px 0; }
  .performance-review-table__cell {
    display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 8px;
  }
  .performance-review-table__cell + .performance-review-table__cell { margin-top: 10px; }
  .performance-review-table__cell::before {
    content: attr(data-label); color: #8791a3; font-size: 12px;
  }
}
```

- [ ] **Step 4: Compose the goal-review columns and move existing editors into cells**

```ts
import PerformanceReviewTable, {
  type PerformanceReviewColumn,
} from './PerformanceReviewTable.vue';

const referenceOpen = ref(false);
const goalReviewColumns: PerformanceReviewColumn[] = [
  { key: 'indicator', label: '名称', width: 'minmax(180px, 1fr)' },
  { key: 'weight', label: '权重', width: '80px' },
  { key: 'description', label: '指标描述', width: 'minmax(260px, 1.45fr)' },
  { key: 'primary', label: '对齐', width: 'minmax(170px, .85fr)' },
  { key: 'secondary', label: '可见范围', width: 'minmax(190px, .9fr)' },
];
```

Use the component like this, preserving all current model bindings:

```vue
<PerformanceReviewTable
  :rows="reviewRows" :columns="goalReviewColumns"
  :invalid-indicator-ids="indicatorIdsToReveal" :weight-total="totalWeight"
>
  <template #cell-indicator="{ index }">
    <div class="goal-review-cell goal-review-cell--name">
      <span class="goal-review-cell__index">{{ index + 1 }}</span>
      <el-input v-if="isReviewable" v-model="draftIndicators[index].name"
        @input="markDirty(draftIndicators[index].id)" />
      <strong v-else>{{ draftIndicators[index].name || '未命名指标' }}</strong>
    </div>
  </template>
  <template #cell-weight="{ index }">
    <el-input-number v-if="isReviewable"
      :model-value="Number((draftIndicators[index].weight * 100).toFixed(2))"
      :min="0" :max="100" :step="5" :precision="2" controls-position="right"
      @update:model-value="setWeightPercent(draftIndicators[index], $event)" />
    <span v-else>{{ Number((draftIndicators[index].weight * 100).toFixed(2)) }}%</span>
  </template>
  <template #cell-description="{ index }">
    <div class="goal-review-cell__stack">
      <el-input v-if="isReviewable" v-model="draftIndicators[index].description"
        type="textarea" :rows="2" @input="markDirty(draftIndicators[index].id)" />
      <p v-else>{{ draftIndicators[index].description || '-' }}</p>
      <label><span>考核维度</span><el-input v-model="draftIndicators[index].dimensionName"
        :disabled="!isReviewable" @input="markDirty(draftIndicators[index].id)" /></label>
      <label><span>目标值</span><el-input v-model="draftIndicators[index].targetValueText"
        :disabled="!isReviewable" @input="markDirty(draftIndicators[index].id)" /></label>
      <label><span>单位</span><el-input v-model="draftIndicators[index].unit"
        :disabled="!isReviewable" @input="markDirty(draftIndicators[index].id)" /></label>
      <label><span>评分标准</span><el-input v-model="draftIndicators[index].scoringStandard"
        :disabled="!isReviewable" @input="markDirty(draftIndicators[index].id)" /></label>
      <label><span>数据来源</span><el-input v-model="draftIndicators[index].dataSource"
        :disabled="!isReviewable" @input="markDirty(draftIndicators[index].id)" /></label>
      <label><span>完成口径</span><el-input v-model="draftIndicators[index].dataCaliber"
        :disabled="!isReviewable" @input="markDirty(draftIndicators[index].id)" /></label>
    </div>
  </template>
  <template #cell-primary="{ row }">
    <span>{{ row.alignedObjectives?.map((objective) => objective.title).join('、') || '-' }}</span>
  </template>
  <template #cell-secondary="{ index }">
    <IndicatorVisibilityEditor v-if="isReviewable"
      :model-value="{
        visibilityScope: draftIndicators[index].visibilityScope,
        visibleDepartmentIds: draftIndicators[index].visibleDepartmentIds,
        visibleUserIds: draftIndicators[index].visibleUserIds,
      }"
      :indicator-id="draftIndicators[index].id" :departments="departments" :users="users"
      :disabled="busy" @update:model-value="updateVisibility(index, $event)" />
    <span v-else>{{ reviewRows[index].visibilityScope }}</span>
  </template>
</PerformanceReviewTable>
```

The retained compact fields use the existing exact `v-model` and `markDirty()` calls:

```vue
<el-input v-model="draftIndicators[index].dimensionName"
  @input="markDirty(draftIndicators[index].id)" />
<el-input v-model="draftIndicators[index].targetValueText"
  @input="markDirty(draftIndicators[index].id)" />
<el-input v-model="draftIndicators[index].unit"
  @input="markDirty(draftIndicators[index].id)" />
<el-input v-model="draftIndicators[index].scoringStandard"
  @input="markDirty(draftIndicators[index].id)" />
<el-input v-model="draftIndicators[index].dataSource"
  @input="markDirty(draftIndicators[index].id)" />
<el-input v-model="draftIndicators[index].dataCaliber"
  @input="markDirty(draftIndicators[index].id)" />
```

Move reference information to a drawer so the table stays wide:

```vue
<el-button data-testid="goal-review-reference-open" @click="referenceOpen = true">参考信息</el-button>
<el-drawer v-model="referenceOpen" title="参考信息" size="min(420px, 92vw)">
  <PerformanceReferencePanel
    :cycle-id="task.cycleId" :employee-id="task.employeeId"
    :indicators="task.indicatorInstances" :flow-records="task.flowRecords"
  />
</el-drawer>
```

Style `.goal-review` as one white 14px-radius card with 16–20px padding and no nested card border.

- [ ] **Step 5: Re-run all goal-review workspace contracts**

```powershell
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts --grep "goal review|full-page manager workspace"
```

Expected: PASS, including the unchanged employee disclosure contract.

- [ ] **Step 6: Commit the goal-review task**

```powershell
git add -- web/src/views/task/components/PerformanceReviewTable.vue web/src/views/task/components/GoalReviewWorkspace.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "style(web): flatten manager goal review table"
```

---

### Task 3: Apply the same table geometry to manager scoring

**Files:**
- Modify: `web/src/views/task/components/ManagerEvaluationWorkspace.vue`
- Test: `web/e2e/specs/10-team-performance-contract.spec.ts`

**Interfaces:**
- Consumes: `PerformanceReviewTable.vue`, current `draftIndicators`, `summaryForm`, `canEdit`, handlers, validation ids, and attachment state.
- Produces: columns “名称 / 权重 / 指标描述 / 员工自评 / 主管评分” and `manager-evaluation-summary-card`.

- [ ] **Step 1: Add the failing manager-scoring layout contract**

```ts
test('manager evaluation shares the flat shell but shows scoring-specific columns', async ({ page }) => {
  await mockManagerEvaluationWorkspace(page);
  await page.goto('/tasks?scope=team&stage=manager-eval&taskId=task-2');

  const table = page.getByTestId('performance-review-table');
  for (const label of ['名称', '权重', '指标描述', '员工自评', '主管评分']) {
    await expect(table.getByRole('columnheader', { name: label })).toBeVisible();
  }
  await expect(page.getByTestId('manager-score-ind-1')).toBeVisible();
  await expect(page.getByTestId('manager-comment-ind-1')).toBeVisible();
  await expect(page.getByTestId('indicator-toggle-ind-1')).toHaveCount(0);
  await expect(page.getByTestId('manager-evaluation-summary-card')).toBeVisible();
});
```

Remove manager-only toggle/expand clicks from existing tests while retaining draft bodies, score validation, extra scores, submit, withdrawal, dirty guards, total, and grade assertions.

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts --grep "shares the flat shell|shows self evidence beside editable manager fields"
```

Expected: FAIL because the manager workspace still uses disclosure rows.

- [ ] **Step 3: Define manager columns and map the current fields**

```ts
import PerformanceReviewTable, {
  type PerformanceReviewColumn,
} from './PerformanceReviewTable.vue';

const managerEvaluationColumns: PerformanceReviewColumn[] = [
  { key: 'indicator', label: '名称', width: 'minmax(170px, .9fr)' },
  { key: 'weight', label: '权重', width: '72px' },
  { key: 'description', label: '指标描述', width: 'minmax(230px, 1.15fr)' },
  { key: 'primary', label: '员工自评', width: 'minmax(230px, 1.1fr)' },
  { key: 'secondary', label: '主管评分', width: 'minmax(280px, 1.35fr)' },
];
```

```vue
<PerformanceReviewTable
  :rows="evaluationRows" :columns="managerEvaluationColumns"
  :invalid-indicator-ids="validationIndicatorIds"
>
  <template #cell-indicator="{ row, index }">
    <div class="manager-cell manager-cell--name">
      <span class="manager-cell__index">{{ index + 1 }}</span><strong>{{ row.name }}</strong>
    </div>
  </template>
  <template #cell-weight="{ row }">
    <span>{{ Number((row.weight * 100).toFixed(2)) }}%</span>
  </template>
  <template #cell-description="{ row }">
    <p>{{ row.description || '-' }}</p>
    <small>评分标准：{{ row.scoringStandard || '-' }}</small>
  </template>
  <template #cell-primary="{ index }">
    <div class="evaluation-column evaluation-column--self">
      <strong>{{ draftIndicators[index].selfScore ?? '-' }} 分</strong>
      <p :data-testid="`employee-self-comment-${draftIndicators[index].id}`">
        {{ draftIndicators[index].selfComment || '-' }}
      </p>
    </div>
  </template>
  <template #cell-secondary="{ index }">
    <section class="evaluation-column is-manager" aria-label="主管评价">
      <label><span>主管评分</span><input class="manager-field manager-field--score"
        type="number" min="0" max="100" step="0.1" inputmode="decimal"
        :value="draftIndicators[index].managerScoreInput ?? ''"
        :data-testid="`manager-score-${draftIndicators[index].id}`"
        :disabled="!canEditForm" @input="handleScoreInput(draftIndicators[index], $event)"></label>
      <label><span>主管评语</span><textarea class="manager-field manager-field--comment"
        rows="3" maxlength="500" :value="draftIndicators[index].managerCommentInput"
        :data-testid="`manager-comment-${draftIndicators[index].id}`"
        :disabled="!canEditForm" @input="handleCommentInput(draftIndicators[index], $event)" /></label>
      <el-button v-if="canEditForm" text type="primary" :icon="Plus"
        :data-testid="`manager-extra-add-${draftIndicators[index].id}`"
        @click="addExtraScore(draftIndicators[index])">添加加减分</el-button>
    </section>
  </template>
  <template #row-extra="{ index }">
    <section v-if="draftIndicators[index].extraScoresInput.length"
      class="manager-row-extras" aria-label="加减分明细">
      <div v-for="(extra, extraIndex) in draftIndicators[index].extraScoresInput"
        :key="`${draftIndicators[index].id}-${extraIndex}`" class="manager-extra-row">
        <label><span>原因</span><input class="manager-field" type="text" maxlength="200"
          :value="extra.label"
          :data-testid="`manager-extra-reason-${draftIndicators[index].id}-${extraIndex}`"
          :disabled="!canEditForm" @input="handleExtraReasonInput(extra, $event)"></label>
        <label><span>分值</span><input class="manager-field" type="number" step="0.1"
          inputmode="decimal" :value="Number.isFinite(extra.value) ? extra.value : ''"
          :data-testid="`manager-extra-value-${draftIndicators[index].id}-${extraIndex}`"
          :disabled="!canEditForm" @input="handleExtraValueInput(extra, $event)"></label>
        <el-button v-if="canEditForm" text circle type="danger" :icon="Delete"
          :aria-label="`删除第 ${extraIndex + 1} 条加减分`"
          @click="removeExtraScore(draftIndicators[index], extraIndex)" />
      </div>
    </section>
  </template>
</PerformanceReviewTable>
```

For the moved score/comment controls, preserve the actual bindings:

```vue
<input :value="draftIndicators[index].managerScoreInput ?? ''"
  :data-testid="`manager-score-${draftIndicators[index].id}`"
  @input="handleScoreInput(draftIndicators[index], $event)" />
<textarea :value="draftIndicators[index].managerCommentInput"
  :data-testid="`manager-comment-${draftIndicators[index].id}`"
  @input="handleCommentInput(draftIndicators[index], $event)" />
```

- [ ] **Step 4: Make the summary an independent white card**

Change the existing summary section opening tag from:

```vue
<section class="manager-evaluation__summary" aria-label="综合评价">
```

to:

```vue
<section class="manager-evaluation__summary"
  data-testid="manager-evaluation-summary-card" aria-label="综合评价">
```

Do not change the section's current result header, employee summary fields, manager summary textareas, attachment component, or their test ids.

```css
.manager-evaluation { display: grid; gap: 14px; container: performance-review / inline-size; }
.manager-evaluation__indicators,
.manager-evaluation__summary {
  padding: 16px 18px; border: 0; border-radius: 14px;
  background: #fff; box-shadow: 0 1px 2px rgb(31 45 61 / 4%);
}
.manager-summary-grid {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 24px;
}
@container performance-review (max-width: 760px) {
  .manager-summary-grid { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 5: Run all manager-evaluation workspace contracts**

```powershell
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts --grep "manager evaluation"
```

Expected: PASS for edit/save/clear, validation focus, delayed responses, final submit, read-only totals, withdrawal, dirty navigation, and responsive layout.

- [ ] **Step 6: Commit the manager-evaluation task**

```powershell
git add -- web/src/views/task/components/ManagerEvaluationWorkspace.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "style(web): flatten manager evaluation workspace"
```

---

### Task 4: Lock desktop and mobile geometry

**Files:**
- Modify: `web/src/views/task/components/PerformanceReviewTable.vue`
- Modify: `web/src/views/task/components/GoalReviewWorkspace.vue`
- Modify: `web/src/views/task/components/ManagerEvaluationWorkspace.vue`
- Modify: `web/src/views/task/components/TeamTaskWorkspaceShell.vue`
- Test: `web/e2e/specs/10-team-performance-contract.spec.ts`

**Interfaces:**
- Consumes: class names/test ids introduced in Tasks 1–3.
- Produces: no document overflow at 1440×900 or 390×844, aligned desktop columns, stacked mobile labels, reachable actions.

- [ ] **Step 1: Replace old disclosure responsive assertions**

```ts
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
expect(overflow).toBeLessThanOrEqual(8);

const rowFit = await page.locator('[data-testid^="indicator-row-"]').evaluateAll((rows) =>
  rows.map((row) => ({ clientWidth: row.clientWidth, scrollWidth: row.scrollWidth })),
);
expect(rowFit.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 2)).toBe(true);

if (viewport.name === 'desktop') {
  await expect(page.getByTestId('performance-review-table').locator('[role="columnheader"]'))
    .toHaveCount(5);
} else {
  await expect(page.getByTestId('performance-review-table').locator('[role="columnheader"]'))
    .toBeHidden();
  const rail = await page.locator('.team-task-workspace__members').boundingBox();
  const main = await page.locator('.team-task-workspace__main').boundingBox();
  expect(rail!.y).toBeLessThan(main!.y);
}
```

For each key goal/manager action, call `scrollIntoViewIfNeeded()`, assert it is visible, and assert its bounding box lies inside the viewport.

- [ ] **Step 2: Run responsive tests and observe failures**

```powershell
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts --grep "reference-style|stable indicator dimensions|comparison grids stable"
```

Expected before final tuning: at least one old selector or mobile geometry assertion fails.

- [ ] **Step 3: Apply the minimum CSS required by the geometry checks**

```css
.team-task-workspace__main,
.team-task-workspace__content,
.performance-review-table,
.performance-review-table__row,
.performance-review-table__cell { min-width: 0; }

.performance-review-table__cell,
.performance-review-table__cell p,
.performance-review-table__cell small { overflow-wrap: anywhere; }

.performance-review-table :deep(.el-input),
.performance-review-table :deep(.el-input-number),
.performance-review-table :deep(.el-select) { width: 100%; max-width: 100%; }

@media (max-width: 720px) {
  .goal-review__actions,
  .manager-evaluation__actions { flex-wrap: wrap; justify-content: flex-end; }
}
```

Do not hide business fields to satisfy overflow checks.

- [ ] **Step 4: Run focused visual contracts**

```powershell
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts --grep "goal review|manager evaluation|full-page manager workspace"
```

Expected: PASS with no manager-workspace disclosure assertions; the employee disclosure contract remains PASS.

- [ ] **Step 5: Commit responsive tuning**

```powershell
git add -- web/src/views/task/components/PerformanceReviewTable.vue web/src/views/task/components/GoalReviewWorkspace.vue web/src/views/task/components/ManagerEvaluationWorkspace.vue web/src/views/task/components/TeamTaskWorkspaceShell.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "test(web): lock manager review visual layout"
```

---

### Task 5: Focused verification and real-role visual acceptance

**Files:**
- Verify only; modify a task file only if a focused check exposes a regression.

**Interfaces:**
- Consumes: completed manager shell, goal-review table, manager-evaluation table, existing Docker/live API environment.
- Produces: focused automated evidence and fresh desktop/mobile screenshots for 周强.

- [ ] **Step 1: Run the focused automated suite**

```powershell
cd web
npm run test:contracts -- e2e/specs/10-team-performance-contract.spec.ts e2e/specs/11-navigation-entrypoints.spec.ts
npm run type-check
npm run build
```

Expected: selected contracts pass; type-check and build exit 0.

- [ ] **Step 2: Start current web source against the available live API**

Prefer the existing Docker service if rebuilt from current source. If external registry access blocks rebuilding, run:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174
```

Expected: Vite reports the local URL. Do not claim the old Docker image contains the new styling.

- [ ] **Step 3: Use the in-app browser for 周强 desktop acceptance**

Load the browser-control skill before browser actions, then:

1. Open 绩效待办 → 我的团队的绩效待办 → 指标审核.
2. Open a real employee by name or “处理”.
3. Verify gray page, compact top bar, narrow employee rail, shallow profile, white “考核指标” card, five flat columns, and no disclosure arrow.
4. Edit only a disposable pending draft; otherwise keep acceptance read-only.
5. Return and verify stage/filter/page URL restoration.
6. Open 主管评分. If no pending task exists, use a completed task to verify the same shell, scoring fields, disabled editing, and separate “综合评价” card.

- [ ] **Step 4: Capture desktop/mobile visual evidence**

Capture 1440×900 goal review, 1440×900 manager evaluation, and 390×844 responsive screenshots. Evaluate:

```js
({
  documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  tableVisible: Boolean(document.querySelector('[data-testid="performance-review-table"]')),
  disclosureCount: document.querySelectorAll('[data-testid^="indicator-toggle-"]').length,
  summaryVisible: Boolean(document.querySelector('[data-testid="manager-evaluation-summary-card"]')),
})
```

Expected: `documentOverflow <= 8`, `tableVisible === true`, `disclosureCount === 0` in manager workspaces, and `summaryVisible === true` on manager evaluation.

- [ ] **Step 5: Check repository scope and commit only acceptance fixes**

```powershell
git status --short
git diff --check -- web/src/views/task/components web/e2e/specs/10-team-performance-contract.spec.ts
```

If acceptance required a correction:

```powershell
git add -- web/src/views/task/components/PerformanceReviewTable.vue web/src/views/task/components/GoalReviewWorkspace.vue web/src/views/task/components/ManagerEvaluationWorkspace.vue web/src/views/task/components/TeamTaskWorkspaceShell.vue web/e2e/specs/10-team-performance-contract.spec.ts
git commit -m "fix(web): finish manager review visual alignment"
```

If no correction was required, do not create an empty commit.
