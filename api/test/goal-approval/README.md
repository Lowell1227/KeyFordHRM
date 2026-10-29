# Five-step goal real API acceptance

Run from the repository root:

```powershell
node api/test/goal-approval/run-isolated.cjs
```

Requires Docker, local `postgres:15-alpine` / `redis:7-alpine` images, installed API dependencies, and Prisma client generated from the current schema. Run in a worktree without `api/.env`; the runner refuses to boot when that file exists.

The browser bridge case also requires a fresh `web/dist` build, installed Web Playwright dependency and Chromium. It serves that build on an ephemeral loopback HTTP port and delegates API requests to the same real Nest application. No API routes are intercepted or fulfilled by Playwright. Synthetic JWTs live only in the ephemeral browser contexts; no storage-state or trace is saved. Screenshots go to `tmp/goal-five-step-real/`.

The runner creates uniquely named and labelled PostgreSQL/Redis containers with randomly allocated loopback ports, a fresh `hrm_goal_approval_test` database and in-memory random secrets. It verifies container ownership and absence of bind mounts, applies every repository migration, runs the real Nest app through Supertest with issued JWTs and production guards/Prisma, and removes only its own containers and anonymous volumes in `finally`. It never resets an existing database. Tokens and credentials are not written to files or printed.

The existing `test-app` harness replaces external message transport, DingTalk synchronization and file storage. Cron jobs are stopped; notification/Stream feature flags are disabled. All accounts are synthetic. The API and flow services themselves are not mocked.

Twelve cases cover HTTP new-cycle version binding; employee draft and five-step approval; final-only baseline/period binding; pre-final execution gates (self-evaluation, monthly draft/submit, progress); all rejection destinations and fresh downstream confirmation; merged/self/nonconsecutive reviewers; frozen manager identity and HR/admin mutation denial; monitor positive projection/access denial; legacy chain; real concurrent approval claims; stale employee confirmation across review rounds; self-manager return/resubmission; real browser specialist reads and leader approval at 1440/390. A narrow result smoke submits employee self-evaluation after final approval and verifies manager scoring is next.

Scope: cycles/tasks/periods/draft V1 are directly seeded for state-machine cases. The new-cycle creation test uses HTTP, but full preflight/review/launch configuration and full result evaluation/calibration/publication/archive acceptance are separate. No production deployment or business-user acceptance is implied.
