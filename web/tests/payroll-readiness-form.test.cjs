const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load(file) {
  const m = new Module(file, module); m.paths = module.paths;
  m.require = name => name.startsWith('./') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file);
  return m.exports;
}
const { readinessBatchEligible, readinessDraftErrors } = load(path.resolve(__dirname, '../src/views/compensation/payroll/payroll-readiness-form.ts'));
const batch = { id: 'batch', month: '2035-10', payMonth: '2035-11', purpose: 'reconciliation', status: 'calculated', versions: [{ id: 'v', version: 1, issues: [], payDate: '2035-11-10', netSnapshot: { schema: 1, payDate: '2035-11-10', totals: { net: '1.00' }, rows: [{ result: { status: 'ready', issues: [], gross: '1.00', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '0.00', net: '1.00' } }] } }] };
test('readiness uses only a complete real-data reconciliation, not an unapproved formal wage', () => {
  assert.equal(readinessBatchEligible(batch), true);
  for (const changes of [{ purpose: 'formal' }, { status: 'draft' }, { needsUpdate: true }, { versions: [] }, { versions: [{ ...batch.versions[0], issues: ['pending'] }] }, { versions: [{ ...batch.versions[0], netSnapshot: null }] }, { versions: [{ ...batch.versions[0], payDate: '2035-11-12' }] }]) assert.equal(readinessBatchEligible({ ...batch, ...changes }), false);
});
test('readiness dates and signed evidence remain explicit and field errors stay local', () => {
  assert.deepEqual(Object.keys(readinessDraftErrors({ batchId: '', firstMonth: '', reference: '' }, [batch])).sort(), ['batchId', 'firstMonth', 'reference']);
  assert.ok(readinessDraftErrors({ batchId: 'batch', firstMonth: '2035-09', reference: '核对依据' }, [batch]).firstMonth);
  assert.ok(readinessDraftErrors({ batchId: 'batch', firstMonth: '2035-13', reference: '核对依据' }, [batch]).firstMonth);
  assert.deepEqual(readinessDraftErrors({ batchId: 'batch', firstMonth: '2035-11', reference: '核对依据' }, [batch]), {});
  assert.ok(readinessDraftErrors({ batchId: 'other', firstMonth: '2035-11', reference: '核对依据' }, [batch]).batchId);
});
