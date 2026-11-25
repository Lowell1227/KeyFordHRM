# Recruitment Resume Intake Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or bounded parallel workers. Preserve the existing uncommitted dual-source demand implementation.

**Goal:** Connect approved demands, manually recorded external postings, awaiting resumes, uploads and fictional mailbox intake to the existing candidate/application flow.

**Architecture:** Extend the talent-pool module, not a separate recruitment engine. An intake is a source task until an explicit atomic confirmation reuses/creates a candidate and optionally creates an application. A read-only mailbox gateway is unconfigured in the product and injected with fictional messages only in the isolated test bootstrap.

**Tech Stack:** NestJS, Prisma, PostgreSQL, MinIO, existing resume parser/tasks, Vue 3, Element Plus.

**Spec:** `docs/requirements/2026-11-25-recruitment-resume-intake.md`

## Constraints And Ownership

- Development and isolated preview only. No real mailbox, production write, notification, calendar, grant or release.
- No BOSS API, automated publishing, URL fetching, Excel import, new offer approval or quota rule.
- Existing permission checks are authoritative. New raw intake/mail/files are recruitment-editor-only; existing candidate read boundaries remain.
- Names are hints, not identity or verified job mapping. Phone duplication must explicitly reuse an existing candidate without replacing its fields or follow-ups.
- The source task stores provenance and follow-up context; new applications do not acquire an approved hiring snapshot until the existing submit_hiring action.
- Keep original intake/posting history when mappings change. Source completion and candidate/application persistence commit together.
- Current 2037-01 payroll fixtures and other worktrees must remain unchanged. Final strict verification once against fixed integrated source, focused checks during iteration.
- Parent owns plan, mail gateway/normalization, plain-text parser reuse, final integration and records. B owns Prisma/migration, intake/posting controller/services and transactional reuse. A owns new Web screens/API types/routes. C owns new real HTTP/PC/mobile acceptance. D independently reviews the implementation.

## Review Focus

1. Revoked editor or completed/deleted target must block new writes and file access, including stale sessions.
2. Different people in one message must not be merged; one attachment produces one review item with shared mail provenance, and body-only mail produces one item.
3. Repeated/disconnected confirmation and mailbox replay return the original result; changed request contents conflict rather than silently applying different data.
4. Parsing is a suggestion, never a late overwrite of saved/manual fields; failure can be retried and does not close the intake.
5. Unverified posting links and same names never choose a demand automatically; links/content remain untrusted and are not fetched or executed.

## Contract

- `/recruitment-postings`: list/create and versioned update; approved demand ID, channel, name, HTTPS URL, optional external ID, explicit verified identity/evidence, owner. Detail includes immutable mapping events. An active verified channel identity has one current demand; unknown links remain hints.
- `/recruitment-intakes`: paginated list/create/detail/update; states `awaiting_resume`, `pending_review`, `needs_material`, `completed`, `closed`; versioned draft, owner, source channel, transport (`manual`/`email`), posting/demand hints, next-follow-up and source notes.
- Intake sub-actions: upload validated file; guarded file read; parse/retry using existing parser protection; phone check using existing candidate endpoint; confirm with `requestId`, `expectedRevision`, `mode` (`candidate_only`/`candidate_application`), explicit candidate draft or `existingCandidateId`, and explicit application fields; close with required reason; associate an email item with an awaiting item without losing provenance.
- Completed response returns exact candidateId/applicationId and next-step links. No implicit candidate updates or automatic hiring approval/demand occupancy.
- Mail gateway exposes a bounded read-only page of normalized messages (`mailboxKey`, stable message ID, receivedAt, bounded subject/body, source hints, attachments with stable IDs and bytes). Configuration declares an authorized start; no caller-supplied credentials or URLs. Production default reports not configured. Sync stores cursor only after an entire page succeeds; mailbox+message+attachment key is unique; retries preserve already processed items.
- Plain mail body may use the same structured extraction prompt/validation as document text; it is never executed and must not be wrapped as a fake file. File format protections remain unchanged.

## Task 1: Source Ledger And Atomic Confirmation (B)

- [x] Write focused failing tests for verified posting uniqueness/remap history, version conflict, editor isolation, phone reuse and two confirmation modes.
- [x] Add narrowly scoped models/migration and services/controllers; factor existing candidate/application creation into explicit transaction-client helpers without changing public behavior.
- [x] Bind validated staged files only inside successful source confirmation; reject arbitrary object keys and candidate file limits before marking complete.
- [x] Add mailbox sync persistence against the parent gateway contract; unknown/unsupported source stays actionable, no cursor loss on partial failure.
- [x] Run focused API tests, Prisma validate/generate and build. Contract delivered; 21 new checks include 18 isolated PG/HTTP tests, plus original talent/application and storage regressions. Full AppModule/MinIO/UI acceptance is separate below.

## Task 2: Mail And Parser Reuse (Parent)

- [x] Add failing pure tests for authorized time range, stable IDs, attachment splitting, link-only/unknown source and bounded untrusted body.
- [x] Implement the unconfigured-by-default read-only gateway and normalization; fixture gateway only in isolated acceptance bootstrap.
- [x] Reuse existing resume extraction for explicit plain text, keeping AI permission, rate/concurrency and output validation.
- [x] Run direct parser/gateway tests; no real AI calls or mailbox connection. Independent review fixes are covered by 21 gateway checks; counts overlap the earlier 185-check parent report.

## Task 3: Operable Screens (A)

- [x] Add recruitment editor-only 简历收件 list and drawer using existing business-page patterns, role guards, pagination and PC/mobile layout.
- [x] Add demand-scoped posting management/source entry. Preserve stable mapping history and require explicit identity verification.
- [x] Implement awaiting upload/associate/close, parsing state and manual draft, duplicate reuse, both explicit confirmation actions, and result links into existing talent/application views.
- [x] Preserve inputs on failure/409 and unknown-save recovery; show unconfigured mailbox with manual upload still usable.
- [x] Run focused Web checks and type-check/build; leave generated declarations out. Final direct tests 37/37 and Web type/build pass; actual UI found and fixed explicit 409 recovery and associated-target form hydration.

## Task 4: Actual Acceptance And Review (C/D/Parent)

- [x] Use fictional sources and real isolated Nest/HTTP/PostgreSQL/MinIO; keep original payroll and demand fixtures.
- [x] PC and mobile exercise both confirmation modes, duplicate reuse/different job, waiting-to-file and email association, close, parse error/retry and source conflict. Final `recruitment-intake-ui-run08` 2/2 with seven scenario groups each; no route mocks or external calls.
- [x] Verify mailbox attachment/body/link-only/unsupported/unknown-job/failed-page replay and concurrency; mail commands never cause operations.
- [x] Verify narrow confirmer, viewer, employee and assessor deny new intake/file writes or reads; original independent hiring/accept/termination rules remain.
- [x] Independently review, run final full API/build, Web build and actual page tests. Final API 278 suites/5688 checks; real HTTP/PG/MinIO 13 groups plus owner-null supplement; failed development runs retained, counts not added across overlapping tests.
- [x] Update project memory/acceptance with implemented/committed/deployed/business-accepted separately; leave real mailbox provider/range/authorization and retention as formal prerequisites. Additional posting UI exact-history navigation and persistent-demo checks each pass PC/mobile 2/2; original core flow 2/2 is not rerun for test-only supplements. Three pending fictional demo items and a PDF remain for the user; no release or commit.

No automatic commit or production release in this plan. Preserve existing work and deliver fixed `http://localhost:5173` preview.
