# Task 5 Integration Contract

Schema status: READY. Additive models are in schema.prisma and NEW 20261112130000_talent_interviews only. Parent request/arrival fields are preserved. Task 5 will run one local Prisma generate with a placeholder URL, no migration execution. No further schema edits expected.

## HTTP

- GET `/talent-interviews?scope=mine`: authenticated assigned users only; returns array of minimal views. HR archive readers may instead query `?candidateId=<uuid>`.
- GET `/talent-interviews/:id`: assigned users get minimal view; archive-edit/review, HR/admin get management view.
- POST `/talent-interviews`: `{requestId?:uuid, candidateId, startsAt, endsAt, participantIds, invitationText, meetingUrl?, note?}`. Frontend always supplies stable requestId per new form; used as interview PK. Replay verifies creator/candidate/content/participants and returns existing without a new intent. Changed payload conflicts; no schema addition.
- PATCH `/talent-interviews/:id`: `{version, startsAt?, endsAt?, participantIds?, invitationText?, meetingUrl?, note?}`; candidate immutable.
- POST `/talent-interviews/:id/cancel`, `/complete`, `/retry-sync`: `{version}`.
- Routine interview mutations require explicit recruitment_edit, employee_archive_edit, or existing HR/admin eligibility. Unrelated ordinary users get 404; review-only users cannot mutate. Recruitment editing does not grant archive management, candidate deletion, sharing, export, hiring confirmation, or feedback-return authority.
- GET /talent-interviews/participants is the authorized editor-only HRM worker selector. It returns paginated id/name/employeeNo/status/archivedAt only; archived, deleted, non-current, test and assessor-only accounts are excluded. It does not grant access to the general employee archive API.
- API start/end times must contain an explicit `Z` or numeric timezone offset. Panel values are Beijing wall-clock strings (`YYYY-MM-DD HH:mm:ss`), converted using explicit `+08:00`; all invitation displays use `Asia/Shanghai` with a Beijing time label. Browser locale/timezone does not determine the instant.
- Minimal view: id, candidateNameSnapshot, startsAt, endsAt, invitationText, meetingUrl, note, status, version, sourceDeleted, participantNames. Per approved spec section 5.1, invitation note is shared arrangement text, NOT candidate private notes. No candidate ID, resume, phone, candidate note, or external IDs. Management adds candidateId, participants `{userId,userNameSnapshot}`, syncStatus, calendarSyncedVersion.
- GET `/talents/:id/delete-impact`: `{candidateId,version,interviews:[{id,status,version,startsAt}],requests:[{id,recordStatus,onboardingStatus,requestVersion,updatedAt}],requiresForce}`. Version is SHA256 of current candidate + linked unfinished records.
- DELETE `/talents/:id` JSON body `{impactVersion,force}`. Revalidated transactionally; 409 includes latest impact on change/missing confirmation; repeated soft delete is idempotent. No cascade cancellation.

## Schema / Dispatcher

`TalentInterview` / `talent_interviews`: id, candidateId (Restrict FK), candidateNameSnapshot, startsAt, endsAt, invitationText, meetingUrl?, note?, status (scheduled/completed/cancelled), version, createdById, updatedById?, createdAt, updatedAt; syncStatus (default unconfigured), calendarSyncedVersion (default 0), calendarEventId?, externalCalendarId?, calendarOrganizerUnionId?. Organizer union ID MUST be snapshotted before first calendar create and retained for subsequent updates/cancel, even after identity rebinding.

`TalentInterviewParticipant` / `talent_interview_participants`: composite PK interviewId/userId, userNameSnapshot. Participant user IDs validated against active HRM users, no users schema edit. Relation to interview uses Restrict.

`TalentInterviewSync` / `talent_interview_syncs`: id, interviewId, version (unique pair), operation (upsert/cancel), status (pending/unconfigured/processing/synced/failed/uncertain/superseded), participantIds UUID[], attempts, calendarEventId?, externalCalendarId?, calendarOrganizerUnionId?, errorCode? (safe code only), claimToken? UUID, claimedAt?, nextAttemptAt?, completedAt?, createdAt, updatedAt. Parent owns actual adapter/dispatcher outside talent-pool.

Every mutation increments version and persists a fresh calendar intent transactionally. Pending/failed/unconfigured old intents become superseded. ALL mutations and retry check aggregate plus outbox processing/uncertain under the interview row lock and refuse changes until reconciled (never erase external outcome). Calendar state defaults unconfigured unless DINGTALK_INTERVIEW_CALENDAR_ENABLED=true and NODE_ENV is not test. No fake calendar synced status.

Create/update/cancel/complete persist the calendar intent, audit and current-participant `NotificationLog` rows in the same transaction under the existing candidate/interview locks. Notifications use type `talent_interview`, dedupeKey `talent_interview:<id>:<version>:<userId>`, extraData `{invitationId,version}`, channel `system`, status `sent`, unread state and sentAt. Here sent means the inbox record is persisted, NOT an external delivery. Notification insertion errors reject and roll back the whole transaction; no swallowed failure or duplicate-skipping insert. The existing frontend keeps the form and requestId on save rejection. Create replay returns the existing invitation without another intent, audit or notification. Calendar-only retry still creates a versioned calendar intent without another business notification.

