const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gzipSync, gunzipSync } = require('node:zlib');

const root = path.resolve(__dirname, '../..');
const bash = process.platform === 'win32'
  ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const revision = '1234567890abcdef1234567890abcdef12345678';
const posix = (value) => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ops-test-'));
  t.after(() => {
    assert.ok(path.dirname(dir) === path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('audit-ops-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const bin = path.join(dir, 'bin');
  const repo = path.join(dir, 'repo');
  const backups = path.join(dir, 'backups');
  const archive = path.join(dir, 'archive');
  const releases = path.join(dir, 'releases');
  for (const folder of [bin, repo, backups, archive, releases]) fs.mkdirSync(folder);
  for (const script of ['deploy/scripts/backup.sh', 'deploy/scripts/restore.sh', 'scripts/update-prod.sh']) {
    const destination = path.join(repo, script);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    let source = fs.readFileSync(path.join(root, script), 'utf8').replaceAll('\r\n', '\n');
    // Remap only the legacy hard-coded directory when reproducing the old bug.
    // No real /backups path or real environment file is ever used by this suite.
    source = source.replace(/^BACKUP_DIR=\/backups$/m, `BACKUP_DIR="${posix(backups)}"`);
    fs.writeFileSync(destination, source);
  }
  fs.writeFileSync(path.join(repo, '.env'), 'POSTGRES_DB=audit_ops_fixture\n');
  for (const name of ['api', 'web', 'deploy/scripts']) fs.mkdirSync(path.join(archive, name), { recursive: true });
  for (const name of ['docker-compose.yml', 'docker-compose.prod.yml']) {
    fs.copyFileSync(path.join(root, name), path.join(archive, name));
  }
  fs.copyFileSync(path.join(repo, 'deploy/scripts/backup.sh'), path.join(archive, 'deploy/scripts/backup.sh'));
  fs.writeFileSync(path.join(archive, 'web', 'pinned.txt'), 'verified archive');
  const stub = fs.readFileSync(path.join(__dirname, 'ops-command-stub.sh'), 'utf8').replaceAll('\r\n', '\n');
  for (const command of ['docker', 'git', 'psql', 'pg_dump', 'curl', 'sleep', 'gzip', 'mv']) {
    fs.writeFileSync(path.join(bin, command), stub, { mode: 0o755 });
  }
  const log = path.join(dir, 'commands.log');
  fs.writeFileSync(log, '');
  const backupFile = path.join(dir, 'fixture.sql.gz');
  fs.writeFileSync(backupFile, gzipSync('CREATE TABLE fixture (id integer);\n'));
  function run(script, args = [], env = {}, input = '') {
    const result = spawnSync(bash, [
      '--noprofile', '--norc', '-c',
      'export PATH="$OPS_BIN:/usr/bin:/bin"; exec "$@"', 'ops-test',
      script === 'scripts/update-prod.sh' ? 'bash' : 'sh',
      posix(path.join(repo, script)), ...args,
    ], {
      cwd: repo, encoding: 'utf8', input, timeout: 20000,
      env: {
        SystemRoot: process.env.SystemRoot || '', WINDIR: process.env.WINDIR || '',
        HOME: posix(dir), TEMP: dir, TMP: dir, TMPDIR: posix(dir),
        PATH: '', MSYS_NO_PATHCONV: '1',
        OPS_BIN: posix(bin), OPS_LOG: posix(log), OPS_REV: revision,
        OPS_ARCHIVE: posix(archive), HRM_RELEASE_ROOT: posix(releases),
        BACKUP_DIR: posix(backups), POSTGRES_HOST: 'fixture-host', POSTGRES_PORT: '5439',
        POSTGRES_USER: 'fixture_owner', POSTGRES_DB: 'audit_ops_fixture', POSTGRES_PASSWORD: 'fixture-only',
        ...env,
      },
    });
    assert.ifError(result.error);
    return { ...result, log: fs.readFileSync(log, 'utf8'), output: result.stdout + result.stderr };
  }
  return {
    dir, repo, backups, releases, backupFile, run,
    update: (env = {}, args = ['--revision', revision, '--services', 'web']) => run('scripts/update-prod.sh', args, env),
    restore: (env = {}, input = 'RESTORE fixture-host:5439/audit_ops_fixture\n') =>
      run('deploy/scripts/restore.sh', [posix(backupFile)], env, input),
  };
}

test('backup rejects partial pg_dump and preserves old backups', (t) => {
  const f = fixture(t);
  const old = path.join(f.backups, 'kayford_perf_old.sql.gz');
  fs.writeFileSync(old, gzipSync('old backup'));
  fs.utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
  const result = f.run('deploy/scripts/backup.sh', [], { DUMP_EXIT: '1' });
  assert.notEqual(result.status, 0, result.output);
  assert.deepEqual(fs.readdirSync(f.backups), ['kayford_perf_old.sql.gz']);
  assert.doesNotMatch(result.output, /Backup complete|备份完成/);
});

for (const env of [{ DUMP_EMPTY: '1' }, { GZIP_FAIL: '1' }, { GZIP_CORRUPT: '1' }, { FINALIZE_FAIL: '1' }]) {
  test(`backup rejects ${Object.keys(env)[0]} without finalizing`, (t) => {
    const f = fixture(t);
    const old = path.join(f.backups, 'kayford_perf_old.sql.gz');
    fs.writeFileSync(old, gzipSync('old backup'));
    fs.utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
    const result = f.run('deploy/scripts/backup.sh', [], env);
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(fs.readdirSync(f.backups), ['kayford_perf_old.sql.gz']);
  });
}

test('backup validates and publishes unique archives before scoped retention', (t) => {
  const f = fixture(t);
  for (const name of ['kayford_perf_old.sql.gz', 'unrelated.sql.gz']) {
    const file = path.join(f.backups, name);
    fs.writeFileSync(file, gzipSync('old backup'));
    fs.utimesSync(file, new Date('2020-01-01'), new Date('2020-01-01'));
  }
  for (let i = 0; i < 2; i++) {
    const result = f.run('deploy/scripts/backup.sh');
    assert.equal(result.status, 0, result.output);
  }
  const files = fs.readdirSync(f.backups);
  assert.ok(files.includes('unrelated.sql.gz'));
  assert.ok(!files.includes('kayford_perf_old.sql.gz'));
  const generated = files.filter((name) => name !== 'unrelated.sql.gz');
  assert.equal(generated.length, 2);
  for (const name of generated) assert.match(gunzipSync(fs.readFileSync(path.join(f.backups, name))).toString(), /CREATE TABLE fixture/);
});

test('restore separates database DDL and sets port and SQL error stops on every call', (t) => {
  const result = fixture(t).restore();
  assert.equal(result.status, 0, result.output);
  const calls = result.log.split('\n').filter((line) => line.startsWith('psql\t'));
  assert.ok(calls.length >= 4);
  for (const call of calls) {
    assert.match(call, /\tON_ERROR_STOP=1(?:\t|$)/);
    assert.match(call, /\t-p\t5439(?:\t|$)/);
    assert.match(call, /\t-X(?:\t|$)/);
  }
  for (const line of result.log.split('\n')) assert.ok(!(line.includes('DROP DATABASE') && line.includes('CREATE DATABASE')));
});

test('restore cannot report success when SQL import fails', (t) => {
  // Permit the independent legacy DDL bug here to expose psql's default exit-0 behavior.
  const result = fixture(t).restore({ ALLOW_COMBINED_DDL: '1', SQL_FAIL_MATCH: 'CREATE TABLE' });
  assert.match(result.log, /CREATE TABLE/);
  assert.notEqual(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /Restore complete|恢复完成/);
});

for (const input of ['\n', 'yes\n', 'RESTORE other-host:5439/audit_ops_fixture\n', '']) {
  test(`restore refuses non-target confirmation ${JSON.stringify(input)}`, (t) => {
    const result = fixture(t).restore({}, input);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.log, /pg_terminate_backend|DROP DATABASE|CREATE DATABASE/);
  });
}

for (const badFile of ['missing', 'corrupt', 'empty']) {
  test(`restore preflights ${badFile} archive before destructive commands`, (t) => {
    const f = fixture(t);
    if (badFile === 'missing') fs.unlinkSync(f.backupFile);
    if (badFile === 'corrupt') fs.writeFileSync(f.backupFile, 'not gzip');
    if (badFile === 'empty') fs.writeFileSync(f.backupFile, gzipSync(''));
    const result = f.restore();
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.log, /pg_terminate_backend|DROP DATABASE|CREATE DATABASE/);
  });
}

for (const stage of ['SELECT 1', 'pg_terminate_backend', 'DROP DATABASE', 'CREATE DATABASE', 'CREATE TABLE']) {
  test(`restore stops at SQL failure in ${stage}`, (t) => {
    const result = fixture(t).restore({ SQL_FAIL_MATCH: stage });
    assert.ok(result.log.includes(stage), result.log);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /Restore complete|恢复完成/);
    const ordered = ['pg_terminate_backend', 'DROP DATABASE', 'CREATE DATABASE', 'CREATE TABLE'];
    const next = ordered.indexOf(stage) + 1;
    for (const later of ordered.slice(next)) assert.ok(!result.log.includes(later), result.log);
  });
}

