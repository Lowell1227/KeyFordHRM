import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSummary } from './safe-summary.mjs';

test('summary exports only anonymous metric values, never setup sessions or unknown roots', () => {
  const output = safeSummary({ setup_data: { token: 'synthetic-private-value' }, private: 'synthetic-private-value',
    root_group: { name: '' }, metrics: { loginMs: { values: { count: 100, 'p(95)': 123 }, thresholds: { gate: { ok: true } } } } });
  assert.equal(JSON.stringify(output).includes('synthetic-private-value'), false);
  assert.equal(output.metrics.loginMs.count, 100);
  assert.deepEqual(Object.keys(output).sort(), ['metrics', 'root_group']);
});
