# Payroll First Slice Implementation Plan

> **For agentic workers:** Use isolated, disjoint work packages and `superpowers:executing-plans` or `superpowers:subagent-driven-development`. Do not release production.

**Goal:** Fictional attendance close -> deterministic pretax payroll -> independent review/approval -> locked test Excel, with corrections and settlement preventing duplicate pay.

**Architecture:** Add a payroll domain to the existing modular monolith. Independent subject grants; immutable attendance and calculation versions; transactionally reserved obligation keys; read-only published individual performance adapter. Keep existing performance writes and notifications unchanged.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Prisma.Decimal, Vue/Element Plus, ExcelJS and existing Office workbook encryption.

**Spec:** [Approved development brief](../../requirements/2026-11-22-payroll-requirements.md).

## Global Constraints

- Baseline origin/main `2c8f44db8c843d4693747ccdbe72789bc9e0b64a`; existing clean integration worktree reused on `codex/payroll-first-20261122`. Earlier dirty worktrees and production stay untouched.
- Development and isolated fictional validation only. No production DB/config/permissions/release, no real wages, DingTalk administration, external calls or messages.
- Formal business parameters remain null/unconfigured. No invented legal policies, HR/admin superuser pay access, automatic performance coefficient1 or implied opening zero.
- Attendance calendar month; exact decimal money; only final approved version exports. Trial purpose is never eligible for final export. Validation environment final file carries a test watermark; formal channel stays disabled pending decisions.
- Compensation does not write to performance. Employee, subject and effective employment identities come from HRM, not DingTalk overwrite.
- Feature disabled by default. Existing API auth/menus retain prior behavior when disabled. Grant revocation is checked at the server for each operation/download, not trusted from JWT/menu.

## Review Focus

1. Midmonth employment changes must not create multiple obligation identities for the same employee/subject/month/item.
2. Source update while pending must invalidate approval even if only a single relevant individual changes; immutable history remains readable.
3. Approval/export/settlement races must not permit two active obligations or use stale approval versions.
4. Attendance-only users must not read wages; HR/system admin without grants must fail direct salary and download URLs.
5. Missing data is not zero. Partial pay is blocked until an explicit policy exists; a test/trial result never escapes via a formal filename or channel.

## Work Packages And Owners

### PAY-01: Authorization, Persistence And Workflow (PM Integration)

**Files:** `api/prisma/schema.prisma`, payroll-only migration, `api/src/payroll/payroll-access.ts`, `payroll.service.ts`, `payroll.controller.ts`, `payroll.module.ts`, `dto/payroll.dto.ts`; minimal app/auth wiring.

**Interfaces:** all routes `/payroll`; subjectId always a contract-subject UUID. Obligation key = subjectId + employeeId + attributionMonth + itemCode + purpose, never a mutable EmploymentRecord ID. Grants are independent of sysRole/hrCapabilities. Expected version required on writes.

- [ ] Write access tests denying admin/HR without grant, cross-subject users, assessor-only, revoked access and disabled mode.
- [ ] Add payroll-only models/migration: grants, rules/standards, versioned attendance, batches/versions/lines, reservations, settlements/openings, scoped events/exports.
- [ ] Implement transactions and deterministic source fingerprints. Keep approved versions immutable; return/withdraw create traceable later calculations and release reservations.
- [ ] Cover simultaneous submit/approve/settle, duplicate request, pending source change, partial payment/remainder cancellation and later delta.
- [ ] Validate isolated migration and actual PostgreSQL constraints; no real data.

### PAY-02: Attendance Input Kernel (Dalton, Isolated)

**Files:** `api/src/payroll/payroll-attendance-normalizer.ts`, `.spec.ts`.

**Interfaces:** `normalizeAttendance(PayrollAttendanceInput): PayrollAttendanceResult`; natural-month expected coverage supplied by server-authorized HRM employment/schedule, sanitized source records, issues and deterministic version. No actual provider call in this slice.

- [ ] Pin real calendar validation, same-source replay, latest explicit version, missing-vs-absence, overlapping paid cover, approval-in-progress/revocation, overnight workDate and unknown units.
- [ ] Implement using precise quantities without hidden day/hour conversion; preserve source references, not device/location/photos.
- [ ] Integrate source matching, issue review and sealing; late arrival creates a new version and a visible diff.

