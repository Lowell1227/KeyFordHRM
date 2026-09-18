# Employee Create Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete seven-step employee-create wizard with server-side autosaved drafts that resume at the last step and submit the full archive for HR review.

**Architecture:** Reuse `EmployeeDataChangeRequest` and extend the existing create/draft payload with complete employee, profile, contract, performance, and draft-progress data. Keep the existing identity matching and employee-number reservation path; add a focused Vue wizard while leaving the current archive editor behavior unchanged.

**Tech Stack:** Vue 3, TypeScript, Element Plus, NestJS, Prisma JSON records, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-employee-create-wizard-design.md`

## Global Constraints

- HRM employee archives remain the personnel-data authority; DingTalk organization data is not an input.
- Drafts never reserve employee numbers and never enter the review queue.
- Sensitive values are encrypted in the API and never returned or logged as plaintext.
- Autosave is silent on success and visible on failure.
- Production deployment requires backup, rollback images, focused service replacement, and external verification.

---

### Task 1: Persist complete employee-create drafts

**Files:**
- Modify: `api/src/employee-archives/dto/employee-archive.dto.ts`
- Modify: `api/src/employee-archives/employee-archives.service.ts`
- Test: `api/src/employee-archives/employee-archives.service.spec.ts`

**Interfaces:**
- Consumes: existing `CreateEmployeeDto`, `SaveEmployeeCreateDraftDto`, contract material validators, sensitive-field encryption helpers.
- Produces: optional `employee`, `profile`, `contracts`, `performance`, `draftStep`, and `saveMode` fields persisted in the current review JSON shape.

- [ ] Write a failing Jest test proving a create draft keeps full profile, employment, contract, performance, and current-step data without reserving a number.
- [ ] Run the focused Jest test and verify it fails because the extra data is dropped.
- [ ] Extend DTO validation and draft persistence; encrypt identity/bank values and validate contract materials.
- [ ] Run the focused test and verify it passes.
- [ ] Write a failing Jest test proving final create submission keeps the complete proposed archive and contract materials.
- [ ] Implement the minimal final-submission mapping and allow contract materials for `manual_employee_create` approval.
- [ ] Run employee archive and review service suites.

### Task 2: Add the resumable autosave wizard

**Files:**
- Modify: `web/src/api/employee-archives.api.ts`
- Rewrite: `web/src/views/admin/components/EmployeeCreateDrawer.vue`
- Test: `web/e2e/specs/58-employee-create-wizard.spec.ts`

**Interfaces:**
- Consumes: complete create/draft API payload from Task 1, current draft `proposedValue`, positions API, user selector, upload API.
- Produces: seven-step drawer with `draftMeta.currentStep`, debounced autosave, explicit save-and-exit, identity routing, and final submit.

- [ ] Write a Playwright test that opens the drawer and expects seven steps, complete section fields, and final-step-only submission.
- [ ] Run the test and verify it fails against the single-page form.
- [ ] Implement the seven-step layout and responsive step indicator.
- [ ] Re-run the test and verify navigation passes.
- [ ] Extend the test to enter a name, navigate, intercept autosave, close, reopen the returned draft, and assert the step and values resume.
- [ ] Implement debounced autosave, save-state copy, draft-id capture, and draft reset/restore.
- [ ] Extend the test for position/date autofill and verify manual values are not overwritten.
- [ ] Implement minimal autofill behavior and re-run the test.
- [ ] Extend the test to verify complete final payload, identity lookup, and no success toast for autosave.
- [ ] Implement final payload and contract upload UI; re-run the focused test.

### Task 3: Regression, integration, and release

**Files:**
- Modify only if required by verification findings.

**Interfaces:**
- Consumes: Task 1 API contract and Task 2 wizard.
- Produces: verified `main` commit and production release with rollback evidence.

- [ ] Run API employee archive/review suites and API build.
- [ ] Run Web type-check, production build, existing personnel regression, and the new wizard test at desktop and mobile widths.
- [ ] Review staged files, run `git diff --cached --check`, and commit only task files.
- [ ] Merge to the newest clean `main`, re-run focused checks, push, and confirm `HEAD == origin/main`.
- [ ] Back up production database and preserve current API/Web image tags.
- [ ] Apply migrations if any, replace only changed API/Web services, and keep test quick login disabled.
- [ ] Verify external health, current migration status, loaded Web resource, unauthenticated protection, and the production wizard/draft path using an authorized role where available.