for (const dirty of [' M web/src/changed.vue\n', 'M  api/src/changed.ts\n', '?? web/src/untracked.ts\n']) {
  test(`deploy rejects dirty source ${dirty.trim()}`, (t) => {
    const result = fixture(t).update({ GIT_DIRTY: dirty });
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.log, /^docker\t/m);
  });
}

for (const env of [{ REMOTE_FAIL: '1' }, { REMOTE_REV: 'f'.repeat(40) }, { GIT_HEAD: 'f'.repeat(40) }, { GIT_STATUS_FAIL: '1' }, { ARCHIVE_FAIL: '1' }]) {
  test(`deploy rejects unverified revision (${Object.keys(env)[0]})`, (t) => {
    const result = fixture(t).update(env);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.log, /^docker\t/m);
  });
}

for (const args of [[], ['--revision', revision], ['--revision', revision, '--services', 'postgres'], ['--revision', 'main', '--services', 'web']]) {
  test(`deploy requires exact revision and affected service scope (${args.join(' ')})`, (t) => {
    const result = fixture(t).update({}, args);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.log, /^docker\t/m);
  });
}

test('Web-only deploy builds pinned archive, retains rollback, and never runs API or backup', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.repo, 'web'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'web/ignored.local'), 'must not enter image');
  const result = f.update();
  assert.equal(result.status, 0, result.output);
  assert.match(result.log, /git\tarchive[^\n]*1234567890abcdef1234567890abcdef12345678/);
  assert.match(result.log, /docker\ttag\tsha256:fixture-old-image\tkayford-deploy-web:rollback-/);
  assert.match(result.log, /\tbuild\tweb\n/);
  assert.match(result.log, /\tup\t-d\t--no-deps\t--no-build\tweb\n/);
  assert.doesNotMatch(result.log, /\tpull\b|migrate|\trun\t|\tup[^\n]*\tapi(?:\t|\n)/);
  const release = path.join(f.releases, fs.readdirSync(f.releases)[0]);
  assert.equal(fs.existsSync(path.join(release, 'web/ignored.local')), false);
  assert.equal(fs.readFileSync(path.join(release, 'web/pinned.txt'), 'utf8'), 'verified archive');
  const override = fs.readFileSync(path.join(release, 'release.override.yml'), 'utf8');
  assert.match(override, /org.opencontainers.image.revision/);
  assert.match(override, new RegExp(revision));
  assert.match(override, /context: .*\/web/);
});

