// Opt-in integration check. Never accepts a caller-supplied container or database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const CONTAINER = 'hrm-postgres-1';
const DATABASE_PATTERN = /^audit_ops_[0-9]{14}_[a-f0-9]{12}$/;
const ROOT = path.resolve(__dirname, '../..');
const INSPECT_FORMAT = '{"id":{{json .Id}},"name":{{json .Name}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}}}';

function assertContainer(container, pinned) {
  if (container.name !== `/${CONTAINER}` || container.project !== 'hrm'
    || container.service !== 'postgres' || container.running !== true
    || !/^[a-f0-9]{64}$/.test(container.id) || !container.startedAt
    || (pinned && (container.id !== pinned.id || container.startedAt !== pinned.startedAt))) {
    throw new Error('Development container identity check failed; stopping.');
  }
}

function assertOwnedTarget(database, before, created) {
  if (!DATABASE_PATTERN.test(database) || !created || before.some((item) => item.name === database)) {
    throw new Error('Database is not owned by this invocation; refusing mutation/cleanup.');
  }
}

function assertExistingUnchanged(before, current, database) {
  const existing = current.filter((item) => item.name !== database);
  assert.deepEqual(existing, before, 'Existing database names/OIDs changed; stop and investigate.');
}

function rawDocker(args, input) {
  // Capture every stream. Never echo environment, credentials, SQL errors or raw output.
  return spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
}

function checked(result, stage) {
  if (result.error || result.status !== 0) {
    throw new Error(`${stage} failed (exit ${result.status ?? 'unavailable'}); raw output suppressed.`);
  }
  return result.stdout.trim();
}

function parseJson(value, stage) {
  try { return JSON.parse(value); } catch { throw new Error(`${stage}: invalid JSON; raw output suppressed.`); }
}

function inspect(target, pinned) {
  const value = parseJson(checked(rawDocker(['inspect', '--format', INSPECT_FORMAT, target]), 'Container inspection'), 'Inspection');
  assertContainer(value, pinned);
  return value;
}

