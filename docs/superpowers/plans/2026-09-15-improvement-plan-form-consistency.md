# Improvement Plan Form Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the improvement-plan creation, editing, evaluation, and decision interactions into one compact and role-explicit experience on desktop and mobile.

**Architecture:** Keep the current Vue views and API contracts. Reuse the existing goal cards, decision dialog, validation state, and responsive breakpoints; only rearrange presentation and derive role-specific labels from the existing status.

**Tech Stack:** Vue 3, TypeScript, Element Plus, scoped CSS, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-improvement-plan-form-consistency-design.md`

## Global Constraints

- Do not change API routes, request bodies, database schema, permissions, or workflow states.
- Keep long target and evaluation forms inline; only short approve/return decisions use dialogs.
- Approve dialogs have no input; return dialogs own required feedback validation.
- Keep desktop and 390px mobile layouts free of horizontal overflow.
- Reuse the two existing Vue views and the existing Playwright spec; add no dependency or component abstraction.

---

### Task 1: Unify improvement-plan form hierarchy and actions

**Files:**
- Modify: `web/e2e/specs/52-improvement-plan-workflow.spec.ts`
- Modify: `web/src/views/improvement-plans/ImprovementPlanDetailView.vue`
- Modify: `web/src/views/improvement-plans/ImprovementPlanListView.vue`

**Interfaces:**
- Consumes: existing `ImprovementPlan.status`, `allowedActions`, evaluation snapshots, `saveEvaluation`, `evaluate`, `decideGoals`, and `decideFinal` calls.
- Produces: one page-level current-stage marker, role-explicit submit labels, compact overall evaluation rows, and a two-section creation dialog without changing payloads.

- [x] **Step 1: Write the failing Playwright expectations**

Update the evaluation-layout scenario so it expects exactly one `当前环节 · 部门负责人评价` marker outside repeated goal cards, a `提交部门负责人评价` primary action, and compact overall rows containing `员工自评 82 分 · 员工总体自评` and `直属上级评价 79.2 分 · 直属上级总体评价`. Extend the revision scenario to expect the stable `改进内容与评价` title and `目标制定` stage marker. Extend the creation scenario to expect `基本信息` and `改进目标` section headings and verify that the PC basic-info fields are compact while the 390px viewport has no overflow.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `npm run test:e2e -- --grep "manager can create|initiator sees|evaluation stage"`

Expected: the new title, single stage marker, role-explicit button, evaluation-summary rows, and creation-section assertions fail because the current UI does not expose them.

- [x] **Step 3: Implement the minimal Vue changes**

In `ImprovementPlanDetailView.vue`, derive the current stage label and submit label from the existing status, use `改进内容与评价` as the stable card title, render one compact stage strip above the form, remove the repeated per-goal stage heading, render prior overall evaluation snapshots in a compact summary, and label the submit button with the active role. In `ImprovementPlanListView.vue`, add `基本信息` and `改进目标` headings, group cycle and target date in the existing CSS grid pattern, and retain the current draft payload and inline weight validation.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `npm run test:e2e -- --grep "manager can create|initiator sees|evaluation stage"`

Expected: all selected tests pass, with no horizontal overflow at 390px.

- [x] **Step 5: Run the full improvement-plan and Web checks**

Run: `npm run test:e2e -- --grep "improvement|manager can create|workbench shows|employee can return|initiator sees|operation records|evaluation stage|goal confirmation|final review"`

Run: `npm run type-check`

Run: `npm run build`

Expected: the full improvement-plan spec passes, TypeScript exits 0, and the production build exits 0 apart from already-known dependency/chunk-size warnings.

- [x] **Step 6: Commit only the scoped files**

Run: `git add docs/superpowers/specs/2026-09-15-improvement-plan-form-consistency-design.md docs/superpowers/plans/2026-09-15-improvement-plan-form-consistency.md web/e2e/specs/52-improvement-plan-workflow.spec.ts web/src/views/improvement-plans/ImprovementPlanDetailView.vue web/src/views/improvement-plans/ImprovementPlanListView.vue`

Run: `git diff --cached --check`

Run: `git commit -m "fix(web): unify improvement plan form flow"`

Expected: the commit contains only the two Vue views, the focused Playwright spec, and these two design/plan documents.
