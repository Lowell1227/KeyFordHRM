import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { parseEnv, validatePreviewConfig, assertDevContainer } from './preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function docker(args) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error(`Isolated verification ${args[0]} failed; no command/environment output was copied`);
  return result.stdout.trim();
}
const inspect = name => JSON.parse(docker(['inspect', name]))[0];
const compose = ['compose', '--env-file', '.env.preview.local', '-f', 'docker-compose.payroll-verification.yml', '-p', 'hrm-payroll-verify'];
const identity = () => ['hrm-api-1', 'hrm-web-1', 'kayford-deploy-api-1', 'kayford-deploy-web-1'].map(name => inspect(name).Id).join(',');

async function run() {
  const action = process.argv[2] ?? 'start';
  if (!['start', 'stop'].includes(action)) throw new Error('Use start or stop');
  const before = identity(), env = parseEnv(readFileSync(resolve(root, '.env.preview.local'), 'utf8'));
  validatePreviewConfig(env);
  if (!JSON.parse(docker(['network', 'inspect', 'hrm_internal']))[0].Internal) throw new Error('Verification requires the existing internal-only network');
  if (action === 'stop') {
    docker([...compose, 'down']);
    if (before !== identity()) throw new Error('Shared preview or production changed independently; investigate');
    console.log('Only the task-owned temporary API/Web were stopped; fictional audit records and dependency copies retained.');
    return;
  }
  const existing = docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=hrm-payroll-verify']);
  if (existing) throw new Error('Task verification already exists; inspect it before restarting');
  await new Promise((done, reject) => {
    const server = createServer(); server.once('error', () => reject(new Error('Loopback port 5174 is occupied')));
    server.listen(5174, '127.0.0.1', () => server.close(error => error ? reject(error) : done()));
  });
  for (const service of ['api', 'web']) {
    const source = inspect(`hrm-${service}-1`); assertDevContainer(source, service);
    const dependencies = source.Mounts.find(mount => mount.Type === 'volume' && mount.Destination === '/app/node_modules');
    if (!dependencies) throw new Error('Existing dependencies are unavailable');
    const volume = `hrm_payroll_verify_${service}_modules`;
    const matches = docker(['volume', 'ls', '-q', '--filter', `name=^${volume}$`]);
    if (matches && JSON.parse(docker(['volume', 'inspect', volume]))[0].Labels?.['hrm.owner'] !== 'payroll-verification') throw new Error('Refusing an unowned dependency volume');
    if (!matches) {
      docker(['volume', 'create', '--label', 'hrm.owner=payroll-verification', volume]);
    }
    docker(['run', '--rm', '--user', '0', '--network', 'none', '--entrypoint', 'sh', '-v', `${dependencies.Name}:/from:ro`, '-v', `${volume}:/to`, source.Image, '-c', 'if [ ! -f /to/.hrm-payroll-dependencies-ready ]; then cp -a /from/. /to/ && touch /to/.hrm-payroll-dependencies-ready; fi']);
  }
  docker([...compose, 'up', '-d', '--no-build', '--no-deps', 'payrollverifyapi', 'payrollverifyweb']);
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    let healthy = false;
    try {
      const response = await fetch('http://127.0.0.1:5174/api/v1/health', { signal: AbortSignal.timeout(4000) });
      const body = await response.json();
      healthy = response.ok && (body.status === 'ok' || body.data?.status === 'ok');
    } catch { /* Compilation and additive isolated migrations may still be running. */ }
    if (healthy) {
      if (identity() !== before) throw new Error('Shared preview or production changed independently; investigate');
      console.log('Temporary verification ready at http://localhost:5174; fixed preview and production container IDs unchanged.');
      return;
    }
    await new Promise(done => setTimeout(done, 2000));
  }
  throw new Error('Temporary verification is not healthy; inspect only task-owned service logs');
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
