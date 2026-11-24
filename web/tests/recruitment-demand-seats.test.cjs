const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/views/recruitment/demand-seat-presentation.ts');
let format;
if (fs.existsSync(filename)) {
  const loaded = new Module(filename, module);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  format = loaded.exports.describeDemandSeats;
}
test('seat presentation is available without defaulting missing facts to zero', () => assert.equal(typeof format, 'function'));
test('shows received seats, arrivals and remaining zero accurately', () => {
  assert.deepEqual(format({ acceptedCount: 1, hiredCount: 1, remainingCount: 0, overCount: 0 }),
    { accepted: '1', hired: '1', remaining: '0', over: 0 });
});
test('distinguishes unverified capacity from a missing response', () => {
  assert.deepEqual(format({ acceptedCount: 1, hiredCount: 0, remainingCount: null, overCount: null }),
    { accepted: '1', hired: '0', remaining: '待核对', over: null });
  assert.deepEqual(format(null), { accepted: '—', hired: '—', remaining: '—', over: null });
});
test('displays overage as a fact without inventing a blocking rule', () => {
  assert.deepEqual(format({ acceptedCount: 3, hiredCount: 0, remainingCount: 0, overCount: 1 }),
    { accepted: '3', hired: '0', remaining: '0', over: 1 });
});
test('does not turn malformed counters into valid zeros', () => {
  assert.deepEqual(format({ acceptedCount: -1, hiredCount: NaN, remainingCount: '0', overCount: Infinity }),
    { accepted: '—', hired: '—', remaining: '—', over: null });
});
