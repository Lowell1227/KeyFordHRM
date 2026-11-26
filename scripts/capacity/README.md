# Capacity diagnostics (fixed 2026-11-26 baseline)

This is an isolated diagnostic harness, not a production release command. See
`docs/acceptance/2026-11-26-login-performance-capacity.md` for actual outcomes and
limitations. It pins the tested API/Web images; review and update the baseline
before evaluating a later product version.

```powershell
node --test scripts/capacity/preflight.test.mjs scripts/capacity/isolation.test.mjs scripts/capacity/scenarios/performance.test.mjs
node scripts/capacity/browser-probe.cjs --self-test
node scripts/capacity/preflight.mjs --once
node scripts/capacity/run-isolated.mjs --start
```

The generic preflight requires 4 GiB free. The isolated runner instead checks its
explicit bounded incremental budget plus 2 GiB reserve. Neither resource check
alone proves data ownership. The runner creates uniquely labelled data services,
an internal-only API and a loopback Nginx gateway with private random credentials.
When a preview pause is explicitly authorized, the process-local option
`CAPACITY_RESOURCE_PROBE_CONTAINER=kayford-deploy-api-1` permits only a
label-verified, read-only `/proc/meminfo` observation from that API. It cannot
change the test target or relax the budget. Default: `hrm-api-1`.
Do not inspect or copy its temporary manifest into logs or source.

After `READY`, run these commands one at a time in the runner's stdin:

```text
baseline
daily-10
browser
daily-30
daily-100
login-burst
submit-burst
audit
quit
```

The browser handoff and final submission consume synthetic workflow state.
For the Web responsiveness regression, set `CAPACITY_WEB_IMAGE` to the fixed
candidate `kayford-deploy-web:<40-hex-commit>` before startup. `refresh-10` (one
minute) and `refresh-100` (two minutes) prepare authenticated sessions sequentially,
then add a validated goal-list read every ten seconds to the existing read/save
mix. They retain normal per-route latency gates. These profiles do not prove cold
simultaneous login has improved. Safe summaries exclude the preparation sessions.

After the base fixture, run `responsiveness-fixture.cjs` inside only the owned API
container and merge its `responsiveness` property into the private manifest in
memory. `responsiveness-probe.cjs` then uses real PC/mobile UI writes for employee
confirmation and HR calibration, checks the pre-opened receiving list without
manual reload, and checks protected input, selection, rejection notes and failed
reads. Its `--self-test` is offline, not browser acceptance. Native visibility is
reported separately, and the four extra employees/tasks and three cycles belong
only to that temporary database. Never run the fixture against preview or prod.

Do not repeat them on the same fixture or overwrite prior evidence. `daily-*`
includes simultaneous initial logins, not a purely preauthenticated steady state.
Check each scenario's business counters and individual route latency, not only
the average or process exit code. The current harness does not implement a soak
profile, broad payroll/recruitment fixtures or production load.

`flow-probe.cjs` and `auth-contrast.mjs` accept the private manifest and a result
path, run only against its labelled isolated gateway, and belong between the
submission/audit and `quit` steps. Flow probing consumes all submitted goals;
the CPU contrast changes only the owned test API and restores its quota.

All reports remain in the git-ignored, owner-restricted run directory. Summary
setup sessions are stripped; the private manifest is removed during cleanup.
Only resources matching this run's labels are deleted. Never substitute a
production hostname/database, reuse the shared 5173 preview, reset its data, or
copy real employee records. External notifications, mail, calendars and AI are
disabled; third-party capacity is not measured.