function main(mode) {
  const pinned = inspect(CONTAINER);
  const database = `audit_ops_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}_${crypto.randomBytes(6).toString('hex')}`;
  const report = { startedAt: new Date().toISOString(), container: pinned, database, mode, checks: {} };
  const reportPath = path.join(ROOT, 'tmp/audit-ops-postgres', `${database}.json`);
  let before = [];
  let created = false;
  let work = '';
  let archive = '';
  let ownedOid = null;
  let failure = null;

  function exec(args, input, env = {}) {
    inspect(pinned.id, pinned);
    const options = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    return rawDocker(['exec', '-i', ...options, pinned.id, ...args], input);
  }

  function sql(target, statement, stage) {
    // The maintenance database is used only for catalog reads and our own DB DDL.
    if (target !== 'postgres') assertOwnedTarget(target, before, created);
    const command = 'set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -X --no-password -qAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$1" -v audit_db="$2"';
    return checked(exec(['sh', '-c', command, 'audit-ops-sql', target, database], statement), stage);
  }

  function databases() {
    return parseJson(sql('postgres', "SELECT json_agg(json_build_object('name',datname,'oid',oid::text) ORDER BY datname) FROM pg_database;", 'Read database catalog'), 'Database catalog');
  }

  function checkOwnedDatabase() {
    assertOwnedTarget(database, before, created);
    const list = databases();
    assertExistingUnchanged(before, list, database);
    const found = list.find((item) => item.name === database);
    if (!found || found.oid !== ownedOid) throw new Error('Owned database OID changed unexpectedly; refusing operation.');
  }

  function tableState() {
    return parseJson(sql(database, "SELECT json_build_object('tableOid', 'public.audit_ops_fixture'::regclass::oid::text, 'tables', (SELECT count(*)::integer FROM pg_tables WHERE schemaname='public'), 'rows', (SELECT json_agg(row_to_json(t) ORDER BY id) FROM public.audit_ops_fixture t));", 'Read fixture'), 'Fixture state');
  }

  function runScript(script, file, confirmation) {
    checkOwnedDatabase();
    const args = ['sh', `${work}/${script}`];
    if (file) args.push(file);
    return exec(args, confirmation || '', {
      POSTGRES_DB: database, POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '5432',
      BACKUP_DIR: `${work}/backups`, TMPDIR: `${work}/temp`, PGAPPNAME: database,
    });
  }

  try {
    before = databases();
    report.existingBefore = before;
    assert.ok(!before.some((item) => item.name === database), 'Generated name already exists; refusing reuse.');
    report.serverVersion = sql('postgres', "SELECT current_setting('server_version');", 'Read server version');
    report.checks.developmentIdentity = true;
    if (mode === '--preflight') {
      report.existingAfter = databases();
      assertExistingUnchanged(before, report.existingAfter, database);
      report.checks.existingCatalogUnchanged = true;
    } else {
      assert.ok(DATABASE_PATTERN.test(database));
      // CREATE has no IF NOT EXISTS: a collision must fail, never adopt an existing DB.
      sql('postgres', 'CREATE DATABASE :"audit_db" WITH TEMPLATE template0;', 'Create unique disposable database');
      created = true;
      const afterCreate = databases();
      assertExistingUnchanged(before, afterCreate, database);
      ownedOid = afterCreate.find((item) => item.name === database)?.oid;
      assert.ok(ownedOid, 'New database OID not found.');
      report.initialDatabaseOid = ownedOid;

      work = checked(exec(['mktemp', '-d', `/tmp/${database}.XXXXXX`]), 'Create private fixture directory');
      assert.ok(new RegExp(`^/tmp/${database}\\.[A-Za-z0-9]{6}$`).test(work), 'Unexpected temporary path.');
      checked(exec(['mkdir', `${work}/backups`, `${work}/temp`]), 'Create fixture subdirectories');
      report.scriptSha256 = {};
      for (const script of ['backup.sh', 'restore.sh']) {
        const source = fs.readFileSync(path.join(ROOT, 'deploy/scripts', script), 'utf8').replaceAll('\r\n', '\n');
        checked(exec(['sh', '-c', 'umask 077; cat > "$1"', 'audit-ops-copy', `${work}/${script}`], source), `Copy ${script}`);
        const digest = crypto.createHash('sha256').update(source).digest('hex');
        const copied = checked(exec(['sha256sum', `${work}/${script}`]), `Verify ${script}`).split(/\s/)[0];
        assert.equal(copied, digest, 'Copied script hash mismatch.');
        report.scriptSha256[script] = digest;
      }

      checkOwnedDatabase();
      sql(database, "CREATE TABLE public.audit_ops_fixture (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO public.audit_ops_fixture VALUES (1, 'fixture_alpha'), (2, 'fixture_beta');", 'Seed one fictional table');
      const original = tableState();
      assert.equal(original.tables, 1);
      assert.deepEqual(original.rows, [{ id: 1, payload: 'fixture_alpha' }, { id: 2, payload: 'fixture_beta' }]);
      report.original = original;
      checked(runScript('backup.sh'), 'Real backup script');
      const archives = checked(exec(['find', `${work}/backups`, '-maxdepth', '1', '-type', 'f', '-name', 'kayford_perf_*.sql.gz']), 'Locate generated archive').split('\n');
      assert.equal(archives.length, 1);
      archive = archives[0];
      assert.ok(archive.startsWith(`${work}/backups/`) && /^kayford_perf_[0-9]{8}_[0-9]{6}_[A-Za-z0-9]{6}\.sql\.gz$/.test(path.posix.basename(archive)), 'Unexpected archive path.');
      report.archiveSha256 = checked(exec(['sha256sum', archive]), 'Hash archive').split(/\s/)[0];
      report.checks.realBackup = true;

      checkOwnedDatabase();
      sql(database, "UPDATE public.audit_ops_fixture SET payload='changed_after_backup' WHERE id=1; DELETE FROM public.audit_ops_fixture WHERE id=2; INSERT INTO public.audit_ops_fixture VALUES (3, 'new_after_backup');", 'Mutate fictional rows');
      const modified = tableState();
      assert.notDeepEqual(modified.rows, original.rows);
      const confirmation = `RESTORE 127.0.0.1:5432/${database}\n`;
      checked(exec(['sh', '-c', 'umask 077; printf "not a gzip archive\\n" > "$1"', 'audit-ops-corrupt', `${work}/corrupt.sql.gz`]), 'Create corrupt fixture');
      const corruptResult = runScript('restore.sh', `${work}/corrupt.sql.gz`, confirmation);
      assert.ok(!corruptResult.error && corruptResult.status !== null && corruptResult.status !== 0, 'Corrupt archive was not rejected cleanly.');
      checkOwnedDatabase();
      assert.deepEqual(tableState(), modified, 'Corrupt archive altered the database/table/rows.');
      assert.ok(!corruptResult.stdout.includes('WARNING:'), 'Corrupt archive reached destructive confirmation.');
      report.corruptArchive = { exitCode: corruptResult.status, databaseOid: ownedOid, stateAfter: modified };
      report.checks.corruptRejectedBeforeDrop = true;

      checked(runScript('restore.sh', archive, confirmation), 'Real restore script');
      const afterRestore = databases();
      assertExistingUnchanged(before, afterRestore, database);
      const restoredOid = afterRestore.find((item) => item.name === database)?.oid;
      assert.ok(restoredOid && restoredOid !== ownedOid, 'Restore did not recreate the disposable database.');
      ownedOid = restoredOid;
      report.restoredDatabaseOid = restoredOid;
      const restored = tableState();
      assert.equal(restored.tables, 1);
      assert.deepEqual(restored.rows, original.rows, 'Restored fictional data differs from backup.');
      report.restored = restored;
      report.checks.realRestoreMatches = true;
    }
  } catch (error) {
    failure = error;
    report.failure = error.message;
  } finally {
    // Only this invocation's successful CREATE grants permission to DROP.
    if (created) {
      try {
        checkOwnedDatabase();
        sql('postgres', 'DROP DATABASE :"audit_db";', 'Clean owned disposable database');
        created = false;
        report.checks.ownedDatabaseRemoved = true;
      } catch (error) {
        report.cleanupFailure = error.message;
        failure ||= error;
      }
    }
    if (work && new RegExp(`^/tmp/${database}\\.[A-Za-z0-9]{6}$`).test(work)) {
      try {
        // Explicit owned files only; no recursive deletion or wildcard database cleanup.
        const files = [`${work}/backup.sh`, `${work}/restore.sh`, `${work}/corrupt.sql.gz`];
        if (archive && archive.startsWith(`${work}/backups/`)) files.push(archive);
        checked(exec(['rm', '-f', '--', ...files]), 'Remove owned fixture files');
        checked(exec(['rmdir', `${work}/backups`, `${work}/temp`, work]), 'Remove owned fixture directories');
        report.checks.ownedFilesRemoved = true;
      } catch (error) {
        report.fileCleanupFailure = error.message;
        failure ||= error;
      }
    }
    if (before.length) {
      try {
        report.existingAfter = databases();
        assert.deepEqual(report.existingAfter, before, 'Final database names/OIDs differ from baseline.');
        report.checks.existingCatalogUnchanged = true;
        inspect(pinned.id, pinned);
        report.checks.containerNotRestarted = true;
      } catch (error) {
        report.finalCheckFailure = error.message;
        failure ||= error;
      }
    }
    report.finishedAt = new Date().toISOString();
    report.status = failure ? 'failed' : 'passed';
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ ...report, evidence: reportPath }, null, 2));
  }
  return failure ? 1 : 0;
}

if (require.main === module) {
  if (process.argv.length !== 3 || !['--preflight', '--run'].includes(process.argv[2])) {
    console.error('Usage: node scripts/tests/ops-postgres-verify.cjs --preflight|--run');
    process.exitCode = 2;
  } else {
    try { process.exitCode = main(process.argv[2]); }
    catch { console.error('Verification stopped. Check the evidence directory before retrying; raw output suppressed.'); process.exitCode = 1; }
  }
}

module.exports = { assertContainer, assertOwnedTarget, assertExistingUnchanged };
