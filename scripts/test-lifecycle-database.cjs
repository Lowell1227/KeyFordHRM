const { execFileSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

// This database is separate even from the shared fictional preview. Never adopt or clear one.
const run = (args, input) => execFileSync('docker', args, {
  encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000, maxBuffer: 8 * 1024 * 1024,
});
try {
  const inspect = name => JSON.parse(run(['inspect', name]))[0];
  const api = inspect('hrm-api-1'), pg = inspect('hrm-postgres-1');
  for (const [container, service] of [[api, 'api'], [pg, 'postgres']]) {
    if (container.Config.Labels['com.docker.compose.project'] !== 'hrm'
      || container.Config.Labels['com.docker.compose.service'] !== service) throw Error('unexpected container');
  }
  const env = Object.fromEntries(api.Config.Env.map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
  require('../api/prisma/preview-guard.cjs').assertPreviewEnvironment(env);
  const pgUser = pg.Config.Env.find(line => line.startsWith('POSTGRES_USER='))?.slice(14);
  if (!pgUser || !/^[a-z_][a-z0-9_]*$/.test(pgUser)) throw Error('unexpected database operator');
  const sql = query => run(['exec', '-i', 'hrm-postgres-1', 'psql', '-U', pgUser, '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], query).trim();
  const existing = sql("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='hrm_lifecycle_test';");
  const role = sql("SELECT rolname FROM pg_roles WHERE rolname='hrm_lifecycle_test' AND NOT rolsuper AND NOT rolcreatedb;");
  if (existing || role) {
    if (!process.argv.includes('--reuse') || existing !== 'hrm_lifecycle_test' || role !== 'hrm_lifecycle_test') throw Error('unverified test database');
  }
  const password = randomBytes(32).toString('hex');
  sql(`${existing ? 'ALTER' : 'CREATE'} ROLE hrm_lifecycle_test LOGIN PASSWORD '${password}';`);
  if (!existing) sql('CREATE DATABASE hrm_lifecycle_test OWNER hrm_lifecycle_test;');
  const url = `postgresql://hrm_lifecycle_test:${password}@postgres:5432/hrm_lifecycle_test`;
  const base = ['exec', '-e', `DATABASE_URL=${url}`, '-e', `PERFORMANCE_LIFECYCLE_TEST_DATABASE_URL=${url}`,
    '-e', 'NODE_OPTIONS=--max-old-space-size=1536', 'hrm-api-1'];
  run([...base, 'npx', 'prisma', 'migrate', 'deploy']);
  if (existing) {
    const migration = readFileSync(resolve(__dirname, '../api/prisma/migrations/20261126110000_performance_lifecycle/migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(migration).digest('hex');
    const statements = migration.match(/-- Preserved business states[\s\S]*?(?=-- Same-row)/)[0]
      .split(';').map(sql => sql.trim()).filter(Boolean);
    statements.push(migration.match(/CREATE FUNCTION performance_task_write_guard\(\)[\s\S]*?\$\$;/)[0]
      .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
    const refresh = `const {PrismaClient}=require('@prisma/client');const d=new PrismaClient();d.$transaction(async t=>{
      const row=(await t.$queryRawUnsafe('SELECT current_database() AS name,current_user AS owner'))[0];
      if(row.name!=='hrm_lifecycle_test'||row.owner!=='hrm_lifecycle_test')throw Error('guard');
      const m=await t.$queryRawUnsafe('SELECT checksum FROM _prisma_migrations WHERE migration_name=$1','20261126110000_performance_lifecycle');
      if(m[0]?.checksum!==${JSON.stringify(checksum)}){
        for(const sql of ${JSON.stringify(statements)})await t.$executeRawUnsafe(sql);
        await t.$executeRawUnsafe('UPDATE _prisma_migrations SET checksum=$1 WHERE migration_name=$2',${JSON.stringify(checksum)},'20261126110000_performance_lifecycle');
      }}).finally(()=>d.$disconnect());`;
    run([...base.slice(0, -1), '-i', base.at(-1), 'node'], refresh);
  }
  console.log('Dedicated fictional database migrated; running real PostgreSQL contracts.');
  let testFailed = false;
  try { run([...base, 'npx', 'jest', '--config', 'test/performance-lifecycle/jest.config.json', '--runInBand',
    '--json', '--outputFile=/tmp/hrm-lifecycle-result.json']); } catch (error) {
      testFailed = true;
      const diagnostic = String(error.stderr ?? '').split(/\r?\n/).filter(line => /Error:|TS\d{4}:|FATAL ERROR|Cannot find module/.test(line))
        .join('\n').replace(/postgresql:\/\/\S+/g, '[connection redacted]').slice(0, 1500);
      if (diagnostic) console.error(diagnostic);
    }
  const report = JSON.parse(run(['exec', 'hrm-api-1', 'node', '-e',
    "process.stdout.write(require('fs').readFileSync('/tmp/hrm-lifecycle-result.json','utf8'))"]));
  console.log(JSON.stringify({ suites: report.numTotalTestSuites, passed: report.numPassedTests, failed: report.numFailedTests,
    failures: report.testResults.flatMap(file => file.assertionResults.filter(test => test.status === 'failed').map(test => test.fullName)) }));
  if (testFailed) throw Error('isolated contracts failed');
  console.log('Lifecycle database contracts passed. Database retained for inspection; no preview or production data cleared.');
} catch (error) {
  // Connection strings and Prisma diagnostics can contain credentials; report only a bounded category.
  console.error(error.status ? `Isolated lifecycle command failed (exit ${error.status}); private output withheld.`
    : 'Lifecycle database preparation refused; inspect the isolated resources before retrying.');
  process.exitCode = 1;
}
