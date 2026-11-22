# REC-ACCEPT-01 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Track completion below; preserve concurrent work.

**Goal:** Close existing recruitment-to-arrival gaps with exact links, participant cancellation notices and domain-backed personal workbench entries.

**Architecture:** Keep the modular monolith, existing recruitment authorization, transactions and notification logs. Add only a read projection for workbench groups; no parallel workflow or database migration. Vue links always reload the exact domain object and reauthorize.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Element Plus, Jest, Node tests, Playwright.

**Spec:** `docs/requirements/2026-11-22-rec-acceptance-queue.md`.

## Global Constraints

- Development and isolated preview only; no production release permission.
- Version remains 0.9.1. Do not alter hiring, archive approval, arrival or employment rules.
- Fictional data only; external notification/calendar side effects off. No AI calls.
- Keep other worktrees and their uncommitted work untouched.
- API/shared authorization verification uses strict tier once on the final code; reuse unchanged evidence.
- Preview is `http://localhost:5173`, real isolated backend. Do not use mock evidence as business acceptance.

## Baseline / Findings

- Branch `codex/rec-accept-20261122`, base `8e7633e`; working tree clean at start.
- Fresh origin/main `8aede43`; production Web/API still `92e6e809`, unchanged.
- Confirmed in code: application link drops ID; hiring page selects queue first; removed interview participants lack cancellation notification.
- Existing follow-up completion/cancellation, per-application projection and hiring/arrival gates must be verified, not rebuilt.
- Current workbench only displays upcoming interviews. No own-feedback, follow-up, hiring or accepted-intake projection.
- Existing mixed HR + assessor-only backend access gap remains separately recorded; do not silently broaden this task.

## Review Focus

1. Missing/forbidden/departed queue target must never fall back to another applicant.
2. Route changes and delayed responses must not display stale identities or discard pending opinions.
3. Removed participants retain history but lose current object/feedback access; cancellation notice grants nothing.
4. Completed interview may still need feedback; missing feedback is not a new hiring gate.
5. Multi-position candidate links and intake must retain the same application; no active employment before arrival.

## Task 1: Exact Hiring And Candidate Links

**Files:** `TalentApplicationPanel.vue`, `TalentHiringReviewView.vue`, `TalentListView.vue`, `web/tests/recruitment-deep-links.test.cjs`.

**Interfaces:** `/talent-hiring?applicationId=<uuid>`; `/talents?candidateId=<uuid>&applicationId=<uuid>`; existing detail endpoints remain authorization authority.

- [ ] Red tests: non-first target, missing/forbidden target, route switch with late response, manual selection, opinion-preserving conflict refresh.
- [ ] Carry application ID; load only requested detail; never implicitly select first when explicit target unavailable. Candidate links open exact ID, never search name.
- [ ] Green focused Node tests, later real page coverage; commit only task files.

## Task 2: Removed Interview Participation

**Files:** `talent-interviews.service.ts`, its focused spec; notification target only if required.

**Interfaces:** Existing transactional notificationLog + auditLog; removed-participant notice without an object-access grant.

- [ ] Red test proves missing notice. Cover removed/retained/added, retry, cancellation, rollback, post-removal access.
- [ ] Difference old/new participant IDs, insert one deduplicated system notice per removed participant inside existing transaction. Preserve old/new participant audit.
- [ ] Green relevant suites and real PG integration; commit independently.

## Task 3: Read-Only Recruitment Workbench

**Files:** new `talent-workbench.service.ts`/controller/spec, `talent-pool.module.ts`; Web API/type, `DashboardRecruitment.vue`, dashboard mount, focused Web tests.

**Interfaces:** `GET /talent-recruitment/workbench` returns `{groups:[{key,total,items:[{id,title,subtitle,date,candidateId?,applicationId?}]}]}`. Keys: `follow_up`, `interview`, `feedback`, `hiring_review`, `onboarding`. At most 5 displayed records/group, accurate count, stable order.

- [ ] Red tests for DB-current actor, narrow roles, ownership, hidden personal fields, correct date/status sources, counts, empty/error and links.
- [ ] Read existing candidate/follow-up, interview/own-feedback, application/intake states. Follow-up is candidate-level (no application FK); owner fallback creator. Never label future/never-contacted records as overdue.
- [ ] Use current permission predicates. Do not expose candidate/application IDs to interview-only actors. Hiring shared queue excludes self; system admin gets no implicit hiring authority.
- [ ] Replace duplicate upcoming-interview panel with compact grouped personal recruitment list, per-object links, reload/error states. No broad list fetch or N+1 feedback calls in browser.
- [ ] Focused API/Web tests green, then strict validation and commit.

## Task 4: Actual UI Closure And Review

**Files:** `web/e2e/preview/rec-acceptance.spec.ts` and existing relevant preview suites as necessary; acceptance report.

- [ ] Update preview API via `node scripts/preview.mjs`, preserving isolated database/files and disabled side effects.
- [ ] Actual page lifecycle at 1440/1024/390: talent creation, follow-up, application, interview create/edit/end, feedback, independent hiring, accepted intake, archive approval, HR arrival, exact archive.
- [ ] Negative coverage: two applications, follow-up three actions, removed participant, self approval, return/resubmit, cancellation/recovery, duplicate intake, unauthorized access, no-show not active; verify no performance auto-conversion writes.
- [ ] Final API full tests/build + related PostgreSQL integration; Web type-check/build + direct Playwright. Run full suite once on final code, not after documentation-only edits.
- [ ] Independent whole-diff review; resolve material findings, record residual risks and evidence separately from human acceptance.
- [ ] Deliver exact preview, role list, short steps and implemented/committed/deployed/accepted states. No production changes.

## Coordination / Preflight

| Tasks | Shared Contract / Risk | Resolution |
| --- | --- | --- |
| 1 / 3 | Exact application/candidate query links | Task 1 owns target pages; task 3 consumes agreed query names. |
| 2 / 3 | Interview membership and own-feedback semantics | Reads current membership; notices never regrant rights. Separate files. |
| 3 API / Web | Group contract and capped result | Contract above; timestamp strings nullable; explicit truncation in UI. |
| 1 / 4 | Changed route behavior and stale requests | Focused runtime tests plus actual non-first target. |
| 2 / 4 | Real transactional effects | Integration uses isolated fixture, no external delivery. |
| 3 / 4 | Empty roles and same-app scope | Role matrix and two-position fixtures required. |
| 1 | Tests vs implementation | Match exact ID, error and race behavior; no backend policy change. |
| 2 | Tests vs implementation | Existing transaction/audit reused, no schema. |
| 3 | Tests vs implementation | Read projection only; no duplicate task state. |
| 4 | Tests vs implementation | Fixture setup allowed; business actions through UI. |

Ruling: follow-up plans are candidate-level in the current schema, so workbench ownership follows the candidate, not a guessed application. Application-level entries retain exact application ownership.

## Progress

- Baseline confirmed; tasks 1-3 implementation in progress. Production untouched.
