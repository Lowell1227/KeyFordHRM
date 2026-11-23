# Formal Payroll Entry Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or the assigned isolated worker to implement each bounded package. Preserve existing local edits and verify before claiming completion.

**Goal:** Complete a production-capable, explicitly authorized payroll path instead of treating a deployed but closed module as delivery.

**Architecture:** Reuse the modular NestJS payroll services, HR direct-manager parameter review, transactions and PayrollGrant/PayrollEvent. Add missing controlled entry points and DingTalk read adapters; keep production-purpose reconciliation separate from fictional preview and formal payable batches.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3/Element Plus, existing Jest/Playwright.

**Spec:** `docs/requirements/2026-11-22-payroll-requirements.md` and the latest direct user correction in the requirements thread: complete formal functionality, then publish and enable for explicitly granted people. First release uses HR-entered monthly performance amount; automatic performance linkage is deferred.

## Global Constraints

- Baseline HEAD/remote main f9fe3dd7; production API/Web e9427df4 / 0.9.2, 84 migrations. Two existing local edits stay untouched.
- Updated integration baseline: merged live main `6411581e` into `8166b467`, including the independently authorized archive release `d05b1f98`. Production API/Web rechecked at `d05b1f98`, migration baseline 85; earlier baseline above is historical, not a release target.
- No real wages, arbitrary employee/month reads, notification/calendar delivery, DingTalk scope changes or default production grants. Preserve the existing performance system.
- Unknown actual payroll subjects, people, parameters, tax openings and approvals stay unconfigured, not zero or fictional defaults.
- Actual payer membership must be explicitly recorded and reviewed; contract subject alone cannot silently establish payroll membership.
- Isolated preview remains localhost:5173. Real-purpose tests use fictional inputs in a disposable isolated service/database context, never weaken the preview guard or move fictional fixtures to production.
- Strict risk tier: focused RED/GREEN per package, final affected integration and full API once, Web build/type-check and PC/mobile real backend paths, independent review. Reuse unchanged evidence between final validation and release.

## Review Focus

- Administrator authorization maintenance must not itself grant wages access, permit self-expansion or trust a stale administrator JWT.
- Concurrent grant updates, revoked grants during calculation/download, and deactivated people fail closed without destroying prior audit records.
- Empty DingTalk responses do not prove a rest day; incomplete pagination, unproven approval terminal state or unknown time units prevent payroll sealing.
- Production reconciliation never creates reservations, approvals, settlements, net-payment/tax facts or final Excel, including through forged direct requests.
- Formal employee scope changes use reviewed versions and preserve old approvals/payment facts; overlapping payer scopes and missing mappings cannot default to contract membership.

## Package A: Subject Authorization

**Worker:** existing isolated pay-core workspace, backend grants controller/service/DTO/tests only.

- [x] RED: ordinary HR, stale/inactive administrator, self-expansion, unknown/derived capability and stale version rejected.
- [x] Implement metadata list/options, save/revoke and before/after PayrollEvent in the same transaction, reusing PayrollGrant. No wage list is returned to the administrator.
- [x] Integrate the controller/provider and `/system/payroll-grants` route using existing system-admin navigation, record list, mobile cards and detail drawer.
- [x] Real preview UI: administrator grants a narrow capability to a fictional actor, actor sees only its allowed path, revoke blocks that exact subject API, audit remains; PC/mobile actual backend passed. Salary download revocation remains part of the separate formal-purpose integration gate, not this UI test.

## Package B: DingTalk Read Adapter

**Worker:** gateway/normalizer new files only in the main isolated worktree; no existing wiring files until integration.

- [x] Read official contracts and pin query windows, pagination, operation identity and approval states. Group-read success is not individual permission proof.
- [x] RED/GREEN: bounded explicit employee/date reads, seven-day windows, pagination stalls, duplicate/late versions, partial failures, time zones/workDate, leave withdrawal and unproven terminal state.
- [x] Reuse token/deadline handling; return normalized input and server-derived coverage/pending evidence, never client self-certified completion.
- [x] Wire a server-only sync route to reviewed formal employee scope, current operator DingTalk binding and existing sync/review/seal. Manual fictional fixture input remains preview-only. Mocked gateway evidence is not an actual personal-attendance permission/coverage check.
- [x] Finish durable proof round-trip for derived replacements and terminal cancellation, including worker restart; missing legacy proof remains pending rather than silently cleared. 9 suites / 562 related checks; real-gateway permission remains separate.

