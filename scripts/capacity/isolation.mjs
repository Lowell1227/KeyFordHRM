import { execFileSync } from 'node:child_process';
let localEndpoint;

export const BUDGET = Object.freeze({ apiMiB: 384, postgresMiB: 96, redisMiB: 24, minioMiB: 160, proxyMiB: 24, runnerAndBrowserMiB: 320, hostReserveGiB: 2 });

export function assertBudget(snapshot) {
  const incrementalGiB = (BUDGET.apiMiB + BUDGET.postgresMiB + BUDGET.redisMiB + BUDGET.minioMiB + BUDGET.proxyMiB + BUDGET.runnerAndBrowserMiB) / 1024;
  if (!Number.isFinite(snapshot?.hostFreeGiB) || !Number.isFinite(snapshot?.dockerFreeGiB)
    || !Number.isFinite(snapshot?.hostCpuPercent) || snapshot.hostCpuPercent < 0 || snapshot.hostCpuPercent >= 50
    || snapshot.hostFreeGiB < incrementalGiB + BUDGET.hostReserveGiB
    || snapshot.dockerFreeGiB < (BUDGET.apiMiB + BUDGET.postgresMiB + BUDGET.redisMiB + BUDGET.minioMiB + BUDGET.proxyMiB) / 1024 + 1) {
    throw new Error('insufficient-budgeted-headroom');
  }
  return { incrementalGiB, reservedGiB: BUDGET.hostReserveGiB };
}

export function assertRunId(runId) {
  if (!/^CAP_[a-f0-9]{12}$/.test(runId ?? '')) throw new Error('invalid-capacity-run-id');
}

export function assertOwned(container, runId) {
  assertRunId(runId);
  if (container?.Config?.Labels?.['hrm.capacity.run'] !== runId
    || !container.Name?.startsWith(`/hrm-cap-${runId.toLowerCase()}-`)
    || container.Mounts?.some((mount) => mount.Type === 'bind' && mount.Destination !== '/capacity')
    || Object.values(container.HostConfig?.PortBindings ?? {}).flat().some((port) => port.HostIp !== '127.0.0.1')) {
    throw new Error('unowned-or-public-capacity-container');
  }
}

export function docker(args, options = {}) {
  const env = { ...process.env, ...options.env };
  if (env.DOCKER_HOST) throw new Error('docker-host-override-not-allowed');
  const endpoint = localEndpoint ?? JSON.parse(execFileSync('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], { env, encoding: 'utf8', windowsHide: true }));
  if (!['npipe:////./pipe/dockerDesktopLinuxEngine', 'npipe:////./pipe/docker_engine'].includes(endpoint)) throw new Error('not-local-docker-desktop');
  localEndpoint = endpoint;
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  try {
    return execFileSync('docker', ['--host', endpoint, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...options, env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(`capacity-docker-${args[0]}-failed`);
  }
}
