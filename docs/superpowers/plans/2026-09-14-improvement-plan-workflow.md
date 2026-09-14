# Improvement Plan Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved independent performance improvement plan workflow on `main` and release API/Web safely.

**Architecture:** Extend the existing improvement plan record without rewriting legacy rows. Store new goal and evaluation snapshots on the plan, and append every action to the existing audit log. Resolve handlers from current HRM organization relationships at each operation; expose role-specific actions from the API and reuse the existing improvement-plan menu.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3/Element Plus, Jest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-14-improvement-plan-workflow.md`

## Global Constraints

- Work on `main`, preserve unrelated untracked files, and keep legacy improvement plan records readable.
- No D-grade/result-publication trigger; no performance score writeback or HR calibration.
- Creation uses organization relationships rather than system role or cycle task assignment.
- User-authorized production release requires backup, rollback images and exact project `kayford-deploy`.

---

### Task 1: Model and trigger

**Files:** `api/prisma/schema.prisma`, a new migration in `api/prisma/migrations`, `api/src/publish/publish.service.ts`, `api/src/publish/publish.service.spec.ts`.

**Interfaces:** The extended `ImprovementPlan` has nullable legacy task/cycle relations, JSON goal/evaluation snapshots, optional plan due date and workflow statuses. Existing rows remain version 1; newly created rows are version 2.

- [ ] Replace the D-grade creation test with an assertion that publishing D does not create a plan; run the focused test and observe it fail.
- [ ] Remove the upsert from publication; run the focused test and observe it pass.
- [ ] Add backward-compatible schema fields and a forward-only SQL migration; validate schema and generate Prisma client.

### Task 2: Workflow API and permissions

**Files:** `api/src/improvement-plans/improvement-plans.service.ts`, controller, DTOs, focused Jest specs, and module wiring.

**Interfaces:** `GET /improvement-plans/eligible-employees`, `GET /improvement-plans/my-pending`, `POST /improvement-plans`, `PATCH /improvement-plans/:id`, `POST /improvement-plans/:id/submit-goals`, `POST /improvement-plans/:id/decide-goals`, `POST /improvement-plans/:id/evaluate`, `POST /improvement-plans/:id/decide-final`; list/detail include authorized actions, scores and operation records.

- [ ] Write failing tests for creator scope, optional cycle, repeated same-cycle plans, goal confirmation loops, score calculation, transfer-time evaluators, same-person bypass, final rejection route, HR read-only access and concurrent stale status.
- [ ] Implement the smallest service and DTO changes that pass the focused tests. Keep legacy rows read-only in the new interface.
- [ ] Run focused tests, full API tests, Prisma validation and API build.

### Task 3: User interface and workbench

**Files:** `web/src/types/api.types.ts`, `web/src/types/enums.ts`, `web/src/api/improvement-plans.api.ts`, list/detail views, `web/src/views/dashboard/DashboardTaskEntries.vue`, and focused Playwright spec.

**Interfaces:** The list provides role-filtered records and creation; detail displays creation, goal confirmation, evaluations, final review and time-ordered audit history. Dashboard pending entries open the specific plan independent of cycle status.

- [ ] Write a failing Playwright case for role-appropriate creation and workbench action, including mobile layout.
- [ ] Implement list/detail forms with field-adjacent errors, draft/submit actions, per-goal weighted scoring and operation history.
- [ ] Implement dashboard pending summary from the new API and direct links.
- [ ] Run Web type-check/build and the focused Playwright spec.

### Task 4: Release and verification

**Files:** Only release evidence documentation if needed; no production secrets or backups in Git.

- [ ] Review the complete spec against implementation and run relevant verification once after final changes.
- [ ] Commit only task files on `main`, run `git diff --cached --check`, push, and confirm `HEAD == origin/main`.
- [ ] Check production revision, migrations, external health and `ENABLE_TEST_QUICK_LOGIN=false`; back up the PostgreSQL database and tag current API/Web images.
- [ ] Apply migration, build candidate API/Web and recreate only those two services in `kayford-deploy`.
- [ ] Verify migration state, external API/Web health, role access and unchanged PostgreSQL/Redis/MinIO containers. Report deployed revision separately from business acceptance.
