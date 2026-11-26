import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RESOURCE_LIMITS = Object.freeze({
  hostFreeGiB: 4,
  dockerFreeGiB: 2,
  hostCpuPercent: 50,
});

export function evaluateResources(snapshot) {
  if (!snapshot || Object.keys(RESOURCE_LIMITS).some((key) =>
    typeof snapshot[key] !== 'number' || !Number.isFinite(snapshot[key]) || snapshot[key] < 0)
    || snapshot.hostCpuPercent > 100) {
    return { passed: false, reasons: ['resource-reading-invalid'] };
  }
  const reasons = [];
  if (snapshot.hostFreeGiB < RESOURCE_LIMITS.hostFreeGiB) reasons.push('host-memory-below-4-gib');
  if (snapshot.dockerFreeGiB < RESOURCE_LIMITS.dockerFreeGiB) reasons.push('docker-memory-below-2-gib');
  if (snapshot.hostCpuPercent >= RESOURCE_LIMITS.hostCpuPercent) reasons.push('host-cpu-at-or-above-50-percent');
  return { passed: reasons.length === 0, reasons };
}
function readCommand(exe, args) {
  // Do not inherit PowerShell 7 module paths into the Windows PowerShell child.
  const env = { ...process.env };
  if (exe === 'powershell.exe') delete env.PSModulePath;
  if (exe === 'docker' && args[0] === '--host') {
    delete env.DOCKER_HOST;
    delete env.DOCKER_CONTEXT;
  }
  return execFileSync(exe, args, { encoding: 'utf8', timeout: 15000, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function collectResources({ run = readCommand, platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') throw new Error('unsupported-host');
  if (env.DOCKER_HOST) throw new Error('docker-host-override-not-allowed');
  const observer = env.CAPACITY_RESOURCE_PROBE_CONTAINER || 'hrm-api-1';
  if (!['hrm-api-1', 'kayford-deploy-api-1'].includes(observer)) throw new Error('resource-container-not-allowed');
  const hostScript = [
    '$ErrorActionPreference = "Stop"',
    '$os = Get-CimInstance Win32_OperatingSystem',
    '$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name=\'_Total\'"',
    'if ($null -eq $cpu.PercentProcessorTime) { throw "missing-cpu-reading" }',
    '@{hostFreeGiB=[double]$os.FreePhysicalMemory/1MB;hostCpuPercent=[double]$cpu.PercentProcessorTime} | ConvertTo-Json -Compress',
  ].join('\n');
  const host = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', hostScript]));
  const endpoint = JSON.parse(run('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
  if (!['npipe:////./pipe/dockerDesktopLinuxEngine', 'npipe:////./pipe/docker_engine'].includes(endpoint)) {
    throw new Error('docker-endpoint-not-local-desktop');
  }
  const docker = (args) => run('docker', ['--host', endpoint, ...args]);
  const identity = docker(['inspect', observer, '--format', '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}']);
  if (identity.trim() !== (observer === 'hrm-api-1' ? 'hrm|api' : 'kayford-deploy|api')) {
    throw new Error(observer === 'hrm-api-1' ? 'preview-container-identity-invalid' : 'resource-container-identity-invalid');
  }
  const dockerTotal = Number(docker(['info', '--format', '{{.MemTotal}}']));
  // /proc reports the shared Docker VM, not summed container working sets.
  const memoryScript = 'const s=require("node:fs").readFileSync("/proc/meminfo","utf8");const m=s.match(/^MemAvailable:\\s+(\\d+)\\s+kB$/m);if(!m)process.exit(1);process.stdout.write(String(Number(m[1])*1024));';
  const dockerAvailable = Number(docker(['exec', observer, 'node', '-e', memoryScript]));
  if (![dockerTotal, dockerAvailable].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('docker-memory-reading-invalid');
  }
  return { hostFreeGiB: host.hostFreeGiB, hostCpuPercent: host.hostCpuPercent, dockerFreeGiB: Math.min(dockerTotal, dockerAvailable) / 1024 ** 3 };
}

export async function runPreflight({ once = false, collect = collectResources, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  const snapshots = [];
  for (let index = 0; index < (once ? 1 : 5); index += 1) {
    if (index) await sleep(15000);
    let resources;
    try { resources = collect(); }
    catch { return { status: 'blocked', loadStarted: false, reasons: ['resource-collection-failed'], snapshots }; }
    const decision = evaluateResources(resources);
    snapshots.push({ at: new Date().toISOString(), ...resources, ...decision });
    if (!decision.passed) return { status: 'blocked', loadStarted: false, reasons: decision.reasons, snapshots };
  }
  return { status: once ? 'snapshot-only' : 'resource-window-passed', loadStarted: false, reasons: [], snapshots };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--once')) {
    process.stderr.write('Usage: node scripts/capacity/preflight.mjs [--once]\n');
    process.exitCode = 1;
  } else {
    const result = await runPreflight({ once: args[0] === '--once' });
    process.stdout.write(`${JSON.stringify({ scope: 'resource-preflight-only', ...result }, null, 2)}\n`);
    process.exitCode = result.status === 'resource-window-passed' ? 0 : 2;
  }
}
