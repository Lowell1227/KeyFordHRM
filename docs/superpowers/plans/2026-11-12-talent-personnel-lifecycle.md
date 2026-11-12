# Talent and Personnel Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Independent bounded tasks may use superpowers:dispatching-parallel-agents. Steps use checkbox syntax for tracking.

**Goal:** Deliver the approved archive submission, arrival-gated onboarding, entry/exit navigation and simple interview invitation flow.

**Architecture:** Extend the existing modular monolith and personnel requests. Persist invitation participants and synchronization intent, keep Tencent meeting creation manual, and retain existing authorization/data ownership.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Redis, Vue 3, Element Plus, Jest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-12-talent-personnel-lifecycle-design.md (approved 2026-11-12).

## Global Constraints

- Work on the existing main checkout; preserve all pre-existing tracked and untracked changes. No broad staging, reset, cleanup or production deployment.
- HRM is the personnel master; no DingTalk organization synchronization writes.
- Only isolated synthetic databases/identities for new integration checks. No actual invitations, personal account credentials or real employee changes.
- Candidate deletion is soft deletion with explicit impact confirmation, not cascade cancellation.
- Existing production requests retain historical semantics until an authorized inventory/adaptation; new requests require arrival confirmation. No backfilled confirmation identities.
- No new exempt archive fields; manual department merge unchanged.
- Implementation authorization is already explicit. Do not ask the user to reapprove each technical task. No commits containing earlier unrelated changes.

## Review Focus

1. A pending employee becomes active through a read/login/scheduler path rather than the new command: test every projection path.
2. A stale autosave arrives after submission or after switching employees: test generation/version protection and feedback.
3. Deleted candidate still has an active invitation/application: test independent authorized access, no cascade or resurrection.
4. Calendar timeout or stale retries duplicate events or revive cancelled invitations: persist version/claim and quarantine uncertain results.
5. A selected ordinary employee can fetch the whole candidate/resume or an unrelated invite: test HTTP authorization and minimal projections.

## Task 1: Scope memory and additive schema

**Files:** spec above; docs/project-memory.md; api/prisma/schema.prisma; new migration 20261112120000_personnel_arrival_confirmation/migration.sql.

**Interfaces:** EmployeeDataChangeRequest adds requiresArrivalConfirmation:boolean (historical default false), arrivalDate:Date|null, arrivalConfirmedAt:Date|null, arrivalConfirmedById:string|null and talentCandidateId:string|null. Application views expose these fields. TalentCandidate retains linked onboardingRequests.

- [x] Record approved scope without overwriting earlier memory entries.
- [x] Add fields and relation using an additive migration; new-hire/reentry code explicitly opts in.
- [x] Run Prisma validate/generate using a non-production placeholder URL (no migration execution).

## Task 2: Fixed review policy (parent owner)

