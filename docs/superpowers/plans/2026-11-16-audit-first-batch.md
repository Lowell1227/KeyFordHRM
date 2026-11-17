# Audit First Batch Implementation Plan

> For agentic workers: use subagent-driven-development for disjoint fixes. No commit, production deployment, production data writes, or unrelated cleanup is authorized.

**Goal:** Close audit findings 1-5, 8 and 14, preserving business workflows and existing authorization boundaries.

**Architecture:** Reuse existing NestJS permission/scope services and Vue loading patterns; no schema migration or parallel authorization system.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue 3, Pinia, Jest and Playwright.

**Spec:** User-approved first batch of the full-code audit: privileged password resets, cycle-scoped reopen, personal probation queries, revoked-HR internal attachments, legacy performance attachments, stale talent editing and late task-detail responses.

## Constraints And Baseline

- Work in the existing main checkout under the user's established main-first workflow. Preserve all pre-existing dirty files, especially project-memory.md and archive/reference preview work.
- Use only isolated fictional preview data, with external notifications disabled. Production remains read-only.
- Do not change department merging, scoring rules, onboarding gates or personnel source data.
- Existing privileged HR/system-admin access remains; missing object ownership checks must not become new business grants.
- Validation tier: strict. Focused regressions first, then one full API run/build and Web checks plus real-backend preview verification.
- Keep implemented, committed, deployed and business-accepted status separate.

## Tasks

- [x] API account/password, probation personal scope and internal confirmation attachment authorization; direct denial/allow regressions, including concurrent target role change and deletion.
- [x] Monthly reopen ownership using existing cycle-operator scope; direct denial/allow regressions.
- [x] Talent drawer and task-detail stale-response guards; 21 targeted regressions and six real-backend desktop/mobile checks passed.
- [x] General performance file downloads: identify actual persisted references and reuse current task access, preserve permitted historical access and new-upload ownership.
- [x] Independent review, focused integration, full API validation and Web verification.
- [x] Update isolated preview, document evidence and remaining risks, prepare user acceptance links and fictional samples.

## Status

2026-11-16: Implementation and final validation complete for the seven scoped findings. Integration exposed legacy attachment DTO implicit-conversion loss; explicit object typing now preserves submitted URLs. Independent review found and closed two attachment bypasses (reattachment after access revocation and noncanonical URL variants), with direct regressions. Final API: 166 suites / 2783 tests passed; API build passed. Web Node: 214 passed, including 21 stale-response regressions; type-check/build passed. Real preview: 13 passed / 5 intentionally skipped duplicate HTTP checks, including all six desktop/mobile page checks. Existing third-party build warnings remain. Preview updated and fictional acceptance samples retained; see docs/acceptance/2026-11-16-audit-first-batch.md. No commit, production release or human acceptance yet.
