# Talent Reliability Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Complete scoped regression checks before integration.

**Goal:** Fix the reviewed talent-library reliability gaps and publish the verified result under the user's direct-release authorization.

**Architecture:** Keep the modular monolith and existing tables. Candidate edits compare a server-derived scalar snapshot token under the candidate row lock; resume binding uses the same lock. Interview notifications are existing system-inbox records written in the interview transaction, not a new external messaging subsystem.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue 3, Element Plus, existing Jest/Playwright and pinned Docker release tooling.

**Spec:** `docs/superpowers/specs/2026-11-12-talent-personnel-lifecycle-design.md`, existing talent MVP, and the six findings reviewed with the user on 2026-11-17.

## Global Constraints

- Baseline main/live remote: `92c37cd4`; production API/Web: `f71898cb`. Preserve the protected old root checkout and all concurrent work.
- User authorized implementation and direct production release. Do not repeat broad regression after unchanged source merely for a commit or deployment.
- No new recruitment scope, no configurable dictionary center, no employee-data cleanup or historical company mapping. Sources/tags and existing safety limits remain unchanged.
- No migration planned. Candidate edit token is derived from formal scalar state, not a newly added column. Old clients without a token fail closed with a refresh instruction.
- Keep DingTalk calendar disabled. Current talent notifications have no cycleId, so the existing provider keeps them in the system inbox; do not enable external transport.
- User confirmed share recipients: current HR, actual direct managers and active department leaders, individually selected by HR. System administrators retain existing administrative eligibility; legacy manager/VP roles alone do not qualify.

## Review Focus

- Old full forms must conflict after any relevant formal candidate edit or arrival linkage; retain current form input and provide an explicit reload action.
- Same-day follow-ups need deterministic order; keep the last nonempty next-follow-up semantic and Beijing business dates.
- A repeated resume bind must not consume another slot, and deletion/binding must serialize on the candidate, with no physical object deletion.
- A successful interview transaction must contain its system-inbox notifications. Notification insertion failure rolls back the interview; do not claim external delivery.
- No widening of talent-list, resume or interview visibility, and no change to HR arrival, identity reuse, frozen performance or contract rules.

## Tasks

### 1. Candidate editing and follow-up selection (Main)
- [x] Add regressions for stale/missing edit tokens, no-op edits, arrival changes and safe edit audit (7 direct checks pass).
- [x] Add a canonical scalar snapshot helper, expose `editVersion` on management views, require it on updates and compare under the existing row lock.
- [x] Advance `updatedAt` on actual candidate edits; log field names only, not phone/salary/note values.
- [x] Carry the loaded token from the Vue editor and rejection action; keep input on409 and offer explicit reload without automatic data loss.
- [x] Stabilize both next-date SQL paths and the detail/time-line order with occurredAt, createdAt and id; use the Beijing date parameter, explicitly cast as PostgreSQL date.

### 2. Atomic resume binding (Resume worker)
- [x] Add red concurrency/idempotency/deletion tests.
- [x] Lock the candidate, recheck active source, check duplicate and count, then create in one transaction; retain storage/type/size checks.
- [x] Run scoped tests and report changed files (4 suites / 40 checks pass), leaving commits and deployment to Main.

### 3. Durable internal interview notifications (Notification worker)
- [x] Add red transaction/duplicate/current-membership tests.
- [x] Persist existing NotificationLog entries with interview/participant/version dedupe keys in the interview transaction, status sent/channel system.
- [x] Remove swallowed post-commit notification calls and unused dependency; retain calendar intent/version guards and safe payloads.
- [x] Update direct tests and contract notes; no schema, external notifications or calendar changes.

### 4. Share policy and overview (Main, after policy answer)
- [x] Apply only the explicitly confirmed share scope with matching frontend/backend eligibility and current-worker validation; select formal roster managers, not performance-manager projections.
- [x] Correct the static system capability inventory: talent library and simple invitations available; full recruitment/Offer still deferred. Do not present inventory as live health or business acceptance.
- [x] Keep necessary legacy error endpoints and frozen historical workflow/data semantics; no unrelated cleanup.

### 5. Integration and release (Main)
- [x] Independent targeted review of final source and policy boundary. Two P2 findings fixed and independently closed; no remaining P1/P2 blocker.
- [x] One final full API run (180/3060), affected regression/integration tests, Web type check and direct real-backend PC/mobile checks (8/8) using fictional isolated data only. Fixed production build remains a release gate below.
- [x] Record inherited Web test debt separately; do not remove assertions or weaken guards.
- [x] Commit task files, push and verify the exact remote SHA `3e024872`; build production once from that fixed source.
- [x] Fresh backup and rollback images; retain67 migrations/config and only replace API/Web.
- [x] External health/resources and affected read-only real-role paths (6 checks, 4 responsive pages), then release record and project memory. Human acceptance remains separate.
