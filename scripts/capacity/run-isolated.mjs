import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { assertBudget, assertOwned, BUDGET, docker } from './isolation.mjs';
import { collectResources } from './preflight.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runId = `CAP_${randomBytes(6).toString('hex')}`;
const prefix = `hrm-cap-${runId.toLowerCase()}`;
const output = join(root, 'test-results/capacity', runId);
const network = `${prefix}-net`;
const frontendNetwork = `${prefix}-front`;
const names = ['pg', 'redis', 'minio', 'api', 'proxy'].map((key) => `${prefix}-${key}`);
const image = 'kayford-deploy-api:ce618b29ec82010e54d0c879c2d24bae5834c5b8';
const webImage = process.env.CAPACITY_WEB_IMAGE || 'kayford-deploy-web:9fc27b2aa035f5b01394c459de42d27bf8c8a83d';
if (!/^kayford-deploy-web:[a-f0-9]{40}$/.test(webImage)) throw new Error('capacity-web-image-refused');
const manifestPath = join(output, 'fixture-manifest.local.json');
const snapshots = [];
const stages = [];
let child;
let monitor;
let stopped = false;
let monitorBusy = false;
let healthFailures = 0;
let lowMemorySince;
let highCpuSince;
let lastHealthAt = 0;
let lastHealth;
let hasNetwork = false;
let hasFrontendNetwork = false;
let activeStage = 'setup';