There is no post-commit fanout, NotificationsService dependency, notification outbox or new worker. The existing DingtalkPushProvider refuses external delivery without cycleId, so this keeps the existing system-only channel policy and does not enable external notifications or change calendar dispatch. Each version notifies only its current participants; old generic inbox records remain but links always load the current invitation and reauthorize against current permissions/membership. Notification titles/content are generic, with no invitation text, candidate names/contact data, notes or meeting URLs.

## Frontend Integration

Parent route: `/talent-interviews/:id` and `/talent-interviews`, component `web/src/views/talent/TalentInterviewView.vue`, authenticated without talent-library capability; component loads only interview endpoints. Prisma validate/generate completed locally with placeholder URL, no DB connection.

Dispatcher claim: CAS pending/failed -> processing with random UUID claimToken, claimedAt, attempts increment. Completion updates require matching token. Timed-out processing becomes uncertain, not pending. Block new versions while ANY older processing/uncertain intent exists; reconcile external outcome before releasing the block. Mutation retries never erase these states. Parent can use the new outbox delegate directly; it must check current interview version/status before external dispatch and before marking current aggregate synced. Retain late successful external IDs on their claimed intent even when a newer version exists, to reconcile the same event instead of creating another.

Notify worker B: onboarding handoff is `/entry-exit?talentId=<id>` only, never name/phone in URL. B fetches authorized candidate detail and persists `talentCandidateId`. Arbitrary POST convert/PATCH hired is rejected; arrival worker owns actual conversion.

Task 5 does not stage, commit, release, seed, migrate, or change employee-archives/admin/routes.

Standalone HR management uses the same panel in single-invitation mode. A deleted candidate's retained invitation can still be edited/cancelled/completed at `/talent-interviews/:id`; this mode never displays a new-invitation action. Ordinary participants get the minimal content-only view.

Parent resolved the path collision: existing performance interviews retain `/interviews`; talent invitations exclusively use `/talent-interviews`. Route uniqueness and existing performance title are covered by the personnel navigation regression test.

## Task 5 Verification (2026-11-12 Historical)

- Focused Jest: `cd api; npm test -- --runInBand --testPathPattern=talent-pool`: 7 suites, 89 tests passed (2026-11-12 final focused run).
- Browser contract suite: `cd web; npx playwright test --config src/views/talent/__tests__/playwright.config.ts`: 9 passed. All HTTP APIs are synthetic intercepts, no global setup, migration, seed, or real messages. Includes read-only UI, multiple participants including probation, URL validation, impact re-confirmation, retained-invitation HR cancellation, 1440/1024/390 rendering, and America/Los_Angeles browser input/display.
- Prisma validate/generate completed with a placeholder database URL; migration execution and real HTTP/PostgreSQL integration belong to parent.
- Web type-check and API build passed. Production Web build passed with existing Rollup annotation/chunk-size warnings; not business acceptance.
- Historical notification interleaving regression observed red (2 creates), then green (only first already-started creation). Superseded by the 2026-11-17 transactional inbox consistency regression: all current recipients are persisted before commit, and the next version excludes removed participants while old links reauthorize.
- Timezone regression observed red (10:00 input became 18:00Z in Los Angeles), then green (02:00Z).
- Original manual-conversion, attachment fallback, token-audit and nonmonotonic-followup regressions observed red before correction. Original terminal candidate/share-invalid rules remain covered.
- No staging, commit, push, deployment, real employee changes, or external delivery by this worker. Existing MVP and other workers' files preserved. Parent owns full-suite, real-role and calendar acceptance.

Deletion concurrency contract: all interview creates/mutations lock the candidate row FOR UPDATE before reading/updating dependent state; parent onboarding create/transition must also take this lock before changing the candidate-linked impact. Deletion holds that same lock across impact recheck and soft delete.

## 2026-11-17 Notification Consistency Verification

- Red before service changes: targeted notification/recipient-set tests had 10 expected failures, 1 pass and 24 unselected tests. Failures showed missing transactional inbox writes, successful saves despite the injected insert failure, and return before transactional notification insertion.
- One final focused Jest run: `cd api; node node_modules/jest/bin/jest.js --runInBand --testPathPattern="talent-pool|dingtalk/interview-calendar"`. 15 suites: 12 passed, 3 failed; 246 tests: 237 passed, 9 failed. The interview service's 35 tests and all four interview-calendar suites passed. The initial npm wrapper attempt did not start Jest because Windows cmd interpreted the regex pipe; the direct runner above was the only final suite execution.
- Shared-worktree failures outside this change: `talents.service.spec.ts` phone-collision case (1) and `talents-concurrency.spec.ts` update cases (7) received TALENT_EDIT_CONFLICT after concurrent editVersion enforcement; `talent-follow-ups.service.spec.ts` list-order assertion (1) did not expect the concurrently added id tie-breaker. These files were not modified by this notification task; no assertions were removed and no repeat final run was performed.
- `npm run build` passed. Only talent-interviews.service.ts, its direct service spec and this contract were edited by this task. The direct constructor caller now injects Prisma only; NotificationsService and external channel policy were not changed.
- The old post-commit fanout interleaving test now gates the transactional batch insert, asserts that the transaction cannot finish first, checks the full version-1 recipient set, version-2 current recipients and removed-user denial on the old link. Additional tests cover create replay, lifecycle titles/version keys, insert-error propagation through the transaction and calendar-only retry.
- Evidence is focused mocked unit testing and API compilation, not a live PostgreSQL rollback, browser failure-injection run or business acceptance. Frontend save rejection retaining form/requestId was checked in source only. No real data, migration, external send, preview/production update, staging or commit was performed.
