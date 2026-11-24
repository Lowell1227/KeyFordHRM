import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertDevContainer, validatePreviewConfig } from './preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bootstrap = 'test/talent-core/recruitment-demand-preview.cjs';
const fixtureCommand = ['node', bootstrap];

export function assertRecruitmentPreviewTarget(row, workspace) {
  assertDevContainer(row, 'api');
  const environment = Object.fromEntries(row.Config.Env.map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  validatePreviewConfig(environment);
  const source = row.Mounts.find(mount => mount.Destination === '/app')?.Source;
  assert.equal(source && resolve(source).toLowerCase(), resolve(workspace, 'api').toLowerCase(), 'Preview belongs to a different worktree');
}

function docker(args) {
  return execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 180000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const inspect = name => JSON.parse(docker(['inspect', name]))[0];
const production = () => docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=kayford-deploy']).split(/\r?\n/).sort();

async function start() {
  assert.ok(existsSync(resolve(root, 'api', bootstrap)), 'Recruitment preview bootstrap is not ready');
  assertRecruitmentPreviewTarget(inspect('hrm-api-1'), root);
  const before = production();
  execFileSync(process.execPath, ['scripts/preview.mjs'], { cwd: root, stdio: 'inherit', timeout: 360000 });
  assertRecruitmentPreviewTarget(inspect('hrm-api-1'), root);
  const webId = inspect('hrm-web-1').Id;
  const override = resolve(root, '.recruitment-demand-preview.local');
  writeFileSync(override, JSON.stringify({ services: { api: { command: fixtureCommand } } }), { mode: 0o600 });
  docker(['compose', '--env-file', '.env.preview.local', '-f', 'docker-compose.preview.yml', '-f', override,
    '-p', 'hrm', 'up', '-d', '--no-build', '--no-deps', 'api']);
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch('http://localhost:5173/api/v1/health', { signal: AbortSignal.timeout(4000) });
      const body = await response.json();
      if (response.ok && body.data?.status === 'ok' && body.data?.db === 'ok') { healthy = true; break; }
    } catch { /* Only the local test bootstrap is restarting. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 2000));
  }
  assert.ok(healthy, 'Fictional recruitment preview is not healthy');
  const after = inspect('hrm-api-1');
  assertRecruitmentPreviewTarget(after, root);
  assert.deepEqual(after.Config.Cmd, fixtureCommand);
  assert.equal(inspect('hrm-web-1').Id, webId);
  assert.deepEqual(production(), before);
  console.log('Recruitment preview ready: http://localhost:5173/recruitment/demands (real HRM backend; fictional DingTalk source only).');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  start().catch(() => {
    console.error('Recruitment preview failed. Inspect the guarded local bootstrap; no production deployment was requested.');
    process.exitCode = 1;
  });
}
