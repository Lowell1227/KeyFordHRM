import test from 'node:test';
import assert from 'node:assert/strict';
import { collectResources, evaluateResources, RESOURCE_LIMITS, runPreflight } from './preflight.mjs';

const healthy = () => ({ hostFreeGiB: 6, dockerFreeGiB: 3, hostCpuPercent: 25 });

test('adequate resources pass only this resource gate', () => {
  assert.deepEqual(evaluateResources(healthy()), { passed: true, reasons: [] });
});

test('the documented guard limits are fixed and inclusive only for memory', () => {
  assert.deepEqual(RESOURCE_LIMITS, { hostFreeGiB: 4, dockerFreeGiB: 2, hostCpuPercent: 50 });
  assert.equal(evaluateResources({ hostFreeGiB: 4, dockerFreeGiB: 2, hostCpuPercent: 49.99 }).passed, true);
  assert.equal(evaluateResources({ ...healthy(), hostCpuPercent: 50 }).passed, false);
});

for (const [field, value, reason] of [
  ['hostFreeGiB', 3.99, 'host-memory-below-4-gib'],
  ['dockerFreeGiB', 1.99, 'docker-memory-below-2-gib'],
  ['hostCpuPercent', 85, 'host-cpu-at-or-above-50-percent'],
]) {
  test(`low headroom is rejected: ${field}`, () => {
    assert.deepEqual(evaluateResources({ ...healthy(), [field]: value }), { passed: false, reasons: [reason] });
  });
}

test('unavailable, nonfinite, negative or out-of-range readings fail closed', () => {
  for (const field of Object.keys(healthy())) {
    for (const value of [undefined, null, '6', NaN, Infinity, -1]) {
      const result = evaluateResources({ ...healthy(), [field]: value });
      assert.equal(result.passed, false, `${field}=${String(value)}`);
      assert.ok(result.reasons.includes('resource-reading-invalid'));
    }
  }
  assert.equal(evaluateResources({ ...healthy(), hostCpuPercent: 101 }).passed, false);
  assert.equal(evaluateResources(undefined).passed, false);
});

test('all exhausted resources are reported, not just the first one', () => {
  assert.deepEqual(evaluateResources({ hostFreeGiB: 1, dockerFreeGiB: 0.5, hostCpuPercent: 70 }), {
    passed: false,
    reasons: ['host-memory-below-4-gib', 'docker-memory-below-2-gib', 'host-cpu-at-or-above-50-percent'],
  });
});

test('collection only reads Windows resources and the known preview container', () => {
  const calls = [];
  const output = [JSON.stringify({ hostFreeGiB: 6, hostCpuPercent: 20 }), JSON.stringify('npipe:////./pipe/dockerDesktopLinuxEngine'), 'hrm|api', String(8 * 1024 ** 3), String(3 * 1024 ** 3)];
  const snapshot = collectResources({
    platform: 'win32', env: {},
    run: (exe, args) => { calls.push([exe, args]); return output.shift(); },
  });
  assert.deepEqual(snapshot, { hostFreeGiB: 6, hostCpuPercent: 20, dockerFreeGiB: 3 });
  assert.deepEqual(calls.map(([exe, args]) => [exe, args[0]]), [
    ['powershell.exe', '-NoProfile'], ['docker', 'context'], ['docker', '--host'], ['docker', '--host'], ['docker', '--host'],
  ]);
  assert.equal(calls[2][1][3], 'hrm-api-1');
  assert.equal(calls[4][1][3], 'hrm-api-1');
  assert.match(calls[4][1].at(-1), /MemAvailable/);
  for (const [, args] of calls.slice(2)) assert.equal(args[1], 'npipe:////./pipe/dockerDesktopLinuxEngine');
});

test('collection rejects a wrong preview identity before exec', () => {
  let calls = 0;
  assert.throws(() => collectResources({ platform: 'win32', env: {}, run: () => {
    calls += 1;
    if (calls === 1) return JSON.stringify(healthy());
    return calls === 2 ? JSON.stringify('npipe:////./pipe/docker_engine') : 'kayford-deploy|api';
  } }), /preview-container-identity-invalid/);
  assert.equal(calls, 3);
});

