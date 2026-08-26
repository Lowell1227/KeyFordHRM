# Task 1 Report: Restore objective-map direct-manager review

## Scope

Restore the validated objective-map and direct-manager review behavior from the `codex/objective-map-production-v2` reference commits onto the current main-based consolidation branch, while preserving newer current-main login, menu, cycle-scope, recruitment, and roster-authority behavior.

## Implementation

- Added objective review persistence to Prisma with `ObjectiveReviewStatus`, reviewer linkage, review timestamps/comments, and migration `20260825143000_add_objective_review_workflow`.
- Added API review DTOs and controller routes for approve / request-changes without reintroducing a broad role gate.
- Extended `ObjectivesService` to:
  - compute reporting-depth visibility for indirect descendants,
  - expose stable review metadata on tree/list/detail serialization,
  - initialize review state on create,
  - reset review state on material edits,
  - enforce direct-manager-only review decisions with conflict handling and audit logs.
- Extended web objective contracts and enums for review metadata.
- Restored objective-map review UI:
  - `下属目标` scope label,
  - review badge on cards,
  - `待我审核` filter,
  - parent objective / reviewer / latest review detail in drawer,
  - approve and return-for-changes actions,
  - review comment display,
  - descendant-aware team scope and review-only ancestor retention.
- Added focused API and Playwright regression coverage before production edits, then implemented until those checks turned green.

## Files

- `api/prisma/schema.prisma`
- `api/prisma/migrations/20260825143000_add_objective_review_workflow/migration.sql`
- `api/src/objectives/dto/objective-review.dto.ts`
- `api/src/objectives/objectives.controller.ts`
- `api/src/objectives/objectives.controller.spec.ts`
- `api/src/objectives/objectives.service.ts`
- `api/src/objectives/objectives.service.spec.ts`
- `web/src/api/objectives.api.ts`
- `web/src/types/api.types.ts`
- `web/src/types/enums.ts`
- `web/src/views/objectives/ObjectiveMapView.vue`
- `web/src/views/objectives/components/ObjectiveMapCard.vue`
- `web/src/views/objectives/components/ObjectiveMapFilters.vue`
- `web/src/views/objectives/objective-map-layout.ts`
- `web/e2e/specs/09-performance-workspace.spec.ts`

## RED Evidence

### API regression tests before implementation

Command:

```powershell
npm test -- objectives.controller.spec.ts objectives.service.spec.ts --runInBand
```

Result:

- `FAIL src/objectives/objectives.service.spec.ts`
- `FAIL src/objectives/objectives.controller.spec.ts`
- `Tests: 9 failed, 20 passed, 29 total`

Key failure evidence:

- `ObjectivesController.prototype.approveObjective` and `requestObjectiveChanges` were `undefined`.
- `ObjectivesService.reviewObjective is not a function`.
- `findTree` visibility only queried `ownerId in ['manager-1', 'lead-1']`, missing the descendant `employee-1`.
- created / updated objectives did not serialize `reviewStatus`, `reviewerId`, `reviewedById`, or `canReview`.

### Web regression suite before implementation

Command:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4173'
$env:PLAYWRIGHT_API_BASE_URL='http://127.0.0.1:4173/api/v1'
$env:VITE_DEV_PROXY_TARGET='http://127.0.0.1:5173'
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/09-performance-workspace.spec.ts --config playwright.mock.config.ts
```

Result:

- `50 passed`
- `8 failed`

Task-1-specific red evidence:

- missing `下属目标` control text in the objective-map floating filters.
- objective cards rendered `个人刘伟用户问题支持30%` with no `待审核` badge.
- objective detail lacked `上级目标` and `当前审核人`.
- no `objective-review-request-changes` action was rendered.
- VP read-only objective-card flow could not use the descendant team scope.

Also observed in the broader file, but not part of this Task 1 restore:

- `team employee selector exposes only the direct-manager API facet`
- `目标跟进 uses shared performance navigation`
- `绩效待办 uses shared performance navigation`

## GREEN Evidence

### Prisma client refresh after schema update

Command:

```powershell
npm run prisma:generate
```

Result:

- `Generated Prisma Client (v5.22.0)`

### Focused API objective tests

Command:

```powershell
npm test -- objectives.controller.spec.ts objectives.service.spec.ts --runInBand
```

Result:

- `PASS src/objectives/objectives.service.spec.ts`
- `PASS src/objectives/objectives.controller.spec.ts`
- `Tests: 29 passed, 29 total`

### API build

Command:

```powershell
npm run build
```

Result:

- `nest build` completed successfully.

### Web type-check

Command:

```powershell
npm run type-check
```

Result:

- `vue-tsc --noEmit` completed successfully.

### Web build

Command:

```powershell
npm run build
```

Result:

- `vite build` completed successfully.
- Rollup emitted existing chunk-size warnings only; build still succeeded.

### Focused objective-map / review Playwright verification

Command:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4173'
$env:PLAYWRIGHT_API_BASE_URL='http://127.0.0.1:4173/api/v1'
$env:VITE_DEV_PROXY_TARGET='http://127.0.0.1:5173'
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/09-performance-workspace.spec.ts --config playwright.mock.config.ts --grep "objective map|objective cards|objective review|direct manager can approve|requesting objective changes|VP can inspect objective cards"
```

Result:

- `19 passed (21.4s)`

Covers:

- objective-map floating controls,
- card rendering and badge state,
- review-only filter with ancestor retention,
- direct-manager approve flow,
- request-changes with required reason,
- deep-link availability,
- VP read-only behavior,
- layout model,
- display settings model,
- responsive / accessibility checks.

### Broader Playwright file after implementation

Command:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4173'
$env:PLAYWRIGHT_API_BASE_URL='http://127.0.0.1:4173/api/v1'
$env:VITE_DEV_PROXY_TARGET='http://127.0.0.1:5173'
$env:PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA='0'
npx playwright test e2e/specs/09-performance-workspace.spec.ts --config playwright.mock.config.ts
```

Result:

- `55 passed`
- `3 failed`

Remaining failures were unchanged broader-baseline items outside this Task 1 objective-review restore:

- `team employee selector exposes only the direct-manager API facet`
- `目标跟进 uses shared performance navigation`
- `绩效待办 uses shared performance navigation`

## Self-review

- Kept the implementation narrow to objective-domain files and did not touch newer login, menu, recruitment, or cycle-scope files.
- Preserved the untracked helper `web/playwright.mock.config.ts` and did not add or commit it.
- Avoided generated `web/auto-imports.d.ts` and `web/components.d.ts`.
- Verified both API and web layers with fresh commands after implementation instead of relying on earlier runs.

## Concerns

- The full `web/e2e/specs/09-performance-workspace.spec.ts` file is not fully green in this branch because three older, non-Task-1 failures remain in team-selector / shared-navigation coverage.
- The report path was provided under a future-dated folder name, `2026-08-27`; I wrote the report there exactly as requested even though the current date is Wednesday, August 26, 2026.
