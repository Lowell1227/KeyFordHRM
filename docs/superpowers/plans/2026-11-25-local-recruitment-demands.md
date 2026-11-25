# Recruitment Demands With Two Sources Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development. Preserve concurrent work and validate the integrated result.

**Goal:** Allow approved recruitment demands to originate either in DingTalk or directly in HRM, using the same hiring association, capacity ledger and history.

**Architecture:** Extend the existing demand ledger with an explicit source kind and a small local draft/submission/independent-review lifecycle. DingTalk records retain their authoritative read-only source verification; local records use locked current approval/version checks and never require or impersonate a DingTalk instance.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue 3, Element Plus and existing isolated Playwright preview.

**Spec:** User confirmed two sources and local recruitment operator submission followed by independently authorized reviewer approval, with no self-review. The three named production operators and reviewer are maintained only in controlled account configuration, not source/default fixtures/public documents.

## Design And Scope

- Reuse one list/detail, one set of department/position directories, existing application and onboarding flows, demand snapshots, acceptance occupancy and explicit termination release.
- Add local creation, editable drafts/returned records, explicit submission, independent approval/return and withdrawal with reason. Submitted records are immutable until returned/withdrawn. Approved business fields cannot be overwritten; withdrawal stops future selection without rewriting existing application snapshots or releasing accepted seats.
- Keep DingTalk and local origins immutable. Source-specific refresh/mapping cannot modify local records; no fake external identifiers.
- Local review uses a separately configurable capability, not job title or automatic reuse of hiring-confirm authority. Existing hiring confirmation remains independent and forbids self-review.
- Use request UUID for idempotent local creation; stale revisions fail with input preserved. Local approval is checked again inside hiring submission transaction, ordered with withdrawal and authorization changes.
- No new quota hard limit, annual establishment, Offer generation, external notifications or automatic production data creation.

## Global Constraints

- Strict validation tier: full API tests/build, direct database/HTTP checks and actual PC/mobile preview.
- Fictional fixtures only; no real personnel or wage writes; preserve existing preview payroll data and all other worktrees.
- Product version stays 0.9.2. Production release/permission status must be reported separately from source implementation and technical acceptance.

## Review Focus

- Missing DingTalk configuration must not disable approved local demands or allow external demands to bypass verification.
- Reviewer-only/viewer/editor roles cannot self-grant or invoke unrelated actions, and revoked/inactive users are rechecked after locks.
- Duplicate creation, old revisions and concurrent approve/withdraw/submit must produce one auditable outcome, not duplicate demands or stale approved snapshots.
- Returning/editing/submitting local records must preserve immutable event history; accepted seats and historical submitted snapshots must not be rewritten.
- Network/409 failures preserve entered department, position, count and reason; mobile dialogs and source labels must be usable.

## Task 1: Local Ledger And Submission Safety

**Files:** Prisma schema plus additive migration; recruitment-demands DTO/types/controller/service; new focused local lifecycle service/tests if needed; demand seat/application references and integration tests.

**Interfaces:** `sourceKind: 'dingtalk' | 'local'`; local create `POST /recruitment-demands/local` with `requestId, deptId, positionId, headcount, reason`; local update `PATCH /recruitment-demands/:id/local` adds `expectedRevision`; `POST /recruitment-demands/:id/local-actions` accepts `expectedRevision, action: submit|approve|return|withdraw, reason?`. Views add `requestedHeadcount`, `requestReason`, `createdById`, `submittedById`, `approvedById`, `allowedActions`; external-only IDs/times become nullable for local rows. Source state adds `draft` for local only. Return events/actions use local-specific names.

- [x] Add failing direct tests for local draft/submit/review, source isolation, no-self-review, version conflicts, duplicate request and revoked roles.
- [x] Implement additive schema and lifecycle with existing locks/audits; reject cross-source operations and preserve external checks.
- [x] Verify local-approved hiring works with gateway absent and withdrawal/stale proof is rejected inside transaction; direct integration checks cover both origins. Full API 274 suites / 5626 tests passed, including direct database concurrency and local directory-name pagination.

## Task 2: Recruitment User Interface

**Files:** Existing demand view/components/API/types/presentation tests, application demand snapshot presentation and direct preview E2E.

- [x] Add failing frontend checks for local source labels, creation/submission/review and conflict input protection.
- [x] Add new-demand action and compact form; show local approval actions only from backend `allowedActions`; retain external sync/map path.
- [x] Show source-correct identifiers/times and snapshot/history; perform actual PC/mobile create, return/edit/resubmit, independent approve, choose demand in application and occupancy checks. Actual mobile failure exposed an oversized catalog popup; bounded input-width menus fixed the cause without weakening overflow assertions.

## Task 3: Configurable Authority And Delivery

**Files:** Shared API/Web capability registries, settings UI, permission policy/tests, preview fictional role bootstrap, acceptance record and project memory.

- [x] Add a narrow recruitment-demand review capability with matching API/Web representation; no implicit grant via hiring approval or personnel maintenance. Direct API permission tests 61/61 and Web permission/navigation checks 18/18 passed after observing the new cases fail first; the legacy entry redirect received an additional direct regression.
- [x] Verify editor/reviewer/viewer permissions, no self-review and existing candidate confirmation boundaries; no production identities in source.
- [x] Run integrated strict checks once on final affected API source, final Web build and affected UI checks; preserve the original 32 payroll preview batches. Independent review also fixed a caller-wide DingTalk configuration gate and narrowed hiring-confirm-only responses to existing association evidence.
- [ ] Apply the user-confirmed production account grants only with the release-ready feature, using current uniquely eligible accounts and the existing auditable authorization path. This has not been executed; current production roles and capabilities are unchanged. Previously specified DingTalk production acceptance gates remain distinct from the technically validated system-created path.