test('API replacement requires successful backup before up and retains rollback', (t) => {
  const result = fixture(t).update({}, ['--revision', revision, '--services', 'api']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.log, /\trun\t--rm\t--no-deps\tbackup/);
  assert.match(result.log, /docker\ttag[^\n]*kayford-deploy-api:rollback-/);
  assert.ok(result.log.indexOf('\trun\t') < result.log.indexOf('\tup\t'));
  assert.match(result.log, /\tup\t-d\t--no-deps\t--no-build\tapi\n/);
});

for (const fail of [' run ', ' build ', 'tag']) {
  test(`deploy stops before replacement on ${fail.trim()} failure`, (t) => {
    const result = fixture(t).update({ DOCKER_FAIL_MATCH: fail }, ['--revision', revision, '--services', 'api,web']);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.log, /\tup\t/);
  });
}

test('deploy rejects a running container owned by a different project', (t) => {
  const result = fixture(t).update({ DOCKER_PROJECT: 'hrm' });
  assert.notEqual(result.status, 0, result.output);
  assert.doesNotMatch(result.log, /\ttag\t|\tbuild\t|\tup\t|\trun\t/);
});

test('deploy refuses missing private configuration without calling Docker', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.repo, '.env'));
  const result = f.update();
  assert.notEqual(result.status, 0, result.output);
  assert.doesNotMatch(result.log, /^docker\t/m);
});

