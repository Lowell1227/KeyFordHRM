const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
if (fs.existsSync(path.join(root, '.env'))) throw new Error('Use a worktree without api/.env so application boot cannot load existing service configuration');
const runId = randomUUID();
const names = [`goal-test-pg-${runId}`, `goal-test-redis-${runId}`];
const env = { ...process.env, POSTGRES_PASSWORD: randomUUID(), JWT_SECRET: randomUUID(),
  EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: randomUUID(), ENABLE_TEST_QUICK_LOGIN: 'false',
  DINGTALK_NOTIFICATION_ENABLED: 'false', DINGTALK_BOT_STREAM_ENABLED: 'false',
  DINGTALK_BOT_PREFLIGHT_CONFIRMED: 'false', GOAL_TEST_RUN_ID: runId };
function command(exe, args, inherit = false) {
  const r = spawnSync(exe, args, { cwd: root, env, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe' });
  if (r.status !== 0) throw new Error(`${exe} failed (${r.status})`);
  return r.stdout?.trim();
}
try {
  command('docker', ['run', '-d', '--name', names[0], '--label', `goal-test-run=${runId}`, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=hrm_goal_approval_test', '-p', '127.0.0.1::5432', 'postgres:15-alpine']);
  command('docker', ['run', '-d', '--name', names[1], '--label', `goal-test-run=${runId}`, '-p', '127.0.0.1::6379', 'redis:7-alpine']);
  for (const name of names) {
    const detail = JSON.parse(command('docker', ['inspect', name]))[0];
    if (detail.Config.Labels['goal-test-run'] !== runId || detail.Mounts.some(m => m.Type === 'bind')) throw new Error('Unsafe container identity');
  }
  const pgPort = command('docker', ['port', names[0], '5432/tcp']).split(':').pop();
  const redisPort = command('docker', ['port', names[1], '6379/tcp']).split(':').pop();
  env.DATABASE_URL = `postgresql://postgres:${env.POSTGRES_PASSWORD}@127.0.0.1:${pgPort}/hrm_goal_approval_test`;
  env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (spawnSync('docker', ['exec', names[0], 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  if (!ready) throw new Error('PostgreSQL did not start');
  console.log('Fresh labelled PostgreSQL and Redis created; deploying all migrations.');
  command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], true);
  command(process.execPath, [path.join(root, 'node_modules/jest/bin/jest.js'), '--config', 'test/goal-approval/jest.config.json', '--runInBand'], true);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  for (const name of names) {
    const found = spawnSync('docker', ['inspect', name], { encoding: 'utf8' });
    if (found.status === 0 && JSON.parse(found.stdout)[0].Config.Labels['goal-test-run'] === runId) command('docker', ['rm', '-f', '-v', name]);
  }
  console.log('Owned ephemeral containers and anonymous volumes removed.');
}
