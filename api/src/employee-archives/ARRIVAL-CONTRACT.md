# Task 3 Arrival and Talent Source Contract

Implemented in the shared checkout on 2026-11-12. No staging, commits, migrations,
production changes, real database writes, or external notifications by this worker.

## HTTP and Types

- `POST /employee-archives/applications/:id/confirm-arrival`
  requires `employee_archive_review` (including existing HR/admin inheritance).
- `PATCH /employee-archives/applications/:id/arrival-date`
  requires `employee_archive_edit`. This is the supported date-only correction
  path for both pending new hires and reentries; it resets profile review to
  pending while retaining identity, reserved number, performance review and source.
- Both accept `{arrivalDate: 'YYYY-MM-DD', requestVersion: number}` and return
  `OnboardingRequestView` from `dto/employee-onboarding.dto.ts`. POST returns 201;
  PATCH returns 200. Dates are Date objects internally and ISO strings over HTTP.
- Added response fields: `requiresArrivalConfirmation: boolean`,
  `arrivalDate: Date|null`, `arrivalConfirmedAt: Date|null`,
  `arrivalConfirmedById: string|null`, `talentCandidateId: string|null`,
  `talentCandidate: {id:string,name:string,deletedAt:Date|null}|null`.
  Application detail/list also includes the minimal source projection.
- Existing application detail retains events/canResume/canCancel. Command responses
  are the onboarding view, not the richer detail envelope; refetch detail for events.
- Confirmation requires reviewed profile, unconfirmed pending entry, valid pending
  employee/employment/reserved-number references and exact agreement with the
  reviewed effective date. Actual arrival cannot be in the future. Performance
  review remains independent, as before; unapproved performance relations are not applied.
- Same-date repeated confirmation with the original confirmation version or the
  current version returns the existing result (201), with no second activation,
  number, employment, or audit. A stale unrelated version or different date conflicts.
- Malformed date/version: 400. Missing capability: 403. Missing/archived request:
  404. State/version/date mismatch: 409. Serialization/CAS races in arrival commands
  are translated to 409; caller refreshes before retrying.

## Talent and Review

- CreateEmployeeDto, SaveEmployeeCreateDraftDto (inherited), reentry and onboarding
  intake fields accept optional `talentCandidateId`. The link is retained on autosave,
  resubmission and revision; an established source cannot be silently replaced.
- A newly linked candidate must exist and not be soft-deleted. A candidate already
  converted to another employee cannot be attached as a new intake.
- At most one unarchived, uncancelled draft/submitted/pending-entry request per
  candidate. Duplicate intake returns 409 with `{message, data:{applicationId}}` in the standard error envelope so the UI
  can open the existing application rather than creating a duplicate.
- Existing source-linked applications remain editable/cancellable/completable after
  candidate deletion. Effective arrival marks an undeleted source hired and records
  the employee association; deleted sources are never revived or modified.
- Candidate-linked transitions lock `talent_candidates` FOR UPDATE before request
  writes, matching Task 5 deletion locking. This covers creation/autosave/revision,
  approval/rejection, pending-performance updates, confirmation/activation,
  cancellation, and draft archive/restore. Multiple draft locks are ordered by ID.
- New operational new hires/reentries opt into arrival confirmation. Historical
  requests remain false; explicit historical intake/import behavior is preserved.
  Controlled archive-assistant pilot drafts retain their separate non-onboarding rules.
- The gate applies to profile-review creation, reentry review, explicit activation,
  scheduler/read/login refresh, and both approved-source branches of
  `approvedEmploymentSourceWhere`. AuthService already consumes this helper, including
  when its cached user status is active. Archive current-employment reads use it too.
- Removed archive/controller relaxed-mode approval calls and dependencies. Submitted
  reviewed fields report `reviewOutcome: 'pending'`; submissions containing only
  existing exempt fields retain direct application and `not_required` behavior.

## Verification and Boundaries

- Observed RED before implementation: overdue activation/read projection, missing
  confirmation/correction, elapsed-date cancellation, relaxed automatic approval,
  source persistence/deletion/duplication, review-time activation, candidate lock
  ordering, and missed-arrival historical completion.
- Archive-only command: `npm test -- --runInBand employee-archives` in `api`.
  Result: 36 suites, 390 tests passed (53.498 seconds).
- Final expanded worker command:
  `npm test -- --runInBand employee-archives jwt-auth.guard.spec.ts auth.service.spec.ts`.
  Result: 38 suites, 429 tests passed (56.401 seconds). The parent authorized the
  guard-spec ownership extension after its full-run snapshot found an outdated
  predicate literal. Updated that exact assertion without weakening the predicate
  and added denial for a signed session with stale active cache but no arrival-eligible
  employment. AuthService tests were inspected and rerun without editing them.
- Duplicate-intake regression now exercises the existing HttpExceptionFilter and
  proves `data.applicationId` survives the error envelope. The filter was not edited.
- Final worker command: `npm run build` in `api`. Result: exit 0.
- `git diff --check -- api/src/employee-archives`: no whitespace errors.
- Tests use synthetic in-memory persistence, mocked dependencies, real service
  methods and Nest HTTP/role/DTO validation. They do not prove PostgreSQL race
  interleavings or real-user acceptance. Full API/real PostgreSQL/JWT/PC/mobile
  integration remains Task 6 ownership.
- Parent separately reported a successful first real-HTTP/PostgreSQL pass for
  pending new hire, scheduler denial, reviewer confirmation, hired association and
  deleted-source non-resurrection. This worker did not independently run that pass.
- Parent should verify confirmation/cancellation/deletion races with simultaneous
  transactions, reentry/date-correction re-review, and repeated confirmation audit/
  number/employment counts. Frontend must wire the date-correction endpoint above.
- No production rollout or adaptation of historical pending requests is included.

## Exact Worker File List

All paths relative to the repository root:

- api/src/employee-archives/ARRIVAL-CONTRACT.md
- api/src/employee-archives/dto/employee-archive.dto.ts
- api/src/employee-archives/dto/employee-onboarding.dto.ts
- api/src/employee-archives/employee-archives.controller.ts
- api/src/employee-archives/employee-archives.module.ts
- api/src/employee-archives/employee-archives.service.ts
- api/src/employee-archives/employee-arrival-confirmation.spec.ts
- api/src/employee-archives/employee-data-reviews.service.ts
- api/src/employee-archives/employee-effective-date.service.ts
- api/src/employee-archives/employee-onboarding.service.ts
- api/src/employee-archives/employee-relaxed-mode.spec.ts
- api/src/employee-archives/employee-review-permissions-http.spec.ts
- api/src/employee-archives/employee-talent-source.spec.ts
- api/src/employee-archives/employee-talent-source.ts
- api/src/employee-archives/employment-timeline.ts
- api/src/common/guards/jwt-auth.guard.spec.ts (parent explicitly extended ownership)
