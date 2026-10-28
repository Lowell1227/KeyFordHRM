# Organization direct reports implementation plan

> **For agentic workers:** Use the current root and assigned agents to implement each bounded task and verify the combined result.

**Goal:** Replace personnel-list responsibility tags with direct-report counts and on-demand lists, and close roster import for all users.

**Architecture:** Reuse UsersService, its existing data scope and subordinate endpoint, a small Vue popover, and a route-specific import guard. No schema changes or new permissions.

**Tech Stack:** NestJS, Prisma, Vue 3, Element Plus, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-organization-direct-reports-design.md`

## Constraints and checks

- Current worker means active or probation, not deleted or archived; only employee accounts.
- List counts and subordinate details use the same viewer scope; counts are independent of the parent list's keyword and department filter.
- Preserve business identities, performance permissions, frozen tasks and current roster data.
- Use one group query per page; no request per visible row.
- Keyboard focus, pointer hover and phone tap must reveal the same bounded list; failure must offer retry.
- Import guard runs before multipart parsing for template, preview, batch and confirmation routes; no administrator exception.

## Tasks

- [x] Add failing UsersService tests, implement the shared subordinate filter and batched counts, and run focused API tests.
- [x] Add failing HTTP import tests, close all four routes with a guard, and verify employee creation and review remain usable.
- [x] Add failing browser scenarios for organization/roster counts, focus/hover/tap, errors, zero reports and absent import entry; implement the popover and list replacement.
- [x] Remove frontend import controls and orphaned handlers while preserving unrelated maintenance features.
- [x] Run combined API tests/build, Web type check/build and focused Playwright at 1440, 1024 and 390 pixels; inspect screenshots and review permissions.
- [x] Record implemented/tested state and retain an isolated branch without deploying absent release authorization.

## Verified implementation state — 2026-10-28

- Branch: `codex/organization-direct-reports`, based on `c4ca88d`; existing main-workspace edits were not included.
- API: `npm test -- --runInBand` — 111 suites, 1521 tests passed; `npm run build` passed. All eight system roles are denied on the four import routes; malformed multipart requests are rejected before parsing.
- Web: `npm run type-check` and `npm run build` passed. Existing Rollup annotation and large-chunk warnings remain.
- Browser: 24 tests passed, using `playwright.organization.config.ts` (initially named `playwright.direct-reports.local.config.ts`). Run from `web` in PowerShell with `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:18768'; npx playwright test --config playwright.organization.config.ts`.
- Browser coverage includes desktop/tablet/mobile counts and names, no per-row requests, retry, keyboard list scrolling, Escape, real touch toggle, all-role import-entry absence, personnel settings, employee archive editing, review and resignation/archive flows. The fixtures use synthetic API responses; this is developer verification, not production role acceptance.
- Reviewed screenshots at 1440, 1024 and 390 pixels: long department/position text wraps, popup stays within the viewport and long lists scroll.
- Independent review found and then verified fixes for keyboard access to retry, keyboard scrolling and a second touch closing the popup.
- No schema migration or production data changes. Code is implemented and tested; this feature has not been deployed or accepted in production.
