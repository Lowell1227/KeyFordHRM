import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { docker, assertOwned, assertRunId } from './isolation.mjs';
import { collectResources } from './preflight.mjs';

const manifestPath = resolve(process.argv[2] ?? '');
const directory = resolve(process.argv[3] ?? '');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assertRunId(manifest.runId);
const api = `hrm-cap-${manifest.runId.toLowerCase()}-api`;
const proxy = `hrm-cap-${manifest.runId.toLowerCase()}-proxy`;
const own = (name) => assertOwned(JSON.parse(docker(['inspect', name]))[0], manifest.runId);
own(api); own(proxy);
const port = docker(['port', proxy, '80/tcp']).split(':').at(-1);
if (manifest.baseURL !== `http://127.0.0.1:${port}`) throw new Error('contrast-url-does-not-match-owned-proxy');
const results = [];
try {
  for (const cpu of [1, 2]) {
    const resources = collectResources();
    if (resources.hostFreeGiB < 2.25 || resources.hostCpuPercent >= 50) throw new Error('contrast-resource-headroom-insufficient');
    own(api);
    docker(['update', '--cpus', String(cpu), api]);
    const output = resolve(directory, `auth-${cpu}cpu.summary.json`);
    let code = 0;
    try {
      execFileSync(resolve('test-results/capacity-tools/k6-v2.4.0-windows-amd64/k6.exe'), [
        'run', '--quiet', '--no-usage-report', 'scripts/capacity/scenarios/performance.js',
      ], { env: { ...process.env, CAPACITY_MANIFEST: manifestPath, CAPACITY_PROFILE: 'auth-only-burst', CAPACITY_SUMMARY_PATH: output },
        windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { code = error.status ?? -1; }
    const result = JSON.parse(readFileSync(output, 'utf8'));
    delete result.setup_data;
    writeFileSync(output, JSON.stringify(result, null, 2));
    results.push({ cpu, code, login: result.metrics.loginMs, read: result.metrics.readMs, success: result.metrics.loginSuccess.count,
      semanticFailures: result.metrics.semanticFailure.count, httpErrors: result.metrics.http_req_failed.value });
    await new Promise((done) => setTimeout(done, 3000));
  }
} finally { own(api); docker(['update', '--cpus', '1', api]); }
writeFileSync(resolve(directory, 'auth-contrast.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
