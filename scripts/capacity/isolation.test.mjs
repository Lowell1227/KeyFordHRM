import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBudget, assertOwned, assertRunId, BUDGET } from './isolation.mjs';

const runId = 'CAP_0123456789ab';
const snapshot = { hostFreeGiB: 3.5, dockerFreeGiB: 5, hostCpuPercent: 20 };
const owned = () => ({ Name: `/hrm-cap-${runId.toLowerCase()}-api`, Config: { Labels: { 'hrm.capacity.run': runId } }, Mounts: [], HostConfig: { PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '55555' }] } } });

test('the explicit peak budget retains two GiB for existing work', () => {
  assert.equal(BUDGET.hostReserveGiB, 2);
  const budget = assertBudget(snapshot);
  assert.equal(budget.incrementalGiB, 0.984375);
  assert.throws(() => assertBudget({ ...snapshot, hostFreeGiB: 2.98 }));
  assert.throws(() => assertBudget({ ...snapshot, dockerFreeGiB: 1.5 }));
  assert.throws(() => assertBudget({ ...snapshot, hostCpuPercent: 50 }));
  for (const value of [undefined, null, NaN, Infinity]) assert.throws(() => assertBudget({ ...snapshot, hostFreeGiB: value }));
});

test('existing projects and public ports are never owned capacity targets', () => {
  assert.doesNotThrow(() => assertOwned(owned(), runId));
  assert.throws(() => assertOwned({ ...owned(), Name: '/kayford-deploy-api-1' }, runId));
  const other = owned(); other.Config.Labels['hrm.capacity.run'] = 'CAP_aaaaaaaaaaaa';
  assert.throws(() => assertOwned(other, runId));
  const publicPort = owned(); publicPort.HostConfig.PortBindings['3000/tcp'][0].HostIp = '0.0.0.0';
  assert.throws(() => assertOwned(publicPort, runId));
  const bind = owned(); bind.Mounts = [{ Type: 'bind', Destination: '/app' }];
  assert.throws(() => assertOwned(bind, runId));
  for (const id of ['', 'main', 'CAP_../../prod', undefined]) assert.throws(() => assertRunId(id));
});
