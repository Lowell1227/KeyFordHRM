const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const runId = randomUUID();
const scope = 'personnel-boolean-query-regression';
const suffix = `${Date.now()}-${runId.slice(0, 8)}`;
const output = path.join(root, 'tmp', `boolean-query-integration-${suffix}`);
const pg = `hrm-bool-pg-${suffix}`;
const redis = `hrm-bool-redis-${suffix}`;
const password = randomBytes(24).toString('hex');
const env = {
  ...process.env, NODE_ENV: 'test', FORCE_COLOR: '0', HRM_LIFECYCLE_QA: '1',
  DATABASE_URL: `postgresql://audit:${password}@127.0.0.1:15487/hrm_lifecycle_test`,
  REDIS_URL: 'redis://127.0.0.1:16487', REDIS_HOST: '127.0.0.1', REDIS_PORT: '16487', REDIS_PASSWORD: '',
  HRM_LIFECYCLE_WEB_URL: 'http://127.0.0.1:5188', ENABLE_TEST_QUICK_LOGIN: 'false',
  JWT_SECRET: randomBytes(32).toString('hex'), JWT_EXPIRES_IN: '7d',
  EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  AI_PROVIDER_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_CORP_ID: '', DINGTALK_AGENT_ID: '',
  DINGTALK_BOT_APP_KEY: '', DINGTALK_BOT_APP_SECRET: '', DINGTALK_BOT_HRM_URL: '',
  DINGTALK_NOTIFICATION_ENABLED: 'false', DINGTALK_INTERVIEW_CALENDAR_ENABLED: 'false',
  DINGTALK_BOT_STREAM_ENABLED: 'false', DINGTALK_BOT_PREFLIGHT_CONFIRMED: 'false',
  ARCHIVE_ASSISTANT_PILOT_ENABLED: 'false',
};
const secrets = [password, env.JWT_SECRET, env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY, env.AI_PROVIDER_ENCRYPTION_KEY];
const redact = (text) => secrets.reduce((value, secret) => value.replaceAll(secret, '[REDACTED]'), String(text || ''));
const sourceFiles = [
  'api/test/personnel-lifecycle/lifecycle.integration.spec.ts',
  'api/test/test-app.ts', 'api/test/jest-personnel-arrival-invitations.config.json',
  'api/src/common/dto/boolean-query.ts', 'api/src/users/dto/user-query.dto.ts',
  'api/src/departments/dto/department-query.dto.ts', 'api/src/positions/dto/position.dto.ts',
  'api/src/objectives/dto/objective-query.dto.ts', 'api/src/indicators/dto/indicator-query.dto.ts',
  'api/src/templates/templates.controller.ts', 'api/src/talent-pool/dto/talent-query.dto.ts',
];
const fingerprints = () => Object.fromEntries(sourceFiles.map((file) => [file,
  createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
]));
let vite;
let log;
const report = { runId, scope, output, status: 'starting', containersRemoved: [], startedAt: new Date().toISOString() };
function record(text) { if (log !== undefined) fs.writeSync(log, redact(text)); }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024, ...options });
  record(result.stdout); record(result.stderr);
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? 'spawn error'}); see redacted run.log`);
  return result.stdout.trim();
}
const sharedInventory = () => run('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project', '--format', '{{.ID}} {{.Names}} {{.Status}}'])
  .split(/\r?\n/).filter(line => / (hrm|kayford-deploy)-/.test(line)).map(line => line.split(' ').slice(0, 2).join(' ')).sort();
async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Required disposable port ${port} is occupied; refusing to replace anything`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function removeOwned(name) {
  const inspected = spawnSync('docker', ['inspect', '--format', '{{json .}}', name], { encoding: 'utf8', timeout: 30000 });
  if (inspected.status !== 0) return;
  const container = JSON.parse(inspected.stdout);
  if (container.Name !== `/${name}` || container.Config.Labels['hrm.qa.scope'] !== scope
    || container.Config.Labels['hrm.qa.run'] !== runId) throw new Error('Cleanup ownership mismatch; container left untouched');
  run('docker', ['rm', '-f', '-v', container.Id]);
  report.containersRemoved.push(name);
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  log = fs.openSync(path.join(output, 'run.log'), 'wx');
  try {
    for (const port of [15487, 16487, 5188, 3308]) await requireFreePort(port);
    report.sharedBefore = sharedInventory();
    report.sourceBefore = fingerprints();
    report.head = run('git', ['rev-parse', 'HEAD']);
    const labels = ['--label', `hrm.qa.scope=${scope}`, '--label', `hrm.qa.run=${runId}`];
    run('docker', ['run', '-d', '--rm', '--name', pg, ...labels,
      '-e', 'POSTGRES_USER=audit', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=hrm_lifecycle_test',
      '-p', '127.0.0.1:15487:5432', 'postgres:14-alpine']);
    run('docker', ['run', '-d', '--rm', '--name', redis, ...labels,
      '-p', '127.0.0.1:16487:6379', 'redis:7-alpine']);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const check = spawnSync('docker', ['exec', pg, 'pg_isready', '-U', 'audit'], { encoding: 'utf8', timeout: 5000 });
      if (check.status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
    run('docker', ['exec', redis, 'redis-cli', 'ping']);
    console.log('Owned disposable PostgreSQL/Redis ready; shared stacks unchanged.');
    run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: path.join(root, 'api') });
    vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5188', '--strictPort'], {
      cwd: path.join(root, 'web'), env: { ...env, VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:3308' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stdout.on('data', record); vite.stderr.on('data', record);
    let webReady = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (vite.exitCode !== null) throw new Error('Disposable Vite exited before readiness');
      try {
        if ((await fetch('http://127.0.0.1:5188', { signal: AbortSignal.timeout(1500) })).ok) { webReady = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!webReady) throw new Error('Disposable Vite did not become ready');
    console.log('Running preserved lifecycle/browser cases plus real Boolean-query HTTP regressions.');
    run(process.execPath, ['node_modules/jest/bin/jest.js', '--config', 'test/jest-personnel-arrival-invitations.config.json',
      '--runInBand', '--json', '--outputFile', path.join(output, 'jest.json')], { cwd: path.join(root, 'api'), timeout: 600000 });
    const result = JSON.parse(fs.readFileSync(path.join(output, 'jest.json'), 'utf8'));
    report.tests = { total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests, pending: result.numPendingTests };
    if (result.numFailedTests || result.numPendingTests) throw new Error('Integration results contain failed or skipped cases');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = redact(error.message);
    process.exitCode = 1;
  } finally {
    const resultPath = path.join(output, 'jest.json');
    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      report.tests = { total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests, pending: result.numPendingTests };
    }
    if (vite && vite.exitCode === null) {
      const exited = new Promise(resolve => vite.once('exit', resolve));
      vite.kill();
      await exited;
    }
    for (const name of [pg, redis]) {
      try { removeOwned(name); } catch (error) { report.status = 'failed'; report.cleanupError = redact(error.message); process.exitCode = 1; }
    }
    report.sourceAfter = fingerprints();
    report.sourceUnchanged = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
    if (report.sourceBefore && !report.sourceUnchanged) { report.status = 'failed'; report.error = 'Reviewed query sources changed during execution; evidence needs refresh'; process.exitCode = 1; }
    if (report.sharedBefore) {
      report.sharedAfter = sharedInventory();
      report.sharedContainersUnchanged = JSON.stringify(report.sharedBefore) === JSON.stringify(report.sharedAfter);
      if (!report.sharedContainersUnchanged) { report.status = 'failed'; report.error = 'Shared container inventory changed during execution'; process.exitCode = 1; }
    }
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'run.json'), JSON.stringify(report, null, 2));
    fs.closeSync(log);
    console.log(JSON.stringify({ status: report.status, tests: report.tests, error: report.error,
      cleanupError: report.cleanupError, containersRemoved: report.containersRemoved.length,
      sharedContainersUnchanged: report.sharedContainersUnchanged, output }, null, 2));
  }
}
main().catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
