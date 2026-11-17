# Operations Script Safety

Scope: audit second-batch findings 10, 11 and 17. These scripts are not permission
to release or restore production. Follow AGENTS.md for approval, target/config
verification, migration review, protective backups, rollback and external checks.

## Backup

The existing Compose backup invocation is unchanged. `backup.sh` remains POSIX
`sh`, defaults to `/backups`, and accepts `BACKUP_DIR` for an isolated destination.
All five `POSTGRES_*` connection variables, including `POSTGRES_PORT`, are required.

The dump is written to a private temporary directory on the backup filesystem.
Only successful, nonempty `pg_dump` output is compressed; compression and gzip
integrity must both succeed before an atomic rename publishes the archive.
Failures clean temporary files, return nonzero, and do not run retention.
Retention now matches only regular `kayford_perf_*.sql.gz` files older than 30 days.

New filenames have a collision-resistant suffix:
`kayford_perf_YYYYMMDD_HHMMSS_XXXXXX.sql.gz`. Existing archives remain usable.
Provision space for both the uncompressed SQL and compressed archive. Gzip
integrity and a successful dump are not an isolated recovery drill.

## Restore

The existing single-file argument is preserved:

```bash
sh deploy/scripts/restore.sh /path/to/trusted.sql.gz
```

Only run this after separate approval, a verified protective backup and stopping
application writers. The archive must be trusted plain SQL from the expected
database; gzip validation cannot establish SQL semantics or sandbox a malicious
dump. The script does not automatically stop any service or create a protective
backup for the target.

Preflight checks required connection settings, rejects maintenance databases,
fully decompresses into a private temporary file, rejects empty output, and
checks target connectivity before destructive SQL. The interactive prompt now
requires exactly `RESTORE <host>:<port>/<database>`; Enter, `yes`, mismatches and
EOF cancel. This deliberately changes the prompt documented in older workflows.

Every psql call uses the configured port, ignores `.psqlrc`, disallows password
prompts and sets `ON_ERROR_STOP=1`. Termination, DROP and CREATE are separate
calls; identifiers/literals use psql variable quoting. Import reads the validated
temporary SQL file with `--single-transaction` and aborts on SQL errors.

DROP and CREATE cannot be one atomic transaction. A failure after DROP can leave
the target absent or empty. The script exits nonzero rather than continuing or
claiming success; it never attempts an automatic compensating restore. SQL
validity, restore privileges, extensions, database-specific settings, available
space and application compatibility still require a disposable recovery drill
before an approved destructive restore.

## Update Production

The former no-argument invocation is intentionally rejected. After explicit
release authorization, a reviewed full commit and affected services are required:

```bash
bash scripts/update-prod.sh --revision <40-character-commit> --services web
bash scripts/update-prod.sh --revision <40-character-commit> --services api
bash scripts/update-prod.sh --revision <40-character-commit> --services api,web
```

- No pull, checkout, reset, commit or push is performed. The exact revision must
  resolve as a commit, equal HEAD and equal freshly queried `origin/main`.
  Missing/offline origin, mismatches and dirty tracked/staged/untracked files
  reject the release. An older release or feature-branch SHA needs a separately
  approved release/rollback procedure, not a bypass flag.
- Git-ignored files do not block release, but none enters the build: Docker uses
  contexts extracted by `git archive` from the verified commit. This excludes
  ignored local source, dependency trees, artifacts and private environment files.
  The original private root `.env` is still used explicitly as deployment
  configuration, not as archived build source. It is not edited or displayed.
- The source snapshot, Compose override and rollback manifest are retained under
  `$HOME/kayford-releases` (or `HRM_RELEASE_ROOT`, outside the checkout). Keep them
  for release inspection; the script does not delete previous release folders.
  Git Bash converts archived paths for Docker Desktop in generated YAML.
- The project is fixed to `kayford-deploy`. Each affected running container must
  match that project and service. Its current image ID is tagged with a unique
  rollback reference and recorded before build/replacement. First-time installs
  without a running baseline are rejected by this update-only script.
- Only explicitly selected services are built once and started with
  `--no-deps --no-build`. Web-only does not run backup, API or migrations.
  API-containing releases require the checked-in backup service to complete
  successfully before replacement, because the existing API entrypoint runs
  `prisma migrate deploy`. PostgreSQL, Redis and MinIO are not recreated.
