# Employee Archive Actions and Roster V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make archive actions status-specific and replace the vague bulk-action menu with a database-aligned, downloadable roster V2 template while retaining legacy imports.

**Architecture:** Keep the existing employee archive API and review workflow. Extend the Excel adapter to detect and join normalized V2 sheets into the existing parsed-row contract, with the old positional parser as fallback; adjust only the existing employee list action predicates and copy.

**Tech Stack:** NestJS, TypeScript, ExcelJS, Jest, Vue 3, Element Plus, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-employee-archive-actions-roster-v2.md`

## Global Constraints

- Preserve HRM/roster as personnel master data and keep DingTalk identity-only.
- Preserve preview, confirmation, review, permissions and backend archive validation.
- Do not change real employee data or deploy production in this task.
- Keep legacy 81-column imports accepted.
- PC and mobile must use the same eligibility predicates.

## Review Focus

- A V2 workbook whose sheets are reordered still parses by sheet name.
- Multiple contract rows for one employee remain ordered and joined to that employee only.
- A legacy 81-column workbook still parses unchanged.
- An employee with an unfinished application cannot be selected or actioned for archive.
- Switching among all, resigned and archived clears stale selections and exposes only the applicable action.

---

### Task 1: Roster V2 template and parser

**Files:**
- Modify: `api/src/employee-archives/employee-roster.excel.ts`
- Modify: `api/src/employee-archives/employee-roster.excel.spec.ts`
- Modify: `api/src/employee-archives/employee-roster-import.service.ts`

**Interfaces:**
- Consumes: existing `ParsedEmployeeRosterRow` import contract.
- Produces: `buildEmployeeRosterTemplate(): Promise<Buffer>` with four V2 sheets and `parseEmployeeRosterExcel(buffer)` with V2 detection plus legacy fallback.

- [ ] **Step 1: Write failing tests** for the four V2 sheet names and headers, V2 employee/employment/contract joining, contract order, and legacy fallback.
- [ ] **Step 2: Run** `npm test -- employee-roster.excel.spec.ts --runInBand` in `api`; expect V2 assertions to fail because only the legacy sheet exists.
- [ ] **Step 3: Implement** V2 template generation, named-sheet parsing and legacy fallback; extend parsed contracts with optional signing company/effective date and preserve fallback behavior in the import service.
- [ ] **Step 4: Run** `npm test -- employee-roster.excel.spec.ts --runInBand`; expect all tests to pass.
- [ ] **Step 5: Commit** the API and test changes.

### Task 2: Status-specific archive actions and explicit roster import

**Files:**
- Modify: `web/src/views/admin/UserManageView.vue`
- Modify: `web/e2e/specs/54-personnel-resignation-archive.spec.ts`

**Interfaces:**
- Consumes: existing category state, current applications and archive/import APIs.
- Produces: shared archive eligibility predicates used by PC and mobile actions.

- [ ] **Step 1: Update the focused Playwright test first** to require no archive action/selection on “全部”, archive only on “已离职”, restore only on “已归档”, a direct “导入花名册” button, no “批量操作”, and “下载花名册模板” in the import dialog.
- [ ] **Step 2: Run** the focused Playwright spec; expect failure on the current disabled “归档” button and bulk-action dropdown.
- [ ] **Step 3: Implement** the minimal computed predicates, conditional selection/actions and revised copy while preserving APIs and permissions.
- [ ] **Step 4: Run** the focused Playwright spec; expect it to pass.
- [ ] **Step 5: Commit** the Web and E2E changes.

### Task 3: Integrated verification

**Files:**
- Verify only; fix only failures caused by Tasks 1–2 using RED→GREEN tests.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: build and regression evidence.

- [ ] **Step 1: Run** the employee roster Excel and import service Jest suites.
- [ ] **Step 2: Run** `npm run build` in `api`.
- [ ] **Step 3: Run** `npm run type-check` and `npm run build` in `web`.
- [ ] **Step 4: Run** the focused Playwright spec at 1440×900, 1024×768 and 390×844 coverage already contained in the spec.
- [ ] **Step 5: Review** the complete diff against the spec and record implementation, commit, push, deployment and acceptance as separate states.