**Files:** api/src/personnel-config/*; api/src/departments/departments.service.ts and relaxed-mode tests; api/src/positions/positions.service.ts and relaxed-mode tests; web/src/views/system/* configuration view as discovered.

**Interfaces:** GET review-mode returns {mode:'standard'} for compatibility; attempts to enable relaxed return a business error, preserving old audit/config records. Submitted department/position mutations remain pending regardless of stale stored mode. Archive removal coordinated in Task 3.

- [x] Add failing tests proving stale relaxed configuration cannot autoapprove and cannot be enabled.
- [x] Run focused Jest tests and observe failure.
- [x] Remove automatic approval branches; disable configuration mutation and remove visible switch, preserving historical audit.
- [x] Run focused tests and API build; expect no new autoapproval paths.

## Task 3: Arrival-gated onboarding and talent source (backend worker)

**Files:** api/src/employee-archives/** except unrelated archive assistant/import work; targeted new tests.

**Interfaces:** POST /employee-archives/applications/:id/confirm-arrival body {arrivalDate:string, requestVersion:number}, capability employee_archive_review; service confirmArrival(requestId,input,operator) returns application view. CreateEmployeeDto/SaveEmployeeCreateDraftDto and reentry input accept optional talentCandidateId. Candidate source validated/locked server-side, persisted, only one unfinished intake per candidate. Candidate conversion occurs on effective arrival, not arbitrary user selection.

- [x] Add tests for new hire/reentry waiting past date, future/mismatched arrival, permission, cancellation/repeat/version, candidate duplicates/deletion and legacy historical behavior.
- [x] Verify targeted tests; independent-review recovery and real-DB uniqueness failures were observed before their fixes. Earlier worker tests do not retain a consolidated pre-implementation failure log.
- [x] Gate all activation/projection paths, implement transactional confirmation/audit, preserve resignation disablement.
- [x] Remove archive/controller relaxed autoapproval calls; fixed submit responses retain pending outcome for reviewed fields.
- [x] Preserve source through autosave/revision, link completed onboarding to candidate without resurrecting a deleted candidate.
- [x] Run all employee-archive tests and API build; final full API run passes 150 suites / 2102 tests.

## Task 4: Personnel UI and navigation (frontend worker)

**Files:** web/src/views/admin/UserManageView.vue and personnel components; web/src/router/routes.ts; web/src/api/employee-archives.api.ts and related types; personnel notification/workbench routing only as needed.

**Interfaces:** task 3 confirm-arrival endpoint and fields; intake query {talentId:string} (no name/phone URL); fetch candidate by authorized GET /talents/:id then persist talentCandidateId in draft/submit/reentry.

- [x] Preserve existing autosave generation guards; add focused tests for a single Submit button, no manual Save-and-close, no relaxed switch/copy.
- [x] Add Entry/Exit navigation and pending-arrival action, keep pending reviews reachable and old deep links valid.
- [x] Display arrival command for reviewers only; show failure near the form and retain edits.
- [x] Update candidate source handoff and read-only generated fields; distinguish applied/pending submission outcomes.
- [x] Run web type-check/build and 27 targeted tests; isolated real HTTP Playwright covers PC/mobile.

## Task 5: Simple invitations and candidate risk fixes (talent worker)

**Files:** api/src/talent-pool/**; web/src/views/talent/**; web/src/api/talent-pool.api.ts; web/src/types/talent.types.ts; new invitation migration/schema section (coordinate schema ownership before writing).

**Interfaces:** /talent-interviews GET mine, GET :id, POST, PATCH :id, POST :id/cancel, POST :id/complete, POST :id/retry-sync. Inputs include candidateId, startsAt, endsAt, participantIds, invitationText, meetingUrl, note and version for mutations. Invitation schema/model exact fields to be documented before integration. Controller authenticated ordinary users may read only assigned records; existing archive-edit capability controls mutations. Notifications use type talent_interview and link invitationId; parent integrates workbench route.

- [x] Add tests for HTTPS Tencent link validation, participant access, version/cancellation, deletion impact, arbitrary convert rejection, invalid file bind and audit redaction.
- [x] Implement persisted invitation/participants and minimal views; add HR invitation editor/list and participant detail view.
- [x] Implement DELETE candidate impact check and force/impact-version confirmation; retain existing linked processes and snapshots.
- [x] Replace full-phone URL onboarding handoff with talentId and remove arbitrary hired marking. Fix proven file/last-follow-up/audit problems only.
- [x] Persist calendar intent/status and implement transport via documented DingTalk calendar APIs, disabled/unconfigured behavior explicit. No real calls or messages during tests. Unknown results reconcile by read before further writes; missing/multiple matches remain uncertain.
- [x] Run focused talent Jest tests and web type-check; document endpoint/model contracts and exact file list.

## Task 6: Integration and verification (parent)

**Files:** api/test/personnel-lifecycle/*; dedicated Jest config; docs/acceptance/2026-11-12-personnel-lifecycle.md. Real Playwright runs inside the isolated Jest harness against its HTTP server, avoiding the default E2E setup and real development data.

- [x] Wire ordinary participant route/workbench/notification target after task 5 contract exists; preserve all role boundaries.
- [x] Use disposable PostgreSQL/Redis and fake fixtures, disable external transports. Apply migrations only there.
- [x] Test real Nest/JWT/HTTP flow: submit, review, no pre-arrival login, confirm, candidate association, resignation/session denial; interview selected-user allow/unrelated deny; forced deletion keeps linked records.
- [x] Run API full tests/build, Web type-check/build, real-backend Playwright desktop/mobile; take synthetic-data screenshots and inspect overflow.
- [x] Obtain fresh independent code review, repair important findings with tests, and record remaining limitations.
- [x] Update evidence and memory with actual status. No production release or real DingTalk acceptance claimed; ephemeral QA preview is for the harness only, not a persistent user acceptance site.

## Execution Ledger

- 2026-11-12: Design approved. main and remote main a6c28e9. Existing talent implementation and other dirty files preserved; production containers only inspected. Tasks not yet complete.
- 2026-11-12: Approved scope saved in project memory and implementation plan. Fixed-review tests observed failing before implementation, then 7 suites / 52 tests passed. Calendar transport/dispatcher focused tests 2 suites / 12 passed. Disposable loopback QA PostgreSQL and Redis created with isolated anonymous image volumes (no shared volumes or host binds), autoRemove enabled; all 63 migrations applied there only. Initial real HTTP checks verified pending-arrival and candidate deletion retention; arrival duplicate response assertion adjusted to the designed idempotent success, rerun pending.
- 2026-11-12: Isolated integration suite 6/6 passed, including real HTTP, concurrent claims/arrival cancellation, resignation/session disablement and Playwright 1440/1024/390 widths. Browser assertions confirm one Submit, non-effective autosave and participant-only detail. API and Web builds passed at this checkpoint; final reruns follow independent-review fixes. Review found rejected-date editing, repeated intake recovery, cancelled pre-arrival identity recovery, reentry stale employment, stale notifications and uncertain calendar recovery; these are being repaired before closeout.
- 2026-11-12 final local snapshot: API 150 suites / 2102 tests passed; web contracts 27 passed; isolated integration 9/9 passed including desktop/mobile HR arrival, returned-date revision and cancelled first-hire recovery. Prisma validate and all 63 disposable-DB migrations pass; API/Web builds and type-check pass. Real PostgreSQL exposed the one-assignment-per-request uniqueness constraint missed by in-memory tests: renewal now reuses the released slot, allocates a fresh number and retains its snapshot in revision history. New invitation routes are /talent-interviews, preserving /interviews performance interviews. API/Web code remains uncommitted and undeployed; external calendar permission/delivery and real business acceptance remain pending.
