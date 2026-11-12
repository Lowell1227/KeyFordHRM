# Task 5 Integration Contract

Schema status: READY. Additive models are in schema.prisma and NEW 20261112130000_talent_interviews only. Parent request/arrival fields are preserved. Task 5 will run one local Prisma generate with a placeholder URL, no migration execution. No further schema edits expected.

## HTTP

- GET `/talent-interviews?scope=mine`: authenticated assigned users only; returns array of minimal views. HR archive readers may instead query `?candidateId=<uuid>`.
- GET `/talent-interviews/:id`: assigned users get minimal view; archive-edit/review, HR/admin get management view.
- POST `/talent-interviews`: `{requestId?:uuid, candidateId, startsAt, endsAt, participantIds, invitationText, meetingUrl?, note?}`. Frontend always supplies stable requestId per new form; used as interview PK. Replay verifies creator/candidate/content/participants and returns existing without a new intent. Changed payload conflicts; no schema addition.
- PATCH `/talent-interviews/:id`: `{version, startsAt?, endsAt?, participantIds?, invitationText?, meetingUrl?, note?}`; candidate immutable.
- POST `/talent-interviews/:id/cancel`, `/complete`, `/retry-sync`: `{version}`.
- Mutations require employee_archive_edit or HR/admin. Unrelated ordinary users get 404; review-only users cannot mutate.
- API start/end times must contain an explicit `Z` or numeric timezone offset. Panel values are Beijing wall-clock strings (`YYYY-MM-DD HH:mm:ss`), converted using explicit `+08:00`; all invitation displays use `Asia/Shanghai` with a Beijing time label. Browser locale/timezone does not determine the instant.
- Minimal view: id, candidateNameSnapshot, startsAt, endsAt, invitationText, meetingUrl, note, status, version, sourceDeleted, participantNames. Per approved spec section 5.1, invitation note is shared arrangement text, NOT candidate private notes. No candidate ID, resume, phone, candidate note, or external IDs. Management adds candidateId, participants `{userId,userNameSnapshot}`, syncStatus, calendarSyncedVersion.
- GET `/talents/:id/delete-impact`: `{candidateId,version,interviews:[{id,status,version,startsAt}],requests:[{id,recordStatus,onboardingStatus,requestVersion,updatedAt}],requiresForce}`. Version is SHA256 of current candidate + linked unfinished records.
- DELETE `/talents/:id` JSON body `{impactVersion,force}`. Revalidated transactionally; 409 includes latest impact on change/missing confirmation; repeated soft delete is idempotent. No cascade cancellation.

## Schema / Dispatcher

`TalentInterview` / `talent_interviews`: id, candidateId (Restrict FK), candidateNameSnapshot, startsAt, endsAt, invitationText, meetingUrl?, note?, status (scheduled/completed/cancelled), version, createdById, updatedById?, createdAt, updatedAt; syncStatus (default unconfigured), calendarSyncedVersion (default 0), calendarEventId?, externalCalendarId?, calendarOrganizerUnionId?. Organizer union ID MUST be snapshotted before first calendar create and retained for subsequent updates/cancel, even after identity rebinding.

`TalentInterviewParticipant` / `talent_interview_participants`: composite PK interviewId/userId, userNameSnapshot. Participant user IDs validated against active HRM users, no users schema edit. Relation to interview uses Restrict.

`TalentInterviewSync` / `talent_interview_syncs`: id, interviewId, version (unique pair), operation (upsert/cancel), status (pending/unconfigured/processing/synced/failed/uncertain/superseded), participantIds UUID[], attempts, calendarEventId?, externalCalendarId?, calendarOrganizerUnionId?, errorCode? (safe code only), claimToken? UUID, claimedAt?, nextAttemptAt?, completedAt?, createdAt, updatedAt. Parent owns actual adapter/dispatcher outside talent-pool.