function save(name, data) { writeFileSync(join(output, name), JSON.stringify(data, null, 2)); }
function inspect(name) { return JSON.parse(docker(['inspect', name]))[0]; }
function owned(name) { const item = inspect(name); assertOwned(item, runId); return item; }
function abort(reason) {
  if (stopped) return;
  stopped = true;
  stages.push({ kind: 'safety-stop', reason, at: new Date().toISOString(), stage: activeStage });
  console.log(`SAFETY_STOP ${reason}`);
  child?.kill();
}
async function health() {
  const started = performance.now();
  try {
    const response = await fetch('http://127.0.0.1/api/v1/health', { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    const data = body.data ?? body;
    return { ok: response.ok && data.status === 'ok', ms: performance.now() - started };
  } catch { return { ok: false, ms: performance.now() - started }; }
}
async function sample() {
  if (monitorBusy || stopped) return;
  monitorBusy = true;
  try {
    const resources = collectResources();
    const at = Date.now();
    lowMemorySince = resources.hostFreeGiB < 2 ? (lowMemorySince ?? at) : undefined;
    highCpuSince = resources.hostCpuPercent > 85 ? (highCpuSince ?? at) : undefined;
    const healthSampled = at - lastHealthAt >= 15000;
    if (healthSampled) {
      lastHealth = await health();
      lastHealthAt = at;
      healthFailures = lastHealth.ok ? 0 : healthFailures + 1;
    }
    const production = lastHealth;
    const api = owned(names[3]);
    const readings = { at: new Date().toISOString(), stage: activeStage, ...resources, production, healthSampled, apiOom: api.State.OOMKilled };
    snapshots.push(readings);
    if (resources.hostFreeGiB < 2) abort('host-memory-below-2-gib');
    if (highCpuSince && at - highCpuSince >= 30000) abort('host-cpu-above-85-percent');
    if (healthFailures >= 2) abort('production-health-failed-twice');
    if (!api.State.Running || api.State.OOMKilled) abort('capacity-api-stopped-or-oom');
    save('resource-samples.json', snapshots);
  } catch { abort('safety-observation-failed'); }
  finally { monitorBusy = false; }
}
async function runChild(command, args, env = {}) {
  if (stopped) throw new Error('safety-stop-active');
  return new Promise((done) => {
    child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (value) => { if (stdout.length < 100000) stdout += value; });
    child.stderr.on('data', (value) => { if (stderr.length < 100000) stderr += value; });
    child.on('error', () => { child = undefined; done({ code: -1, stdout: '', stderr: 'child-launch-failed' }); });
    child.on('close', (code) => { child = undefined; done({ code, stdout, stderr }); });
  });
}
async function execute(command) {
  if (stopped) return;
  activeStage = command;
  const start = Date.now();
  console.log(`START ${command}`);
  if (command === 'browser') {
    const result = await runChild(process.execPath, ['scripts/capacity/browser-probe.cjs', '--manifest', manifestPath, '--out', join(output, 'browser')]);
    stages.push({ command, code: result.code, seconds: (Date.now() - start) / 1000 });
    console.log(`FINISH ${command} code=${result.code}`);
    if (result.stdout) console.log(result.stdout.slice(-8000));
    if (result.code) save('browser-error.local.json', { stderr: result.stderr });
  } else if (command === 'audit') {
    const count = docker(['exec', names[3], 'node', '/capacity/audit.cjs']);
    const result = JSON.parse(count);
    save('business-audit.json', result);
    console.log(JSON.stringify({ kind: 'business-audit', ...result }));
  } else {
    const summary = join(output, `${command}.summary.json`);
    const k6 = join(root, 'test-results/capacity-tools/k6-v2.4.0-windows-amd64/k6.exe');
    const result = await runChild(k6, ['run', '--quiet', '--no-usage-report', 'scripts/capacity/scenarios/performance.js'],
      { CAPACITY_MANIFEST: manifestPath, CAPACITY_PROFILE: command, CAPACITY_SUMMARY_PATH: summary, K6_WEB_DASHBOARD: 'false' });
    const data = existsSync(summary) ? JSON.parse(readFileSync(summary, 'utf8')) : null;
    if (data) { delete data.setup_data; writeFileSync(summary, JSON.stringify(data, null, 2)); }
    const metrics = data ? Object.fromEntries(Object.entries(data.metrics).filter(([key]) => /loginMs|read.*Ms|writeMs|semantic|Success|http_req_failed|http_reqs|checks|dropped/.test(key))) : {};
    stages.push({ command, code: result.code, seconds: (Date.now() - start) / 1000, metrics });
    console.log(`FINISH ${command} code=${result.code}`);
    console.log(JSON.stringify(metrics));
    if (result.code && !data) console.log(result.stderr.slice(-3000));
  }
  save('stages.json', stages);
  activeStage = 'idle';
}

try {
  if (process.argv[2] !== '--start' || process.argv.length !== 3) throw new Error('usage-run-isolated--start');
  mkdirSync(output, { recursive: true });
  const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-5-[0-9-]+/)?.[0];
  if (!sid) throw new Error('private-output-owner-unavailable');
  execFileSync('icacls', [output, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { stdio: 'ignore', windowsHide: true });
  const preflight = collectResources();
  const budget = assertBudget(preflight);
  const initialHealth = await health();
  if (!initialHealth.ok) throw new Error('production-initial-health-not-ok');
  const productionBefore = docker(['ps', '--filter', 'label=com.docker.compose.project=kayford-deploy', '--format', '{{.ID}}|{{.Image}}']);
  save('baseline.json', { runId, at: new Date().toISOString(), source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), apiImage: image, webImage,
    preflight, budget, limits: BUDGET, initialHealth, productionBefore });
  docker(['network', 'create', '--internal', '--label', `hrm.capacity.run=${runId}`, network]);
  hasNetwork = true;
  const environment = { POSTGRES_PASSWORD: randomBytes(24).toString('hex'), MINIO_ROOT_USER: `cap${randomBytes(6).toString('hex')}`,
    MINIO_ROOT_PASSWORD: randomBytes(24).toString('hex'), CAPACITY_PASSWORD: randomBytes(24).toString('hex') };
  const common = (key, memory, cpu) => ['run', '-d', '--name', `${prefix}-${key}`, '--network', network, '--network-alias', key,
    '--label', `hrm.capacity.run=${runId}`, '--memory', `${memory}m`, '--memory-swap', `${memory}m`, '--cpus', String(cpu), '--log-opt', 'max-size=5m'];
  docker([...common('pg', BUDGET.postgresMiB, 0.5), '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_DB=hrm_capacity_${runId.slice(4)}`, 'postgres:14-alpine', '-c', 'shared_buffers=16MB', '-c', 'max_connections=30'], { env: { ...process.env, ...environment } });
  docker([...common('redis', BUDGET.redisMiB, 0.1), 'redis:7-alpine', 'redis-server', '--maxmemory', '16mb', '--maxmemory-policy', 'noeviction']);
  docker([...common('minio', BUDGET.minioMiB, 0.25), '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', '-e', 'GOMEMLIMIT=96MiB', '-e', 'GOMAXPROCS=2', 'minio/minio:latest', 'server', '/data'], { env: { ...process.env, ...environment } });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker(['exec', names[0], 'pg_isready', '-U', 'postgres']); break; }
    catch { if (attempt === 59) throw new Error('capacity-pg-not-ready'); await new Promise((done) => setTimeout(done, 500)); }
  }
  const env = { ...environment, NODE_ENV: 'production', PORT: '3000', CAPACITY_RUN_ID: runId,
    DATABASE_URL: `postgresql://postgres:${environment.POSTGRES_PASSWORD}@pg:5432/hrm_capacity_${runId.slice(4)}?connection_limit=8`,
    REDIS_URL: 'redis://redis:6379/0', MINIO_ENDPOINT: 'minio', MINIO_PORT: '9000', MINIO_USE_SSL: 'false',
    MINIO_ACCESS_KEY: environment.MINIO_ROOT_USER, MINIO_SECRET_KEY: environment.MINIO_ROOT_PASSWORD, MINIO_BUCKET: `capacity-${runId.slice(4)}`,
    JWT_SECRET: randomBytes(48).toString('hex'), EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    AI_CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('hex'), ENABLE_TEST_QUICK_LOGIN: 'false',
    DINGTALK_NOTIFICATION_ENABLED: 'false', DINGTALK_INTERVIEW_CALENDAR_ENABLED: 'false', DINGTALK_BOT_STREAM_ENABLED: 'false',
    ARCHIVE_ASSISTANT_PILOT_ENABLED: 'false', AI_RESUME_PARSING_ENABLED: 'false', RECRUITMENT_MAIL_ENABLED: 'false',
    PAYROLL_ENABLED: 'false', PAYROLL_FORMAL_ENABLED: 'false', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '' };
  const scripts = resolve(root, 'scripts/capacity').replace(/\\/g, '/');
  docker([...common('api', BUDGET.apiMiB, 1), '--mount', `type=bind,source=${scripts},target=/capacity,readonly`,
    ...Object.keys(env).flatMap((key) => ['-e', key]), '--entrypoint', 'node', image, '--max-old-space-size=256', '/capacity/bootstrap.cjs'], { env: { ...process.env, ...env } });
  docker(['network', 'create', '--label', `hrm.capacity.run=${runId}`, frontendNetwork]);
  hasFrontendNetwork = true;
  docker(['create', '--name', names[4], '--network', frontendNetwork, '--label', `hrm.capacity.run=${runId}`,
    '--memory', `${BUDGET.proxyMiB}m`, '--memory-swap', `${BUDGET.proxyMiB}m`, '--cpus', '0.25', '-p', '127.0.0.1::80',
    '--mount', `type=bind,source=${scripts},target=/capacity,readonly`, '--entrypoint', 'nginx',
    webImage, '-c', '/capacity/nginx.conf', '-g', 'daemon off;']);
  docker(['network', 'connect', network, names[4]]);
  docker(['start', names[4]]);
  for (const name of names) owned(name);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker(['exec', names[0], 'pg_isready', '-U', 'postgres']); break; }
    catch { if (attempt === 59) throw new Error('capacity-pg-not-ready'); await new Promise((done) => setTimeout(done, 500)); }
  }
  const port = docker(['port', names[4], '80/tcp']).split(':').at(-1);
  const apiURL = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try { const response = await fetch(`${apiURL}/api/v1/health`, { signal: AbortSignal.timeout(2000) }); if (response.ok) break; } catch {}
    if (attempt === 89) throw new Error('capacity-api-not-ready');
    await new Promise((done) => setTimeout(done, 1000));
  }
  const fixture = JSON.parse(docker(['exec', names[3], 'node', '/capacity/fixture.cjs']));
  fixture.baseURL = apiURL;
  fixture.apiURL = apiURL;
  writeFileSync(manifestPath, JSON.stringify(fixture), { flag: 'wx', mode: 0o600 });
  console.log(`READY ${runId} ${fixture.baseURL}`);
  console.log(`PRIVATE_MANIFEST ${manifestPath}`);
  console.log(`EVIDENCE ${output}`);
  monitor = setInterval(sample, 5000);
  await sample();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of input) {
    const command = raw.trim();
    if (command === 'quit') break;
    if (['browser', 'audit', 'baseline', 'daily-10', 'daily-30', 'daily-100', 'refresh-10', 'refresh-100', 'login-burst', 'submit-burst'].includes(command)) await execute(command);
    else console.log('UNKNOWN_COMMAND');
    if (stopped) break;
    console.log('AWAIT_COMMAND');
  }
} catch (error) {
  console.error(`CAPACITY_STOP ${error.message}`);
  process.exitCode = 1;
} finally {
  clearInterval(monitor);
  child?.kill();
  process.stdin.pause();
  process.stdin.destroy();
  if (existsSync(manifestPath)) unlinkSync(manifestPath);
  for (const name of [...names].reverse()) {
    try { owned(name); docker(['rm', '-f', '-v', name]); } catch {}
  }
  if (hasNetwork) {
    try { const detail = JSON.parse(docker(['network', 'inspect', network]))[0]; if (detail.Labels?.['hrm.capacity.run'] === runId) docker(['network', 'rm', network]); } catch {}
  }
  if (hasFrontendNetwork) {
    try { const detail = JSON.parse(docker(['network', 'inspect', frontendNetwork]))[0]; if (detail.Labels?.['hrm.capacity.run'] === runId) docker(['network', 'rm', frontendNetwork]); } catch {}
  }
  let cleanup;
  try {
    const containers = docker(['ps', '-a', '--filter', `label=hrm.capacity.run=${runId}`, '--format', '{{.Names}}']);
    const networks = docker(['network', 'ls', '--filter', `label=hrm.capacity.run=${runId}`, '--format', '{{.Name}}']);
    cleanup = { verified: !containers && !networks, remainingContainers: containers.split('\n').filter(Boolean), remainingNetworks: networks.split('\n').filter(Boolean) };
  } catch { cleanup = { verified: false, reason: 'cleanup-readback-failed' }; }
  if (!cleanup.verified) process.exitCode = 1;
  if (existsSync(output)) save('completion.json', { runId, at: new Date().toISOString(), stopped, stages, observations: snapshots.length, cleanup, privateManifestRemoved: !existsSync(manifestPath) });
  console.log(cleanup.verified ? 'OWNED_CAPACITY_RESOURCES_CLEANED' : 'OWNED_CAPACITY_CLEANUP_INCOMPLETE');
}
