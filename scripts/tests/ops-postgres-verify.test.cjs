const test = require('node:test');
const assert = require('node:assert/strict');
const { assertContainer, assertOwnedTarget, assertExistingUnchanged } = require('./ops-postgres-verify.cjs');

const container = { id: 'a'.repeat(64), name: '/hrm-postgres-1', project: 'hrm', service: 'postgres', running: true, startedAt: 'fixture-start' };
const database = 'audit_ops_20261116120000_123456abcdef';
const before = [{ name: 'hrm_preview', oid: '100' }, { name: 'kayford_perf', oid: '101' }];

test('integration guard rejects wrong project/name/service, stopped or replaced containers', () => {
  assert.doesNotThrow(() => assertContainer(container));
  for (const change of [
    { project: 'kayford-deploy' }, { name: '/kayford-deploy-postgres-1' }, { service: 'api' },
    { running: false }, { id: 'b'.repeat(64) }, { startedAt: 'restarted' },
  ]) assert.throws(() => assertContainer({ ...container, ...change }, container));
});

test('integration guard refuses all existing or unowned database targets', () => {
  assert.doesNotThrow(() => assertOwnedTarget(database, before, true));
  for (const target of ['hrm_preview', 'kayford_perf', 'postgres', 'template0', 'audit_ops_existing']) {
    assert.throws(() => assertOwnedTarget(target, before, true));
  }
  assert.throws(() => assertOwnedTarget(database, before, false));
  assert.throws(() => assertOwnedTarget(database, [...before, { name: database, oid: '102' }], true));
});

test('integration guard detects existing database deletion, replacement and unexpected additions', () => {
  assert.doesNotThrow(() => assertExistingUnchanged(before, [...before, { name: database, oid: '103' }], database));
  assert.throws(() => assertExistingUnchanged(before, before.slice(1), database));
  assert.throws(() => assertExistingUnchanged(before, [{ ...before[0], oid: '999' }, before[1]], database));
  assert.throws(() => assertExistingUnchanged(before, [...before, { name: 'unexpected', oid: '104' }], database));
});