## Package C: Real-data Reconciliation Purpose

**Worker:** existing isolated pay-batch workspace; purpose/contracts/access/batches/export/DTO and purpose-related Web controls/tests.

- [x] RED: the old preview-only trial guard rejects a production-purpose reconciliation request.
- [x] Add purpose `reconciliation` using formal reviewed sources under explicit subject permission; keep fictional trial/validation separate.
- [x] Reject submit/decide/export/settle/net-payment/remainder and every reservation or actual tax-ledger write path; repeated calculations only store trial versions.
- [x] Add a minimal additive purpose CHECK migration and UI “真实资料对账”; final real PostgreSQL proof remains in the integration gate below.

## Package D: Explicit Actual Payer Scope

**Worker:** existing isolated pay-perf-source workspace; policy normalization, employment-scope helper, data/source readers and parameter publication tests.

- [x] Add reviewed rule JSON `employeeScope` with explicit employeeIds and evidenceRef; dates follow the rule version. Formal scope has no contract-subject fallback.
- [x] Resolve approved rule succession per date and use HRM approved employment start/end for active dates; prevent cross-payer overlaps atomically.
- [x] Add minimal candidate metadata service requiring both payroll maintenance and archive-maintenance authority; do not expose global candidates to parameter-only reviewers.
- [x] Integrate the scope editor and reviewer display. Missing scope must show a configuration requirement without preventing HR from creating the rule that supplies it.

## Controlled First-Month Acceptance (Integrated Follow-up)

Ruling: use the existing reviewed reconciliation approval path, immutable calculation/net references, SystemConfig request records and PayrollEvent; no parallel table/workflow or public generic configuration writer. A complete net result is required. This is source acceptance, not approval or payment of a reconciliation wage batch.

- [x] HR submits explicit first month, evidence reference and latest complete reconciliation version; return/withdraw/resubmit remain auditable.
- [x] Independent current reviewer and approver sign in sequence, with source/grant/revision checks; self-signing, cross-subject and forged receipt rejected.
- [x] Approved receipt opens formal processing only from the signed first month; explicit revoke blocks new actions without rewriting paid or approval history.
- [x] Existing calculation/approval pages expose one compact signing panel; field-local validation, stale-response fences and mobile layout verified.
- [x] Actual PostgreSQL service flow verifies receipt creation/revocation and zero reconciliation financial side effects; do not seed arbitrary accepted configuration as proof. 32 real-PG cases including eight two-connection races; actual PC/mobile cold UI 2/2.

## Integration and Release Gate

- [x] Inspect each worker's exact paths/commits, integrate only owned changes, run affected checks and one independent review. Snapshot/authorization race found and fixed; final API 253 suites / 5041 tests, API/Web build and final Web types passed.
- [x] Real isolated backend: formal maintenance, manual performance/manager review, terminal attendance evidence/seal, independent payroll review/approval, protected formal Excel, revocation; separate reconciliation with zero payment/reservation/tax side effects. Gateway input is fictional; not a live DingTalk permission claim.
- [x] Keep the existing 2037-01 demo available; do not reset consumed scenarios. Record fresh evidence separately from earlier successful tests. Actual runner cleanup and original demo/environment digests verified.
- [x] Gather only actual blockers in one minimal list: payer and three initial roles confirmed; actual member mapping, wages/deductions/openings/calendar and data acceptance belong to HR entry/manager review. Attendance sealing/export/payment identity clarification is pending, so no extra grants were assigned.
- [x] Preparation release under the user's explicit instruction: fixed `96ff3360`, verified backups, schema-only 85-to-87 rehearsal and old-client compatibility, rollback images, API/Web only, three minimum grants and real-role read-only public PC/mobile checks. Current production preparation entries are usable; see the release record.
- [ ] Business cutover: actual input review, individual attendance/terminal permission and month coverage, complete October net reconciliation and independent signoff; only then create formal wages from the accepted first month. Unconfirmed financial capabilities remain unassigned; no claim of actual payroll acceptance or payment.

No check box above is completed merely because it is assigned. The earlier e9427df4 code deployment is not formal payroll activation.
