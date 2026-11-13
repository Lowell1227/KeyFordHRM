# Personnel Acceptance Fixes Implementation Plan

> **For agentic workers:** Use systematic debugging and test-driven development; coordinate disjoint file ownership. Do not commit other tasks' changes or publish production.

**Goal:** Repair the seven user-confirmed acceptance items and prove the real preview personnel lifecycle on desktop and mobile.

**Architecture:** Preserve the modular monolith and existing permissions/workflows. Correct query parsing at DTO boundaries, identity navigation by linked ID, date-only validation and business-day defaults, and bounded UI interactions.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue 3, Element Plus, Jest, Playwright.

**Spec:** `docs/acceptance/2026-11-12-personnel-end-to-end-audit.md` plus the user's ordered remediation request.

## Global Constraints

- Baseline main/origin/live remote: `21b24ed8`; production API/Web: `26580d94` (read-only).
- Fixed interactive preview: `http://localhost:5173`, Compose `hrm`, isolated `hrm_preview`; external notifications/calendar disabled.
- Preserve existing unified-onboarding dirty work; coordinate before edits to `UserManageView.vue` / `EmployeeCreateDrawer.vue`.
- Do not change review, arrival, reentry identity, employee-number, resignation timing, or authorization rules.
- No real employee data, schema changes, or production release. Report implementation, commits, deployment and business acceptance separately.

## Review Focus

- Explicit `false`, malformed/repeated flags and omitted defaults under the actual global ValidationPipe.
- Same-name linked employee, forbidden/unavailable ID, and stale route responses must never open a different record.
- Beijing midnight, overseas browser/server timezone, leap days and invalid date rollover.
- Pasted URL spoofing, multiple official links, invitation punctuation and preservation of HR manual edits.
- Full page interactions (not API shortcuts), cancelled/returned applications, duplicates and unauthorized roles.

## Tasks

### 1. Reproduction and shared query boundary (coordinator)
- [x] Read audit, inspect Git/production/preview and identify overlapping work.
- [x] Run real-preview participant query and actual ValidationPipe regressions before changing product code.
- [x] Add shared raw-input boolean parsing for affected query DTOs; preserve defaults, reject malformed values, keep participant eligibility validation.
- [x] Cover related roster/export/selectors and all affected DTOs with direct regression/integration.

### 2. Follow-up dates (date worker)
- [x] Reproduce current UTC default and invalid calendar rollover with failing regressions.
- [x] Correct `create-follow-up.dto.ts`, `talent-follow-ups.service.ts`, `TalentFollowUpTimeline.vue`; reuse Beijing date helpers where applicable.
- [x] Assert frontend/backend business-day consistency, strict both-field calendar validation and field-local errors.

### 3. Interview invitation (interview worker)
- [x] Reproduce missing extraction, add regressions, then minimally update `TalentInterviewPanel.vue` and a bounded official-link parser.
- [x] Single valid link is offered in editable meeting URL field; none/multiple require manual check; never broaden integrations.
- [x] Correct the two stale `talent-interviews.ui.spec.ts` route/time locators without weakening assertions.
- [x] Recheck historical participant availability when editing; preserve names/history without offering departed people for selection.

### 4. Linked archive and onboarding wording (coordinator)
- [x] Obtain coordination on dirty file ownership and preserve original changes.
- [x] Reproduce, then navigate from `TalentDetailDrawer.vue` using `convertedUserId`; consume ID in `UserManageView.vue` with existing backend authorization and no name fallback.
- [x] Show `办理入职` until a historical identity is explicitly selected, then `办理再入职`; final check only shows `提交审核 → 审核通过 → 确认到岗 → 入职生效`.
- [x] Add direct same-name/forbidden/missing ID and onboarding copy regressions.

### 5. Integrated evidence and handoff
- [x] Restart only preview API after all API changes; verify isolated guards before any writes.
- [x] Full API Jest + API build + related real DB/HTTP integration; Web type-check and build; targeted Playwright.
- [x] Real page desktop/mobile lifecycle: create talent, follow-up, create/edit/complete interview, convert, review, confirm arrival, exact archive, resignation, archive.
- [x] Regress return/resubmit, cancel/restore, duplicate and access-denied behavior; inspect PC/mobile screenshots.
- [x] Write issue/evidence/risk table, fixed preview instructions, and explicit state separation. User acceptance and production release remain pending.

## Completion Evidence

- API: 154 suites / 2383 tests; real integration 40/40; build passed.
- Web: type-check/build passed; real lifecycle 10/10 plus 4/4 final rechecks, dates 10/10, archive/onboarding 10/10, interview 4/4; component interview 24/24; date/link tools 49/49.
- Additional confirmed defect: cancellation command omitted metadata needed by recovery UI; refresh full detail after cancellation, desktop/mobile red-to-green, no workflow change.
- Residual: one early draft autosave anomaly did not recur; preserve its evidence and do not claim it fixed. Third-party delivery and physical-device/business acceptance are pending.
- No commit/push or production release. Final report: `docs/acceptance/2026-11-12-personnel-acceptance-fixes.md`.

## Authorized Release Update (2026-11-13)

- User explicitly authorized commit and production release. Commit `5247cb5b` pushed to origin/main; exact committed source built once for API/Web and released with backups and rollback images retained.
- Existing strict validation reused; final image checks and public read-only PC/mobile smoke passed. No schema change, business-data writes or unrelated service restart.
- Production evidence: `docs/acceptance/2026-11-13-personnel-release.md`. Human business acceptance remains pending.
