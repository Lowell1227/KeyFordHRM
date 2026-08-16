# Goal Tracking Cycle Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the goal-tracking cycle selector show only the five existing formal quarterly cycles with reference-style Chinese labels and newest-first order.

**Architecture:** Keep the shared cycle API and database untouched. Add a pure goal-tracking cycle read-model function, apply it at the composable boundary, and format option labels in the goal-tracking panel so routing and selection operate only on curated cycles.

**Tech Stack:** Vue 3, TypeScript, Playwright.

## Global Constraints

- Scope is limited to the goal-tracking page.
- Do not create 2025 Q2 or 2025 Q1 data.
- Do not delete or mutate validation cycles or their relations.
- Preserve existing lifecycle, stale-response, route history, deep-link, loading, retry, and responsive behavior.

---

### Task 1: Define the curated cycle read model

**Files:**
- Modify: `web/src/views/objectives/goal-tracking.ts`
- Test: `web/e2e/specs/12-goal-tracking-model.spec.ts`

**Interfaces:**
- Produces: `selectGoalTrackingCycles(cycles: AssessmentCycle[]): AssessmentCycle[]`
- Produces: `formatGoalTrackingCycleName(cycle: AssessmentCycle): string`

- [ ] **Step 1: Write the failing model test**

Add a test that supplies canonical `2026-Q3`, `2026-Q2`, `2026-Q1`, historical 2025 Q4/Q3, a duplicate 2026 Q1 demo row, annual data, and validation/debug rows. Assert the selected IDs are the five canonical rows in descending order and labels are `2026 第三季度` through `2025 第三季度`.

- [ ] **Step 2: Run the model test and verify RED**

Run:

```powershell
npx playwright test e2e/specs/12-goal-tracking-model.spec.ts --config playwright.contract.config.ts --workers=1
```

Expected: FAIL because the two exported functions do not exist.

- [ ] **Step 3: Implement the pure functions**

Parse only `YYYY-Qn` and `YYYY Qn 绩效考核（历史）`, require `quarterly`, de-duplicate by `YYYY-Qn`, prefer the standard name, and sort the selected rows newest first. Format the parsed quarter with Chinese numerals.

- [ ] **Step 4: Run the model test and verify GREEN**

Run the command from Step 2. Expected: all model tests pass.

### Task 2: Apply curation to the page and routing

**Files:**
- Modify: `web/src/views/objectives/use-goal-tracking.ts`
- Modify: `web/src/views/objectives/GoalTrackingIndicatorPanel.vue`
- Test: `web/e2e/specs/09-performance-workspace.spec.ts`

**Interfaces:**
- Consumes: `selectGoalTrackingCycles()` before assigning `cycles.value`.
- Consumes: `formatGoalTrackingCycleName()` in each option label.

- [ ] **Step 1: Write the failing page regression**

Mock `/cycles` with the five formal quarters plus annual and validation rows. Open `/goal-tracking?cycleId=validation-cycle`, then assert the selector exposes exactly the five Chinese labels, excludes validation names, normalizes the URL to the newest formal cycle, and requests tracking with that cycle.

- [ ] **Step 2: Run the focused page test and verify RED**

Run the focused 09 spec against an isolated strict-port Vite instance. Expected: the selector still includes uncurated cycles and keeps the validation cycle.

- [ ] **Step 3: Apply the read model and display formatter**

Filter `page.items` in `loadCycles()` and render `formatGoalTrackingCycleName(cycle)` in the native option. Preserve the existing URL normalization and request guards.

- [ ] **Step 4: Run focused and adjacent regression tests**

Run the new focused test, all of spec 12, and the goal-tracking tests in spec 09. Expected: all pass with zero retries.

- [ ] **Step 5: Verify production quality**

Run:

```powershell
npm run type-check
npm run build
git diff --check
```

Then verify desktop and 390x844 browser behavior: five labels only, cycle switching updates the query and content, legacy hidden-cycle URL normalizes, no horizontal overflow, and no console errors.
