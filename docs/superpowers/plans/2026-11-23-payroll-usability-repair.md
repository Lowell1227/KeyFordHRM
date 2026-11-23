# Payroll Usability Repair Implementation Plan

> **For agentic workers:** Use test-first implementation in the existing isolated checkout. Each owner edits only its assigned files; the coordinator integrates, verifies and releases.

**Goal:** Let an HR operator prepare, reconcile and process one payroll month without technical-format forms or unrecoverable data-entry mistakes.

**Architecture:** Reuse existing versioned payroll records, subject grants, parameter releases, attendance snapshots and audit events. Do not replace the payroll workflow or infer wage/tax policy. Production changes are authorized after strict verification; fictional fixtures stay isolated.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue 3, Element Plus and Playwright.

**Spec:** User-approved payroll requirements and the independent review in this conversation, 2026-11-23. The user additionally approved an attendance editor recording confirmed absence with evidence and an attendance sealer verifying it before calculation.

## Global Constraints

- Preserve unrelated work in `docs/acceptance/2026-11-23-payroll-manual-performance-fixes.md` and `web/components.d.ts`.
- Keep version 0.9.2 unless the user changes it. No real wages, payment confirmation, permissions or DingTalk configuration changes in development.
- Keep formal payroll and reconciliation distinct; reconciliation never reserves, pays, exports final wages or updates tax facts.
- Keep reviewed subject assignments, actual direct-manager parameter review, independent wage review/approval and final download gates.
- Do not convert missing punches into absence automatically. Manual absence needs explicit evidence and the approved two-step capability checks.
- Do not alter immutable approved/paid history to repair input. Corrections and range recovery retain original facts and invalidate stale pending work.

## Review Focus

- Minute-level attendance must survive conversion through payroll calculation without early money-style rounding.
- Historical full reconciliation must use full entitlement while formal settlement still uses unpaid balance.
- Copying shared deduction rules cannot copy another person's cumulative facts or confirmation.
- Missing punches, actual rest-day overtime and changed payer scope need explicit, auditable next actions.
- First setup, monthly entry and supervisor review must remain usable with long data and on a phone.

## Work Packages

### A. Monetary Calculation

Files: `api/src/payroll/payroll-sources.service.ts`, `payroll-batches.service.ts`, `payroll-net.ts` and their specs.

- [x] Add failing minute-duration and already-paid reconciliation regressions.
- [x] Separate duration precision from configured monetary quantities; use full entitlement only for reconciliation net input and summary.
- [x] Preserve formal balance, source freshness, validation and no-payment invariants; run affected suites, including readiness signoff using full entitlement.

### B. DingTalk Attendance Conversion

Files: `api/src/payroll/payroll-dingtalk-attendance.ts` and its specs.

- [x] Reproduce approved rest-day/holiday overtime rejection.
- [x] Convert independently proved overtime without fabricating normal attendance; reject unproved, revoked, duplicate and overlapping facts.
- [x] Export only narrowly necessary validation helpers for the coordinator's manual-absence integration.

### C. Deduction Entry

Files: deduction profiles/settings Vue views, dedicated deduction-form/copy helpers and focused Web tests.

- [x] Reproduce cross-person copy and confirmed-opening carryover.
- [x] Lock identity for personal copies; provide safe same-subject approved shared-rule application with personal facts cleared.
- [x] Split common rules from individual entry, support reviewed per-person reuse and batch draft preparation without automatic approvals or zero-fill.
- [x] Preserve source version, preview before save, individual errors and partial-result recovery; no silent bulk retries.

### D. Monthly Workflow and Review

Files: standards, parameter review, batch views, new payroll-specific display helpers/components and focused tests. Exclude deduction/attendance/ledger files owned elsewhere.

- [x] Add field-local validation and first-setup next actions, preserve payer/month.
- [x] Show hash-verified old/new parameter comparison and human-readable monetary/audit details instead of requiring raw JSON.
- [x] Prefer net calculation for real reconciliation; make current month's state and next action clear without adding a parallel workflow.

### E. Coordinator: Recovery and Confirmed Absence

Files: payroll data service/controller/DTO, attendance view, ledger and API/types as needed, plus focused tests.

- [x] Add explicit version-checked scope-difference recovery, preserving original snapshots and blocking unsafe approved/paid changes.
- [x] Add auditable opening-balance correction with immutable before/after evidence; stale calculations must be invalidated and actual payments stay unchanged.
- [x] Add evidence-backed absence proposal and sealer verification; amounts derive only from confirmed durations and rules, never missing-punch inference.
- [x] Add a real-backend fictional UI closure covering ordinary month, exceptions, return/resubmit, corrections and denied access.

### F. Integration and Authorized Release

- [x] Run full API integration plus affected payroll regressions, targeted real PostgreSQL flows, Web type check and PC/compact/mobile Playwright. Final production-image build remains a release gate.
- [x] Independent review of final money, authority, recovery and UI changes; fix confirmed findings without weakening assertions.
- [ ] Commit only task files, push and confirm remote main; freeze final source and changed services.
- [ ] Verify recoverable backup and rollback images, deploy affected API/Web only, perform read-only public role smoke and record implementation/commit/release/business acceptance separately.

## Integration Evidence

- Full API integration: 256 suites / 5171 tests passed before the final derived-snapshot absence-revocation repair. That local repair requires its own impacted-suite rerun; do not silently reuse the full-suite count as evidence for later edits.
- Independent review reproduced one P2: a resync or scope-recovery draft kept effective absence facts but omitted the original proposal, making revocation return 404. Accepted for a test-first repair; original versions remain unchanged.
- Deduction bulk saves remain individual draft writes. A connection failure has an unknown outcome; the UI stops and asks the operator to refresh and verify, rather than retrying blindly. No new API idempotency guarantee is claimed.
- No schema, dependency, production configuration, permission or real-wage change is planned. Existing approved public deduction rules are reused; a separate company deduction-template catalog is not introduced.
- Real PostgreSQL found JSONB key reordering breaks a plain serialized-payload comparison. A failing recursive-order regression now passes with attendance-only versioned canonical digests; the global hash and approved wage/parameter history remain unchanged. Legacy attendance remains readable with an explicit hold, and recovery writes require fresh verified synchronization. Production had zero attendance snapshots at verification; recheck before cutover.
- Final payroll module: 41 suites / 1469 tests passed, then the legacy-read compatibility increment: 5 suites / 164 tests passed. These overlap and are not added. Real HTTP/PG and three viewport UI evidence cover 20 unique grouped cases, including one-success/one-stale concurrent opening correction; fictional fixtures removed, original demo unchanged and external calls zero.
