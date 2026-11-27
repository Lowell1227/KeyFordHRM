# Scoped Performance Lifecycle Backend

## Contract

- Kinds: `task`, `goal_change`, `improvement_plan`, `confirmation`.
- `GET /performance-lifecycle/:kind/:id` returns lifecycle metadata, management `allowedActions`, safe lifecycle audit events and current-reviewer handover information. Original domain authorization is checked first. This does not grant access to salary or internal confirmation notes.
- `POST .../terminate` and `POST .../delete` require `{ expectedUpdatedAt, expectedLifecycleVersion, reason }`. Reason is trimmed, nonempty and at most 1000 characters. Success returns the updated lifecycle projection. Stale requests return 409.
- Fields: `lifecycleStatus` (`active|terminated|deleted`), `lifecycleVersion`, `terminatedAt`, `terminatedById`, `terminationReason`, `deletedAt`, `deletedById`, `deletionReason`, `updatedAt`, `allowedActions` (`lifecycle_terminate`, `lifecycle_delete`). Original business actions are suppressed when inactive.
- New independent configurable capabilities: `performance_lifecycle_view`, `performance_lifecycle_terminate`, `performance_lifecycle_delete`. HR/system administrators follow the existing module role policy; HR specialists need explicit capabilities. This change grants nobody real permissions.
- Original lists support `lifecycleStatus=active|terminated|deleted|all`; default excludes deleted. Originally authorized employees/reviewers retain their history without a global capability. Global lifecycle viewing applies only inside the performance domain, never to payroll or confidential HR fields. Pending/actionable queues always require active lifecycle.

## Invariants

Business status, scores, published results, goal versions, employment and effective confirmation facts are not reversed. Termination protection and archive readiness are separate. Approved results awaiting employee confirmation, V5 confirmed results awaiting publication, legacy published results awaiting employee confirmation, and active appeals cannot be hidden to skip required work. Closed/exempt tasks or published-and-employee-confirmed tasks may move to history. An unfinished record must first terminate before deletion.

Lifecycle mutations lock the same root rows as reviewers, with periods before task rows. Task termination also terminates unfinished goal changes while preserving their statuses and applied goal versions. Current actor authority is re-read under a user-row share lock, serializing with permission revocation.

The additive migration installs root and related child-write fences as defense in depth for legacy writers. Child rows lock/check their owning task; period operations and ordinary task version claims use the same order. Confirmation attachments and assessment signatures are fenced; notification inserts are guarded but delivery/read history remains writable. No unrelated business rows are cleaned or rewritten. Cost: task writes contend at task granularity and descendant writes perform a parent-row check. Performance controllers translate lifecycle constraint/serialization conflicts to sanitized 409, not SQL diagnostics.

`performanceHandover(db, reviewerIds)` is a read-only hook to call after original scope filtering. It reports unavailable reviewers, never rewrites frozen relationships. GET lifecycle detail includes this projection.

## Offboarding Boundary

New launched tasks and improvement plans bind to the uniquely established current employment. Confirmation retains its existing employment binding. Actual effective resignation invokes `terminateEmploymentPerformance` inside the personnel transaction, restricted to unfinished records for that employee and matching employment spell. Scheduled resignation runs only when it actually changes the effective projection. Reviewer departure does not terminate other employees' records. Reentry is separate.

Legacy null or ambiguous employment links are deliberately NOT inferred or batch-backfilled. They require an approved record-specific reconciliation before automatic offboarding can include them. Explicit authorized lifecycle management remains available. Already protected/effective records are retained, not force-terminated.

## Verification Handoff

Short policy, mutation, employment-boundary, safe-error and task-version tests are under `src/performance-lifecycle` and `src/tasks/task-version.spec.ts`. The initial capability checks failed before implementation. Parent owns strict full API/build and real-role integration.

Isolated database contracts: `test/performance-lifecycle/jest.config.json`. They require the explicitly provisioned `hrm_lifecycle_test` database and same-named owner, provided through `PERFORMANCE_LIFECYCLE_TEST_DATABASE_URL`. Hosts are loopback or `postgres` inside the guarded local preview. The test itself starts no container/server, migrates nothing and resets nothing. `node scripts/test-lifecycle-database.cjs` prepares that separate fictional database through verified `hrm` containers; explicit `--reuse` verifies ownership before reusing its own rows. It never clears the shared preview or production.

Parent actually executed **6/6 real PostgreSQL contracts**, including root/child fences, independent kinds, active-only uniqueness after termination with concurrent duplicate refusal, exact-employment offboarding/reentry/reviewer isolation and repeat audit safety, queued stale writes, and queued permission revocation. This is database evidence, not a full personnel approval or live DingTalk test. Dedicated fictional rows remain for inspection.

Remaining evidence: execute migrations and the contracts, actual HTTP role/scope/concurrency flows, pending/reminder and aggregate removal, scheduled/immediate resignation plus reentry, and ordinary flow regressions. A notification whose external delivery already began before termination cannot be recalled; new pending creation and subsequent retries/delivery are rechecked. No production mutation, grant, deployment or historical cleanup is part of this work.