- API-only replacement waits for the new API's direct in-container HTTP health
  JSON (`code=0`, `data.status=ok`, `data.db=ok`) before touching Nginx. It then
  verifies the existing Web container's project and service, runs `nginx -t`,
  and only on success runs `nginx -s reload`. This refreshes the static
  `proxy_pass http://api:3000` address after API IP changes without building or
  recreating Web. Readiness is bounded to 30 probes, each with a 3-second socket
  timeout and 2-second retry delay. Timeout, ownership mismatch or either Nginx
  command failure exits nonzero. API+Web starts a new Web and skips this reload.
- A revision-label mismatch or failed local health check returns nonzero. This
  does not automatically roll back applications or restore a database over later
  business data. External health JSON, actual image/resources, migration status,
  test-login configuration and affected real-role paths remain required release
  checks; local health alone is not business acceptance.

The script does not independently certify the migration plan, production `.env`
values, restore readiness, the running stack's original release directory or
public routing. These remain pre-release review gates, not inferred from a clean
Git checkout. Do not use a preview configuration as production configuration.

## Stub Verification: 2026-11-16

Initial local HEAD/main and live `git ls-remote --exit-code origin refs/heads/main`
matched `5956d9d3f824386a18c76c5eda0a189eb1f217ba`. The shared checkout was already
dirty with other workers' changes. They were preserved, and production was not
queried or operated by this worker. No main `.env`, stack or migration was edited.

Before implementation, the first 34-case harness run had 30 failures. It exposed
backup exit 0 and retention after failed `pg_dump`, combined DROP/CREATE rejection,
and dirty/unverified deployment proceeding to Compose. A separate targeted run
exposed false restore success on SQL import error while bypassing only the
independent combined-DDL defect in the psql double.

The original focused suite passed 46 tests. The API-only upstream follow-up first
reproduced six failing regressions, then passed all **52 stub tests**, plus
**3 PostgreSQL integration-runner guard unit tests** (55 passed, 0 failed).
Exact commands from the repository root in PowerShell:

```powershell
node --test --test-reporter=spec scripts/tests/ops-safety.test.cjs scripts/tests/ops-postgres-verify.test.cjs
& 'C:/Program Files/Git/bin/bash.exe' --noprofile --norc -n scripts/update-prod.sh
& 'C:/Program Files/Git/usr/bin/sh.exe' -n deploy/scripts/backup.sh
& 'C:/Program Files/Git/usr/bin/sh.exe' -n deploy/scripts/restore.sh
git diff --check -- deploy/scripts/backup.sh deploy/scripts/restore.sh scripts/update-prod.sh
```

The harness executes copies of the actual scripts in disposable filesystem
fixtures, using a restricted PATH and non-forwarding Docker/Git/psql/pg_dump
doubles. It uses real local gzip, tar and filesystem operations, fabricated SQL,
and fixture-only credentials. The legacy hard-coded `/backups` path is remapped
only for the original regression; new code uses `BACKUP_DIR`. Tests never load the
real `.env`, call real Docker, access PostgreSQL or contact a Git remote.

Coverage includes dump/compression/validation/finalization failures, preserving
old archives, scoped retention, confirmation cancellation, corrupt/empty/missing
restore files, per-stage SQL failures, port/error-stop propagation, maintenance
database rejection, dirty/staged/untracked source, remote/HEAD/archive failures,
mandatory service scope, ignored-file exclusion, rollback/backup/build failures,
wrong project, missing config, post-replacement revision/health errors and
Web/API/combined scope. The upstream tests model API IP changing from
`172.20.0.4` to `172.20.0.9`: Web health stays failed until the existing Web is
reloaded after API readiness. They also cover wrong Web project/service, API
readiness timeout, Nginx configuration/reload failures, and no redundant reload
for API+Web.

These stub and guard tests do not execute Docker or PostgreSQL. They do not prove
a real Docker/Compose build, Nginx reload or production recovery. The separately
authorized disposable PostgreSQL check is described below. No production
operation, commit or push was made. Controller owns final application regression
and preview updates.