test('collection cannot interpret corrupt or missing Docker memory as headroom', () => {
  for (const value of ['', 'garbage', '0', '-1']) {
    const output = [JSON.stringify(healthy()), JSON.stringify('npipe:////./pipe/docker_engine'), 'hrm|api', String(8 * 1024 ** 3), value];
    assert.throws(() => collectResources({ platform: 'win32', env: {}, run: () => output.shift() }), /docker-memory-reading-invalid/);
  }
});

test('explicit production observer only reads VM memory from the pinned API when preview is paused', () => {
  const calls = [], output = [JSON.stringify(healthy()), JSON.stringify('npipe:////./pipe/docker_engine'),
    'kayford-deploy|api', String(8 * 1024 ** 3), String(5 * 1024 ** 3)];
  const value = collectResources({ platform: 'win32', env: { CAPACITY_RESOURCE_PROBE_CONTAINER: 'kayford-deploy-api-1' },
    run: (exe, args) => { calls.push(args); return output.shift(); } });
  assert.equal(value.dockerFreeGiB, 5);
  assert.equal(calls[2].includes('kayford-deploy-api-1'), true);
  assert.equal(calls[4].includes('kayford-deploy-api-1'), true);
  assert.equal(calls[4].join(' ').includes('/proc/meminfo'), true);
  assert.throws(() => collectResources({ platform: 'win32', env: { CAPACITY_RESOURCE_PROBE_CONTAINER: 'other-api' },
    run: () => assert.fail('invalid observer must not execute a command') }), /resource-container-not-allowed/);
});

test('remote and unknown Docker contexts are rejected before container reads', () => {
  for (const host of ['ssh://remote', 'tcp://127.0.0.1:2375', 'unix:///var/run/docker.sock', 'npipe:////other/pipe/docker_engine', 'garbage']) {
    let calls = 0;
    assert.throws(() => collectResources({ platform: 'win32', env: {}, run: () => {
      calls += 1;
      return calls === 1 ? JSON.stringify(healthy()) : JSON.stringify(host);
    } }), /docker-endpoint-not-local-desktop/);
    assert.equal(calls, 2);
  }
});

test('an inherited Docker host override is never silently accepted', () => {
  assert.throws(() => collectResources({
    platform: 'win32', env: { DOCKER_HOST: 'tcp://remote:2375' }, run: () => assert.fail('must not invoke a command'),
  }), /docker-host-override-not-allowed/);
});

test('single snapshot never grants a completed 60-second resource window', async () => {
  const result = await runPreflight({ once: true, collect: healthy });
  assert.equal(result.status, 'snapshot-only');
  assert.equal(result.loadStarted, false);
  assert.equal(result.snapshots.length, 1);
});

test('a depleted snapshot aborts without waiting or launching anything', async () => {
  let waited = false;
  const result = await runPreflight({ collect: () => ({ ...healthy(), hostFreeGiB: 1 }), sleep: async () => { waited = true; } });
  assert.equal(result.status, 'blocked');
  assert.equal(result.loadStarted, false);
  assert.equal(waited, false);
});

test('a resource window needs five adequate readings over 60 seconds', async () => {
  const waits = [];
  const result = await runPreflight({ collect: healthy, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(result.status, 'resource-window-passed');
  assert.equal(result.loadStarted, false);
  assert.equal(result.snapshots.length, 5);
  assert.deepEqual(waits, [15000, 15000, 15000, 15000]);
});

test('a failed later reading aborts a resource window', async () => {
  let count = 0;
  const result = await runPreflight({
    collect: () => (++count === 3 ? { ...healthy(), dockerFreeGiB: 0.5 } : healthy()),
    sleep: async () => {},
  });
  assert.equal(result.status, 'blocked');
  assert.equal(count, 3);
});

test('unsupported hosts and collection errors fail closed without raw command output', async () => {
  assert.throws(() => collectResources({ platform: 'linux', run: () => assert.fail('must not run') }), /unsupported-host/);
  const result = await runPreflight({ collect: () => { throw new Error('private-process-output'); } });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasons, ['resource-collection-failed']);
  assert.equal(JSON.stringify(result).includes('private-process-output'), false);
});