Every mutation increments version and persists a fresh intent transactionally. Pending/failed/unconfigured old intents become superseded. ALL mutations and retry check aggregate plus outbox processing/uncertain under the interview row lock and refuse changes until reconciled (never erase external outcome). State defaults unconfigured unless DINGTALK_INTERVIEW_CALENDAR_ENABLED=true and NODE_ENV is not test. No fake sent/synced status.

Notifications use NotificationsService with type `talent_interview`, dedupeKey `talent_interview:<id>:<version>:<userId>`, extraData `{invitationId,version}`. Tests inject a mock service; no real external transport. Parent owns notification target wiring and dispatcher integration.

Before EACH notification creation, the service rechecks the current interview version and participant membership. Obsolete fanout stops delivering old snapshots after an intervening edit. A provider call already in progress cannot be recalled; notification contents never contain meeting credentials, notes, or candidate contact data, and the target always reauthorizes the current invitation.

## Frontend Integration

Parent route: `/talent-interviews/:id` and `/talent-interviews`, component `web/src/views/talent/TalentInterviewView.vue`, authenticated without talent-library capability; component loads only interview endpoints. Prisma validate/generate completed locally with placeholder URL, no DB connection.

Dispatcher claim: CAS pending/failed -> processing with random UUID claimToken, claimedAt, attempts increment. Completion updates require matching token. Timed-out processing becomes uncertain, not pending. Block new versions while ANY older processing/uncertain intent exists; reconcile external outcome before releasing the block. Mutation retries never erase these states. Parent can use the new outbox delegate directly; it must check current interview version/status before external dispatch and before marking current aggregate synced. Retain late successful external IDs on their claimed intent even when a newer version exists, to reconcile the same event instead of creating another.

Notify worker B: onboarding handoff is `/entry-exit?talentId=<id>` only, never name/phone in URL. B fetches authorized candidate detail and persists `talentCandidateId`. Arbitrary POST convert/PATCH hired is rejected; arrival worker owns actual conversion.

Task 5 does not stage, commit, release, seed, migrate, or change employee-archives/admin/routes.

Standalone HR management uses the same panel in single-invitation mode. A deleted candidate's retained invitation can still be edited/cancelled/completed at `/talent-interviews/:id`; this mode never displays a new-invitation action. Ordinary participants get the minimal content-only view.

Parent resolved the path collision: existing performance interviews retain `/interviews`; talent invitations exclusively use `/talent-interviews`. Route uniqueness and existing performance title are covered by the personnel navigation regression test.

## Task 5 Verification

- Focused Jest: `cd api; npm test -- --runInBand --testPathPattern=talent-pool`: 7 suites, 89 tests passed (2026-11-12 final focused run).
- Browser contract suite: `cd web; npx playwright test --config src/views/talent/__tests__/playwright.config.ts`: 9 passed. All HTTP APIs are synthetic intercepts, no global setup, migration, seed, or real messages. Includes read-only UI, multiple participants including probation, URL validation, impact re-confirmation, retained-invitation HR cancellation, 1440/1024/390 rendering, and America/Los_Angeles browser input/display.
- Prisma validate/generate completed with a placeholder database URL; migration execution and real HTTP/PostgreSQL integration belong to parent.
- Web type-check and API build passed. Production Web build passed with existing Rollup annotation/chunk-size warnings; not business acceptance.
- Notification interleaving regression observed red (2 creates), then green (only first already-started creation); remaining obsolete recipients are revalidated and skipped.
- Timezone regression observed red (10:00 input became 18:00Z in Los Angeles), then green (02:00Z).
- Original manual-conversion, attachment fallback, token-audit and nonmonotonic-followup regressions observed red before correction. Original terminal candidate/share-invalid rules remain covered.
- No staging, commit, push, deployment, real employee changes, or external delivery by this worker. Existing MVP and other workers' files preserved. Parent owns full-suite, real-role and calendar acceptance.

Deletion concurrency contract: all interview creates/mutations lock the candidate row FOR UPDATE before reading/updating dependent state; parent onboarding create/transition must also take this lock before changing the candidate-linked impact. Deletion holds that same lock across impact recheck and soft delete.