## Disposable PostgreSQL Verification

The opt-in runner is `scripts/tests/ops-postgres-verify.cjs`. It accepts only
`--preflight` (read-only) or `--run`, never a caller-selected database/container:

```powershell
node scripts/tests/ops-postgres-verify.cjs --preflight
node scripts/tests/ops-postgres-verify.cjs --run
```

It requires `hrm-postgres-1`, Compose project `hrm`, service `postgres` and a
running container. Every exec rechecks the pinned container ID and start time.
Database names and OIDs are recorded before creation. Only a new random
`audit_ops_<UTC timestamp>_<random suffix>` database successfully created by the
current invocation can be mutated, restored or dropped. Existing names, a
collision, changed identity or unexpected catalog/OID change stop the check.

The runner uses container-local credentials without printing or transferring
their values to the host. All child output is captured; command errors are
reported without raw stderr. It never reads the main `.env`, selects a production
container, changes roles/configuration, applies migrations or restarts a service.
Only maintenance-catalog reads and CREATE/DROP of its owned database use the
`postgres` maintenance database; fixture operations target the owned DB only.

Actual workspace `backup.sh` and `restore.sh` are copied to a new private `/tmp`
directory in the verified development container, with LF normalization and
SHA256 comparison. Backup output and restore temporary files stay inside this
owned directory, never the existing backup volume. The test creates one table
with two fictional rows, runs the real backup script, modifies the rows, and
runs the real restore script with exact target confirmation. It compares the
restored rows and table count, not just a success message.

Before valid restore, a corrupt gzip is passed to the real restore script with
the correct confirmation. Rejection must leave the database OID, table OID and
modified rows unchanged and must not reach destructive confirmation. Only the
owned database and explicitly named fixture files are cleaned afterward. The
final catalog must exactly match the original names/OIDs; container identity and
start time must also be unchanged. If ownership becomes uncertain, cleanup
refuses to DROP and the report names the remaining owned test database for review.

Machine-readable evidence is saved under ignored `tmp/audit-ops-postgres/` with
timestamps, script hashes, before/after catalog, fictional rows and cleanup
results. This is a disposable PostgreSQL semantics check, not a production
restore, production-data backup validation or full application recovery drill.

### Observed Result: 2026-11-16

The real run passed at 19:09:13-19:12:48 Asia/Shanghai on PostgreSQL **14.23**.
Container ID was `d7b218a1f89c47b2f3212c98f042a263cd1dd613bd4591032be471563771feed`;
its start time remained `2026-11-16T03:45:22.081043159Z`.

- Created only `audit_ops_20261116110913_2725b3c83db0`, initial database OID
  `175392`, with one table (OID `175394`) and rows `(1, fixture_alpha)` and
  `(2, fixture_beta)`.
- Real `backup.sh` completed. Rows were changed to `(1, changed_after_backup)`
  and `(3, new_after_backup)` before restore testing.
- Corrupt gzip returned exit **1** before confirmation/DROP; database OID
  `175392`, table OID `175394`, table count and the modified rows all remained
  unchanged.
- Real `restore.sh` recreated only the owned database (new OID `175402`) and
  restored exactly the original one table/two rows. The restored table OID was
  `175403`, confirming the assertion checked actual replacement, not stale data.
- The owned database and all owned container fixture files were removed.
  The complete original catalog was identical before/after:

| Existing Database | Before OID | After OID |
| --- | --- | --- |
| hrm_preview | 166364 | 166364 |
| kayford_perf | 16384 | 16384 |
| postgres | 13841 | 13841 |
| template0 | 13840 | 13840 |
| template1 | 1 | 1 |

Evidence: `tmp/audit-ops-postgres/audit_ops_20261116110913_2725b3c83db0.json`.
Verified LF-normalized script SHA256 values:

```text
backup.sh  f84cbf62f705967cb12a357c818c70ec165ae3f7a2a88ea27eac099713887bb5
restore.sh 3198f964a8f7055fea473fbe2ac651c44ea949304b828978054a9ca2d065f865
```

No existing database was dropped/restored. No production container, deployment
or preview restart was involved. The API-only Nginx change has stub evidence
only; no real production deployment or real Nginx reload was performed.