### PAY-03: Pure Payroll Calculator (Gauss, Isolated)

**Files:** `api/src/payroll/payroll-calculator.ts`, `.spec.ts`.

**Interfaces:** `calculatePayroll(PayrollCalculationInput): PayrollCalculationResult` with segments, absence/overtime and authorized adjustments; decimal strings in/out; ready or needs_configuration.

- [ ] Failing examples:17400-200+300=17500;10/20=8700;split standards18400;included10400/additional12400;item-level half-up.
- [ ] Implement fixed/absence/overtime/performance/adjustment item evidence and gross, missing config vs explicit zero, interval validation.
- [ ] Integrate persisted effective standards/rules without accepting client-calculated wages as authority.

### PAY-04: Published Individual Source (Euler, Isolated)

**Files:** `api/src/payroll/payroll-performance-source.ts`, `.spec.ts`.

**Interfaces:** `readPayrollPerformance(prisma,{employeeId,cycleId,registeredCycleIds})`; status plus immutable employee/task/cycle/grade/publication/version snapshot. No coefficient or performance write.

- [ ] Test actual individual partial publication, cycle-only false positive, conflicting evidence, pending appeal, exempt/probation, unregistered cycle and grade/source-version changes.
- [ ] Implement source adapter against existing published facts, not cycle status alone.
- [ ] Integration uses independent effective payroll coefficient mapping and explicit period registration. Missing/multiple sources block pricing.

### PAY-05: Usable UI And Final File (After API Contract)

**Files:** `web/src/api/payroll.api.ts`, `web/src/types/payroll.types.ts`, `web/src/views/compensation/payroll/*`, narrow navigation/current-user extensions; scoped workbook/export service and tests.

**Interfaces:** subject selector from independent access; attendance, standards/rules, monthly batches, approvals, results/settlement. Server state/actions authoritative; no frontend salary engine or bypass data.

- [ ] Create actual compact business pages, errors near fields, visible immutable versions and actionable discrepancies.
- [ ] Verify review/return/recompute/resubmit/approve, paused source change, test-purpose final file and reject direct unauthorized/trial/stale/void downloads.
- [ ] Encrypt workbook with existing implementation; approved numeric values only, no formulas/unneeded personal columns. Export events do not count as payment.

### PAY-06: Integrated Acceptance And Preview (PM)

**Files:** `api/test/payroll/*`, `web/e2e/preview/payroll-lifecycle.spec.ts`, `scripts/prepare-payroll-preview.cjs`, `docs/acceptance/2026-11-22-payroll-first.md`.

- [ ] Strict final API suite and targeted actual PG HTTP/transactions, unchanged performance publication/permissions compatibility.
- [ ] Fixed5173 real backend with isolated fictional identities and external effects off; PC/mobile actual page end-to-end including return, source update, correction and cross-subject denial.
- [ ] Inspect test Excel amounts against independently calculated expectations; real grant/filter/download checks; do not count mock-only tests as UI acceptance.
- [ ] Publish evidence for implemented/committed/deployed/business-accepted separately. No production deployment in this task.

## Current Progress

- [x] Full brief read; baseline/main/WIP/containers and current implementation checked.
- [x] PAY-02/03/04 independent workers dispatched, each restricted to own worktree/two files and local tests.
- [ ] PAY-01 schema/access foundation.
- PAY-01 partial:13 payroll-only tables/migration generated offline; independent access and transaction helper tests added. Prisma validation/client generation and API build passed; no database migration executed yet.
- [ ] PAY-05 UI/file contract.
- [ ] PAY-06 integrated preview and evidence.

## Formal Enablement Dependencies

Tax/net scope; applicable legal entities and employment; real salary structure/amounts; absence/overtime/rounding policies; performance cycle/month/coefficient mapping; opening balances/cutover; reviewer/approver/recusal/partial-settlement rules; export layout and retention; settlement receipts; DingTalk approved application runtime/IP and source field coverage. These remain unconfigured and are not prerequisites for fictional development, but block formal activation.
