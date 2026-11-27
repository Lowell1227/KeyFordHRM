const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const name = 'hrm_cycle_termination_test', ownership = 'hrm-cycle-termination-test-20261127';
const run = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input,
  stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
try {
  const inspect = value => JSON.parse(run(['inspect', value]))[0];
  const api = inspect('hrm-api-1'), pg = inspect('hrm-postgres-1');
  if (api.Config.Labels['com.docker.compose.project'] !== 'hrm' || pg.Config.Labels['com.docker.compose.project'] !== 'hrm') throw Error('ownership');
  const env = Object.fromEntries(api.Config.Env.map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  require('../api/prisma/preview-guard.cjs').assertPreviewEnvironment(env);
  const pgUser = pg.Config.Env.find(line => line.startsWith('POSTGRES_USER='))?.slice(14);
  if (!/^[a-z_][a-z0-9_]*$/.test(pgUser ?? '')) throw Error('operator');
  const sql = query => run(['exec', '-i', pg.Id, 'psql', '-U', pgUser, '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], query).trim();
  const existing = sql(`SELECT pg_get_userbyid(datdba)||'|'||coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname='${name}';`);
  const role = sql(`SELECT rolname FROM pg_roles WHERE rolname='${name}' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole;`);
  if (existing || role) {
    if (existing !== `${name}|${ownership}` || role !== name
      || sql(`SELECT count(*) FROM pg_stat_activity WHERE datname='${name}';`) !== '0') throw Error('unverified or in-use isolated database');
  }
  const password = randomBytes(32).toString('hex');
  sql(`${role ? 'ALTER' : 'CREATE'} ROLE ${name} LOGIN PASSWORD '${password}';`);
  if (!existing) { sql(`CREATE DATABASE ${name} OWNER ${name};`); sql(`COMMENT ON DATABASE ${name} IS '${ownership}';`); }
  const url = `postgresql://${name}:${password}@postgres:5432/${name}`;
  const args = ['exec', '-e', `DATABASE_URL=${url}`, '-e', `CYCLE_TERMINATION_TEST_DATABASE_URL=${url}`,
    '-e', 'NODE_OPTIONS=--max-old-space-size=512', api.Id];
  run([...args, 'npx', 'prisma', 'migrate', 'deploy']);
  let failed = false;
  try { run([...args, 'npx', 'jest', '--config', 'test/performance-lifecycle/jest.cycle-termination.config.json', '--runInBand',
    '--json', '--outputFile=/tmp/hrm-cycle-termination-result.json']); }
  catch (error) {
    failed = true;
    const lines = String(error.stderr ?? '').split(/\r?\n/).filter(line => /TS\d{4}:|FATAL ERROR|Error:|Expected:|Received:|●/.test(line));
    console.error(lines.join('\n').replace(/postgresql:\/\/\S+/g, '[redacted]').slice(0, 4000));
  }
  const report = JSON.parse(run(['exec', api.Id, 'node', '-e', "process.stdout.write(require('fs').readFileSync('/tmp/hrm-cycle-termination-result.json','utf8'))"]));
  console.log(JSON.stringify({ suites: report.numTotalTestSuites, passed: report.numPassedTests, failed: report.numFailedTests,
    failures: report.testResults.flatMap(file => file.assertionResults.filter(test => test.status === 'failed').map(test => test.fullName)) }));
  if (failed || report.numFailedTests || !report.numPassedTests) process.exitCode = 1;
} catch { console.error('Isolated cycle-termination database preparation or tests failed; credentials withheld.'); process.exitCode = 1; }