for (const env of [{ DEPLOYED_REV: 'f'.repeat(40) }, { HEALTH_FAIL: '1' }]) {
  test(`deploy reports failure after replacement when ${Object.keys(env)[0]} fails`, (t) => {
    const result = fixture(t).update(env);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.log, /\tup\t/);
    assert.doesNotMatch(result.output, /Services replaced:/);
    assert.doesNotMatch(result.log, /restore|\trun\t/);
  });
}

for (const database of ['postgres', 'template0', 'template1']) {
  test(`restore refuses maintenance database ${database}`, (t) => {
    const result = fixture(t).restore({ POSTGRES_DB: database });
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.log, /^psql\t/m);
  });
}

test('restore rejects missing connection environment before any database call', (t) => {
  const result = fixture(t).restore({ POSTGRES_PORT: '' });
  assert.notEqual(result.status, 0, result.output);
  assert.doesNotMatch(result.log, /^psql\t/m);
});

test('combined service scope still excludes all supporting services', (t) => {
  const result = fixture(t).update({}, ['--revision', revision, '--services', 'api,web']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.log, /\tbuild\tapi\tweb\n/);
  assert.match(result.log, /\tup\t-d\t--no-deps\t--no-build\tapi\tweb\n/);
  assert.doesNotMatch(result.log, /\tup[^\n]*(postgres|redis|minio|backup)/);
  assert.equal((result.log.match(/\tbuild\t/g) || []).length, 1);
  assert.doesNotMatch(result.log, /nginx\t-s\treload/);
});

test('API-only refreshes stale Web upstream after new API readiness without replacing Web', (t) => {
  const result = fixture(t).update({ REQUIRE_WEB_RELOAD: '1', API_READY_AFTER: '2' }, ['--revision', revision, '--services', 'api']);
  assert.equal(result.status, 0, result.output);
  assert.equal((result.log.match(/docker\texec\tcontainer-api\tnode\t-e\t/g) || []).length, 3);
  assert.match(result.log, /docker\texec\tcontainer-web\tnginx\t-t\n/);
  assert.match(result.log, /docker\texec\tcontainer-web\tnginx\t-s\treload\n/);
  const reload = result.log.indexOf('docker\texec\tcontainer-web\tnginx\t-s\treload');
  assert.ok(result.log.lastIndexOf('docker\texec\tcontainer-api\tnode\t-e\t') < reload);
  assert.ok(result.log.indexOf('nginx\t-t\n') < reload);
  assert.match(result.log, /com.docker.compose.project[^\n]*container-web/);
  assert.match(result.log, /com.docker.compose.service[^\n]*container-web/);
  assert.doesNotMatch(result.log, /\t(build|up|restart)[^\n]*\t(web|postgres|redis|minio)(?:\t|\n)/);
});

for (const env of [{ WEB_PROJECT: 'hrm' }, { WEB_SERVICE: 'api' }, { API_READY_AFTER: '999' }]) {
  test(`API-only refuses reload when ${Object.keys(env)[0]} fails`, (t) => {
    const result = fixture(t).update(env, ['--revision', revision, '--services', 'api']);
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.log, /nginx\t/);
    assert.doesNotMatch(result.output, /Services replaced:/);
  });
}

for (const command of ['nginx -t', 'nginx -s reload']) {
  test(`API-only reports ${command} failure without recreating Web`, (t) => {
    const result = fixture(t).update({ DOCKER_FAIL_MATCH: command }, ['--revision', revision, '--services', 'api']);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.log, /docker\texec\tcontainer-web\tnginx\t/);
    assert.doesNotMatch(result.log, /\t(build|up|restart)[^\n]*\tweb(?:\t|\n)/);
    assert.doesNotMatch(result.output, /Services replaced:/);
    if (command === 'nginx -t') assert.doesNotMatch(result.log, /nginx\t-s\treload/);
  });
}
