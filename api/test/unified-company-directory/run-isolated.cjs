const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const scratch = path.resolve(root, '../tmp/company-directory-integration');
const statePath = path.join(scratch, 'session.local');
const nullableMigration = '20261116090000_nullable_employment_company';
const referenceMigration = '20261116100000_personnel_reference_identity';
const marker = 'company-directory-test-run';
if (fs.existsSync(path.join(root, '.env'))) throw new Error('Refusing application configuration from api/.env');
fs.mkdirSync(scratch, { recursive: true });
let state;
let env = { ...process.env, NODE_ENV: 'test', ENABLE_TEST_QUICK_LOGIN: 'false',
  DINGTALK_NOTIFICATION_ENABLED: 'false', DINGTALK_BOT_STREAM_ENABLED: 'false',
  DINGTALK_BOT_PREFLIGHT_CONFIRMED: 'false' };
function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, { cwd: root, env, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${path.basename(exe)} failed (${result.status}): ${result.stderr || result.stdout || ''}`);
  return result.stdout?.trim();
}
function verifyOwned(name) {
  const detail = JSON.parse(command('docker', ['inspect', name]))[0];
  if (detail.Config.Labels[marker] !== state.runId || detail.Mounts.some(m => m.Type === 'bind')) {
    throw new Error('Container ownership or mount verification failed');
  }
  return detail;
}
function useState() {
  env = { ...env, ...state.environment };
  const db = new URL(env.DATABASE_URL);
  const redis = new URL(env.REDIS_URL);
  if (db.hostname !== '127.0.0.1' || db.pathname !== '/hrm_company_directory_test' || db.port === '5432'
    || redis.hostname !== '127.0.0.1' || redis.port === '6379') throw new Error('Unsafe isolated endpoint');
  state.names.forEach(verifyOwned);
}
function sql(statement) {
  return command('docker', ['exec', '-i', state.names[0], 'psql', '-U', 'postgres', '-d', 'hrm_company_directory_test', '-v', 'ON_ERROR_STOP=1', '-tA'], { input: statement });
}
function cleanup() {
  for (const name of state.names) {
    verifyOwned(name);
    command('docker', ['rm', '-f', '-v', name]);
  }
  fs.unlinkSync(statePath);
  console.log('Removed only labelled owned containers and their anonymous volumes.');
}
try {
  if (process.argv.includes('--reuse') || process.argv.includes('--cleanup')) {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    useState();
  } else {
    if (fs.existsSync(statePath)) throw new Error('An owned session already exists; use --reuse or --cleanup');
    const runId = randomUUID();
    state = { runId, names: [`company-directory-pg-${runId}`, `company-directory-redis-${runId}`] };
    env.POSTGRES_PASSWORD = randomUUID();
    command('docker', ['run', '-d', '--name', state.names[0], '--label', `${marker}=${runId}`, '-e', 'POSTGRES_PASSWORD',
      '-e', 'POSTGRES_DB=hrm_company_directory_test', '-p', '127.0.0.1::5432', 'postgres:14-alpine']);
    command('docker', ['run', '-d', '--name', state.names[1], '--label', `${marker}=${runId}`,
      '-p', '127.0.0.1::6379', 'redis:7-alpine']);
    const pgPort = command('docker', ['port', state.names[0], '5432/tcp']).split(':').pop();
    const redisPort = command('docker', ['port', state.names[1], '6379/tcp']).split(':').pop();
    state.environment = {
      POSTGRES_PASSWORD: env.POSTGRES_PASSWORD,
      DATABASE_URL: `postgresql://postgres:${env.POSTGRES_PASSWORD}@127.0.0.1:${pgPort}/hrm_company_directory_test`,
      REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      JWT_SECRET: randomUUID(), EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: randomUUID(), COMPANY_DIRECTORY_TEST_RUN_ID: runId,
    };
    fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
    useState();
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (spawnSync('docker', ['exec', state.names[0], 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    if (!ready) throw new Error('PostgreSQL did not become ready');
    const baseline = path.join(scratch, runId, 'prisma');
    fs.mkdirSync(path.join(baseline, 'migrations'), { recursive: true });
    fs.copyFileSync(path.join(root, 'prisma/schema.prisma'), path.join(baseline, 'schema.prisma'));
    for (const entry of fs.readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true })) {
      if ([nullableMigration, referenceMigration].includes(entry.name)) continue;
      fs.cpSync(path.join(root, 'prisma/migrations', entry.name), path.join(baseline, 'migrations', entry.name), { recursive: true });
    }
    command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(baseline, 'schema.prisma')]);
    const columnQuery = `SELECT is_nullable FROM information_schema.columns WHERE table_name='employment_records' AND column_name='company';`;
    if (sql(columnQuery) !== 'NO') throw new Error('Baseline company column should be NOT NULL');
    sql(`INSERT INTO users (id,name,employee_no,status) VALUES ('11111111-1111-4111-8111-111111111111','Synthetic migration sentinel','MIGRATION-LEGACY','active');
      INSERT INTO employment_records (id,user_id,effective_from,company,company_text,change_type)
      VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','2030-01-01','fuede','Synthetic legacy snapshot','hire');`);
    command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy']);
    if (sql(columnQuery) !== 'YES') throw new Error('New migration did not make legacy company nullable');
    if (sql(`SELECT company || '|' || company_text FROM employment_records WHERE id='22222222-2222-4222-8222-222222222222';`) !== 'fuede|Synthetic legacy snapshot') {
      throw new Error('Migration changed legacy data');
    }
    if (sql(`SELECT job_grade_id IS NULL AND job_family_id IS NULL AND work_location_id IS NULL FROM employment_records WHERE id='22222222-2222-4222-8222-222222222222';`) !== 't') {
      throw new Error('Migration guessed historical personnel reference identities');
    }
    console.log('Real migrations passed: nullable legacy company and stable reference IDs; legacy snapshots unchanged and no inferred references.');
  }
  if (process.argv.includes('--cleanup')) { cleanup(); process.exit(0); }
  if (process.argv.includes('--migrate')) {
    command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy']);
    console.log('Applied pending migrations only to the verified disposable database.');
  }
  if (process.argv.includes('--browser') || process.argv.includes('--browser-only')) env.COMPANY_DIRECTORY_BROWSER = 'true';
  if (!process.argv.includes('--prepare-only')) {
    const browserOnly = process.argv.includes('--browser-only');
    const consistencyOnly = process.argv.includes('--consistency-only');
    const args = [path.join(root, 'node_modules/jest/bin/jest.js'), '--config', 'test/unified-company-directory/jest.config.json', '--runInBand', '--json', '--outputFile', path.join(scratch, browserOnly ? 'browser-result.json' : consistencyOnly ? 'consistency-result.json' : 'jest-result.json')];
    if (browserOnly) args.push('--testNamePattern', 'through the real browser');
    if (consistencyOnly) args.push('--testPathPattern', 'personnel-consistency.integration');
    command(process.execPath, args, { stdio: 'inherit' });
  }
  console.log('Owned disposable session retained for final verification; cleanup with this runner --cleanup.');
} catch (error) {
  // Never emit the database URL, generated password, JWT secret, or token.
  const message = String(error.message).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted disposable database URL]');
  console.error(message);
  process.exitCode = 1;
}
