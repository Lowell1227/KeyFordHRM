# Recruitment Demand Closure Implementation Plan

> **For agentic workers:** Use executing-plans or subagent-driven-development. Preserve existing uncommitted work. Development and fictional isolated acceptance only; no commit, push, production deployment, grants or platform writes.

**Goal:** Submit hiring only after a fresh authoritative source check, explicitly terminate an accepted offer once, and let HR navigate demand counts to the exact application and original onboarding flow.

**Architecture:** Keep Nest/Prisma recruitment, per-application events and existing candidate/application locks. Remote source verification happens before the submission transaction; the transaction then rechecks current actor, application, demand revision/scope/mapping and proof freshness. No second workflow, notifications or quota-block policy.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue3/Element Plus, Playwright.

**Spec:** User-approved addition forwarded on 2026-11-25 by the requirements conversation; previous first-batch scope remains in `docs/requirements/2026-11-24-recruitment-planning-closure.md`.

## Constraints And Review Focus

- Verify the reported source-withdrawal and missing-termination defects with fictional data before changing behavior. Previous 4/4 independent UI and 36 direct Web results are historical evidence, not final results for these changes.
- Do not wait for network IO while holding a submission transaction or shared ledger lock. Failure, permission denial, timeout, changed mapping and known/verified replacement must not create a successful application submission.
- Official old-instance detail is not proof that no successor exists. Verify available official fields and a bounded refresh mechanism; distinguish complete evidence from unproven coverage and block rather than claim certainty.
- Only actual acceptance occupies, only explicit offer termination releases. Canceling an onboarding attempt, delay or ordinary return never releases. Arrival cannot be undone by termination; active onboarding must first follow the existing authorized cancellation flow.
- Keep hiring confirmation independent. Do not grant edit to readers/confirmers; a current editor may terminate old withdrawn-but-occupied applications explicitly with reason and audit, not in a batch.
- HRM master data stays authoritative. No auto overwrite from DingTalk. No full-quota block, automatic closing/reminders, Excel import, new Offer approval or external sends.

## Work Packages

### 1. Reproduction And Fresh Submission (Parent)

Files: `recruitment-demands.service.ts/.spec.ts`, `recruitment-demands.types.ts`, `talent-recruitment.service.ts/.spec.ts`, relevant API wiring and DTO integration.

- [x] Reproduce local-cache acceptance of an upstream withdrawal and missing termination.
- [x] Write direct regression cases; prepare fresh source proof outside all submission locks, persist source invalidation separately, and validate proof/local versions inside the application transaction.
- [x] Cover changed/replaced/wrong-scope sources, unavailable/permission/timeout, stale app/actor/catalog and no successful submission side effects. Preserve input and historical snapshots.

### 2. Official Read-only Contract (A)

Files: DingTalk recruitment adapter/source tests and upstream evidence. Verify official successor metadata and exact form scope, implement bounded verification without broad platform access. No true record query until separately authorized. Record the requirements chat's exact-form 403 as attributed evidence, not a new successful probe.

- [x] Return a minimal verified-source/related-source contract and explicitly state replacement-coverage limits.
- [x] TDD adapter implementation, shared whole-operation deadline and sanitized failures.
- [x] Document minimal `Workflow.Instance.Read` plus form data range and one authorized-record acceptance steps; no rights changes or another form fallback.

### 3. Termination And Demand Progress (B + Parent)

Files: existing policy and tests (B); action service/DTO/audit integration (Parent); new narrowly scoped demand-application query service/tests (B), controller/module wiring (Parent).

- [x] Add `terminate_offer` eligibility from actual latest acceptance/termination events, including old withdrawn applications; replace ambiguous withdrawal for occupied offers.
- [x] Require reason, current revision/edit rights, no active or effective onboarding, and same original locks; exactly one release/event under retries/concurrency, no hired release.
- [x] Add paginated safe application projections for awaiting reply, accepted pending arrival, terminated and hired; counts and linked rows agree without leaking contact/resume/pay data.

### 4. UI And Isolated Acceptance (C + D)

Files: existing Web recruitment/detail/actions, API/types and direct tests (C); real HTTP/bootstrap/E2E (D).

- [x] Required reason and second confirmation for termination; server-owned allowed actions, precise next step for active onboarding, explicit version failure with retained inputs.
- [x] Demand detail exposes four stage categories, safe pagination and exact application/onboarding links through existing permissions.
- [x] Real HTTP/PG and PC/mobile: no-demand early stages, fresh source withdrawal before submit, demand/app/permission races, independent confirmation, accept, cancel/retry, explicit terminate/retry/concurrency, new application/reaccept and arrival retained.
- [x] Freeze API once, run strict full API and build, final Web check/build and focused real-page acceptance. Preserve first failures and original fictional payroll baseline.
- [x] Deliver same localhost:5173 preview and fresh evidence; separately state implemented, committed, deployed and business-accepted. Later user authorization permits preparing release, but the real DingTalk 403/scope and usable-demand gates prevent a production switch.

## Release Follow-up

The user subsequently authorized completion and release preparation. Keep production unchanged while real target-form access, field/successor-scope acceptance and usable approved demands remain unverified. Prepare the fixed main commit, API/Web images and rollback references; restore and migration rehearsal passed on an offline disposable copy, not production. See `docs/acceptance/2026-11-25-recruitment-demand-closure.md` for final evidence and release gates. No platform permission change is implied by release authorization.
