const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load() {
  const calls = [], filename = path.resolve(__dirname, '../src/api/payroll.api.ts');
  const m = new Module(filename, module);
  m.require = id => id === './http' ? { default: { get: (...args) => { calls.push(['GET', ...args]); return Promise.resolve([]); }, post: (...args) => { calls.push(['POST', ...args]); return Promise.resolve({}); } } } : require(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return { ...m.exports, calls };
}
test('all batch writes carry expectedVersion, download uses POST blob and secret stays out of URL', async () => {
  const { payrollApi: api, calls } = load();
  await api.calculate('id/a', 4); await api.submit('id/a', 4); await api.decide('id/a', 4, 'return', 'fictional reason'); await api.withdraw('id/a', 4, 'source update'); await api.void('id/a', 4, 'unpaid', true);
  await api.settle('id/a', 4, { lineId: 'line', amount: '150.00', reference: 'fictional reference', requestId: 'same-id' });
  await api.cancelRemainder('id/a', 4, 'line', 'reference'); await api.export('id/a', 4, 'fictional-file-secret');
  assert.equal(calls.length, 8);
  for (const [method, url, body, config] of calls) { assert.equal(method, 'POST'); assert.ok(url.includes('id%2Fa')); assert.equal(body.expectedVersion, 4); assert.equal(config.skipErrorMessage, true); assert.ok(!url.includes('secret')); }
  assert.equal(calls.at(-1)[3].responseType, 'blob'); assert.equal(calls.at(-1)[2].filePassword, 'fictional-file-secret');
  assert.equal(calls[5][2].requestId, 'same-id');
});
test('normalized attendance, month mappings, signed adjustment and opening zero remain exact payloads', async () => {
  const { payrollApi: api, calls } = load();
  await api.syncAttendance('subject', '2026-11', { sourceKey: 'fictional', input: { expected: [], records: [] } });
  await api.createBatch({ subjectId: 'subject', month: '2026-11', payMonth: '2026-12', purpose: 'validation', additionalMonths: ['2026-09', '2026-10'] });
  await api.createAdjustment({ subjectId: 'subject', employeeId: 'person', month: '2026-11', itemCode: 'adjustment', amount: '-12.30', reason: 'fictional', reference: 'approved-reference' });
  await api.createOpening({ subjectId: 'subject', employeeId: 'person', month: '2026-11', itemCode: 'fixed', amount: '0', reference: 'explicit-zero' });
  assert.deepEqual(calls[0][2].input, { expected: [], records: [] }); assert.deepEqual(calls[1][2].additionalMonths, ['2026-09', '2026-10']); assert.equal(calls[2][2].amount, '-12.30'); assert.equal(calls[3][2].amount, '0');
});
test('download errors decode locally and salary UI has no client money engine or persisted secret', async () => {
  const { payrollError } = load();
  assert.equal(await payrollError({ response: { data: new Blob([JSON.stringify({ message: 'version changed' })]) } }), 'version changed');
  const dir = path.resolve(__dirname, '../src/views/compensation/payroll');
  const calendarFiles = new Set(['PayrollParameterReviewsView.vue', 'PayrollStandardsView.vue', 'PayrollWorkCalendarEditor.vue']);
  const source = fs.readdirSync(dir).map(name => {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    // Calendar unit summaries are quantities, not a browser-side wage calculation engine.
    return calendarFiles.has(name) ? text.replace(/Math\.round\(Number\(day\.units\) \* 10000\)/g, 'CALENDAR_UNIT_SUMMARY') : text;
  }).join('\n');
  assert.doesNotMatch(source, /parseFloat|toFixed\(|Math\.round|eval\(|localStorage|sessionStorage/);
  assert.throws(() => assert.doesNotMatch('Math.round(Number(wage.amount) * 10000)', /Math\.round/));
});

test('batch queries send the selected month and conflict links accept only a structured server UUID', async () => {
  const { payrollApi, payrollConflictBatchId, calls } = load();
  await payrollApi.batches('subject', '2026-11');
  assert.deepEqual(calls[0][2].params, { subjectId: 'subject', month: '2026-11' });
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(payrollConflictBatchId({ response: { status: 409, data: { data: { batchId: id } } } }), id);
  assert.equal(payrollConflictBatchId({ response: { status: 403, data: { data: { batchId: id } } } }), '');
  assert.equal(payrollConflictBatchId({ response: { status: 409, data: { data: { batchId: 'https://example.invalid' } } } }), '');
  assert.equal(payrollConflictBatchId(new Error('network')), '');
});
