# Formal Payroll Entry Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or the assigned isolated worker to implement each bounded package. Preserve existing local edits and verify before claiming completion.

**Goal:** Complete a production-capable, explicitly authorized payroll path instead of treating a deployed but closed module as delivery.

**Architecture:** Reuse the modular NestJS payroll services, HR direct-manager parameter review, transactions and PayrollGrant/PayrollEvent. Add missing controlled entry points and DingTalk read adapters; keep production-purpose reconciliation separate from fictional preview and formal payable batches.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3/Element Plus, existing Jest/Playwright.

**Spec:** `docs/requirements/2026-11-22-payroll-requirements.md` and the latest direct user correction in the requirements thread: complete formal functionality, then publish and enable for explicitly granted people. First release uses HR-entered monthly performance amount; automatic performance linkage is deferred.

## Global Constraints

- Baseline HEAD/remote main f9fe3dd7; production API/Web e9427df4 / 0.9.2, 84 migrations. Two existing local edits stay untouched.
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

- [ ] RED: ordinary HR, stale/inactive administrator, self-expansion, unknown/derived capability and stale version rejected.
- [ ] Implement metadata list/options, save/revoke and before/after PayrollEvent in the same transaction, reusing PayrollGrant. No wage list is returned to the administrator.
- [ ] Integrate the controller/provider and `/system/payroll-grants` route using existing system-admin navigation, record list, mobile cards and detail drawer.
- [ ] Real preview UI: administrator grants a narrow capability to a fictional actor, actor sees only its allowed path, revoke blocks subsequent API/download, audit remains; failures preserve form input.

## Package B: DingTalk Read Adapter

**Worker:** gateway/normalizer new files only in the main isolated worktree; no existing wiring files until integration.

- [ ] Read official contracts and pin query windows, pagination, operation identity and approval states. Group-read success is not individual permission proof.
- [ ] RED/GREEN: bounded explicit employee/date reads, seven-day windows, pagination stalls, duplicate/late versions, partial failures, time zones/workDate, leave withdrawal and unproven terminal state.
- [ ] Reuse token/deadline handling; return normalized input and server-derived coverage/pending evidence, never client self-certified completion.
- [ ] Wire a server-only sync route to reviewed formal employee scope, current operator DingTalk binding and existing sync/review/seal. Manual fictional fixture input remains preview-only.

## Package C: Real-data Reconciliation Purpose

**Worker:** existing isolated pay-batch workspace; purpose/contracts/access/batches/export/DTO and purpose-related Web controls/tests.

- [ ] RED: the old preview-only trial guard rejects a production-purpose reconciliation request.
- [ ] Add purpose `reconciliation` using formal reviewed sources under explicit subject permission; keep fictional trial/validation separate.
- [ ] Reject submit/decide/export/settle/net-payment/remainder and every reservation or actual tax-ledger write path; repeated calculations only store trial versions.
- [ ] Add a minimal additive purpose CHECK migration and UI “试算对账”; prove formal batches are not used to mimic historical trial.

## Package D: Explicit Actual Payer Scope

**Worker:** existing isolated pay-perf-source workspace; policy normalization, employment-scope helper, data/source readers and parameter publication tests.

- [ ] Add reviewed rule JSON `employeeScope` with explicit employeeIds and evidenceRef; dates follow the rule version. Formal scope has no contract-subject fallback.
- [ ] Resolve approved rule succession per date and use HRM approved employment start/end for active dates; prevent cross-payer overlaps atomically.
- [ ] Add minimal candidate metadata service requiring both payroll maintenance and archive-maintenance authority; do not expose global candidates to parameter-only reviewers.
- [ ] Integrate the scope editor and reviewer display. Missing scope must show a configuration requirement without preventing HR from creating the rule that supplies it.

## Integration and Release Gate

- [ ] Inspect each worker's exact paths/commits, integrate only owned changes, run affected checks and one independent review.
- [ ] Real isolated backend: formal maintenance, manual performance/manager review, terminal attendance evidence/seal, independent payroll review/approval, protected formal Excel, revocation; separate reconciliation with zero payment/reservation/tax side effects.
- [ ] Keep the existing 2037-01 demo available; do not reset consumed scenarios. Record fresh evidence separately from earlier successful tests.
- [ ] Gather only actual blockers in one minimal list: confirmed payer/member mapping, exact initial operators/capabilities, wages/deduction openings and signed attendance/data scope. Do not invent them or request every optional rule at once.
- [ ] Once those gates and the user's acceptance are satisfied, pin the final commit, back up/rehearse migrations, preserve rollback images, publish only affected services, enable only the approved production access and verify actual menus/API/download paths.

No check box above is completed merely because it is assigned. The earlier e9427df4 code deployment is not formal payroll activation.
