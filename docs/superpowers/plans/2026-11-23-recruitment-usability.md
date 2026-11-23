# Recruitment usability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** HR can work by application and next action; new interviews are associated correctly, unsaved work is recoverable, disabled DingTalk stays disabled, and confirmed test recruitment data is cleaned safely.

**Architecture:** Extend existing recruitment/interview services and route. Reuse current data models, guards, workflow transitions and audits. No new approval or notification system, no migration expected. Isolated fictional validation and separately authorized production cleanup.

**Tech Stack:** NestJS/Prisma/PostgreSQL, Vue3/Element Plus, Jest/Playwright.

**Spec:** docs/superpowers/specs/2026-11-23-recruitment-usability-design.md

## Constraints and review focus

- Branch codex/recruitment-usability from origin/main49ad68ce, reuse current linked worktree; do not alter unrelated WIP or pending payroll code.
- Calendar/external notifications remain off, no real invitations or meeting API calls. No production code deployment without new release instruction.
- Ordinary participants cannot obtain talent library, other feedback, full-queue or hiring-confirm permissions. Only existing HR talent readers get the corresponding full/owned queues.
- Queries must filter/count before pagination; cancelled/completed are not upcoming; waiting own feedback requires a current eligible participant and an open feedback stage.
- Two applications for one person must not share selected interview context. Old unassociated records remain explicitly historical.
- Closing/switching during save must not discard input. Refresh after409 must replace the concurrency token while preserving local input; reauthorize changed stage/participants.
- Ending an application must warn about outstanding interviews without cancelling them or creating mandatory feedback gates.

## Task 1: Authorized application/interview work queues (root)

Files: recruitment/interview controllers/services and DTOs, web API/types, TalentInterviewView.vue; new queue tests.

Interfaces:
- GET `/talent-recruitment/applications`: keyword, scope owned/all, stage, page/pageSize; Paginated minimal items(id,candidateId,candidateName,positionName,recruitmentBatch,stage,ownerId,ownerName,departmentNameSnapshot,expectedEntryDate,updatedAt,nextInterview).
- GET `/talent-interviews/queue`: keyword, scope mine/created/responsible/all, view upcoming/feedback/history/all, day, status, page/pageSize; Paginated existing TalentInterviewView items.
- Existing candidate-specific interview list remains array-compatible; adds optional applicationId for precise selection. New create requires applicationId; historical update preserves null.
- Application detail adds optional `activitySummary: { scheduledCount:number; unsubmittedFeedbackCount:number }` only for HR readers.
- InterviewView adds optional own feedback state for list actions, without exposing other participants' feedback.

- [x] Add failing permission, count-before-page, owner handoff, own-feedback and application-association tests.
- [x] Implement queries and minimal API types; keep old detail endpoints/role checks.
- [x] Build HR two-tab work page with shared page/query/list/pagination and mobile cards; ordinary interviewer remains scoped to own interviews.
- [x] Verify targeted API and Web checks.

## Task 2: Safe application/interview editing and clear detail (UI implementer)

Owned files: TalentDetailDrawer.vue, TalentApplicationPanel.vue, TalentInterviewPanel.vue, TalentInterviewFeedback.vue, TalentInterviewContent.vue, TalentHiringReviewView.vue, new local unsaved composable/tests. Do not edit root API/types/new page.

- [x] Reproduce reset/close bugs in component/browser regression before fixes.
- [x] Shared leave protection, saving guards, keep-input conflict refresh, route/back protection; no unnecessary autosave writes.
- [x] Detail exposes `prepareToLeave():Promise<boolean>`; current application selection notifies interview panel, new interview uses chosen application; profiles/history less intrusive.
- [x] Show outstanding activitySummary before ending/submitting, preserving allowedActions; clearer stage labels and next steps.
- [x] Invite template and visibility labels, disabled integration explanation once, no retry when unconfigured; early completion warning.
- [x] Cover mobile detail/hiring actions and meaningful targeted regressions.

## Task 3: Confirmed production test cleanup (root, independent data operation)

- [ ] Inventory candidates and owned rows; classify named records with user before deletion.
- [ ] Produce exact ID/version/relation manifest and protected backup; exclude linked formal employee/onboarding histories from deletion.
- [ ] Rehearse narrow transaction and preserve untouched business-table digests; no external sends or blob deletion.
- [ ] Execute only confirmed batch, audit and recheck production flags, remaining records and formal data preservation. Do not equate soft candidate deletion with complete interview cleanup.

## Task 4: Integrated validation and fixed preview

- [x] Review UI task for spec and quality; fix substantive findings.
- [x] Full API, API build, Web build; final independent whole-branch review.
- [x] Real isolated backend: HR application→interview→own feedback; ordinary-role denial; two positions; stale version recovery; closed integration. Hiring handoff retains its existing workflow and mock coverage; no new claim of full real onboarding acceptance.
- [x] PC1440/1024/mobile390, back/close/switch while dirty, pagination/query preservation, no duplicate invites or external side effects.
- [ ] Commit only task files and deliver fixed localhost5173 preview; separately report cleanup and code/release/acceptance status.

## Execution ledger

- Ruling: the user approved the complete review recommendations; use that approved scope as design, no repeated design permission. One UI implementer can work against the documented API contracts while root owns API/page/data; independent review follows.
- Current production test classification question pending: seven visible real-name candidates cannot be inferred test-only by name; two already-deleted candidates have employee links and are excluded from automatic personnel cleanup.

- Final validation: API254 suites/5058 tests, related139 tests, API/Web builds and Web types passed. Mock UI14/14 passed separately. Actual-PG checks and real-backend PC1440/1024 plus affected mobile390 checks passed; mobile test-only navigation assumption corrected, no product change. Independent review accepted three substantive corrections (transformed DTO offsets, stable application selection, early-completed feedback).
- Validation fixtures removed with zero owned users/employment/candidates/applications remaining; calendar/pending/external notifications zero. Temporary API/proxy and private runtime env copy removed; no shared5173 or production change.
- Remaining: exact production test identities and shared5173 coordination await user answers. Keep branch without main merge or deployment; cleanup cannot infer real-name candidates are tests. Fixed preview delivery and production cleanup are explicitly incomplete.

## Release completion

User confirmed deletion of the listed seven production test candidates and explicitly authorized release. c47e2727 integrates latest production payroll; full API258/5190 and Linux139 passed, final images built. Protected backup/rollback rehearsal and narrow cleanup complete;7candidates/7applications/10interviews removed with2employee-linked histories preserved. Deployed API/Web only, external smoke7HTTP+4PC/mobile pages passed; all91 post-cleanup digests unchanged after release. Calendar/messages remain off. Explicit direct release replaces pending fixed-preview delivery;5173 untouched. See acceptance/2026-11-23-recruitment-usability-release.md.
