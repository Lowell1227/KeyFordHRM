const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const filename = path.resolve(__dirname, '../src/views/compensation/payroll/payroll-deduction-form.ts');
function load() {
  const m = new Module(filename, module);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}
function approved() {
  const settings = load().emptyDeductionSettings();
  settings.rounding = 'component_half_up';
  for (const key of ['socialInsurance', 'housingFund']) Object.assign(settings[key], {
    status: 'applicable', contributionDate: '2037-01-31', ruleVersion: 'fictional-rules', evidenceRef: 'private-personal-evidence',
    effectiveFrom: '2037-01-01', effectiveTo: null, items: [{ code: 'fictional-item', base: '5000', rate: '0.02' }],
  });
  Object.assign(settings.tax, { method: 'resident_cumulative_wage', ruleVersion: 'fictional-tax', evidenceRef: 'private-tax-evidence',
    effectiveFrom: '2037-01-01', effectiveTo: null, brackets: [{ upTo: null, rate: '0.05', quickDeduction: '0' }] });
  for (const key of Object.keys(settings.tax.current)) {
    settings.tax.current[key] = '12'; settings.tax.opening[key] = '24'; settings.ledger.priorInPayMonth[key] = '2';
  }
  Object.assign(settings.tax.opening, { income: '8000', taxPaid: '123', confirmed: true, sourceVersion: 'personal-opening', evidenceRef: 'personal-opening-evidence' });
  Object.assign(settings.ledger, { startDate: '2037-01-01', priorSocialInsurance: '40', priorHousingFund: '20' });
  return { id: 'approved', subjectId: 'subject', employeeId: 'alice', payDate: '2037-01-10', version: 3, status: 'active', settings };
}

test('common rules copy only an approved same-subject rule whitelist, never personal facts or confirmations', () => {
  const f = load(), source = approved(), before = JSON.stringify(source);
  const result = f.applyApprovedDeductionRules(f.emptyDeductionSettings(), source, 'subject');
  assert.equal(result.tax.ruleVersion, 'fictional-tax'); assert.deepEqual(result.tax.brackets, source.settings.tax.brackets);
  assert.equal(result.socialInsurance.items[0].rate, '0.02'); assert.equal(result.socialInsurance.items[0].base, '');
  assert.equal(result.socialInsurance.status, ''); assert.equal(result.socialInsurance.contributionDate, '');
  assert.equal(result.socialInsurance.evidenceRef, ''); assert.equal(result.tax.evidenceRef, '');
  assert.equal(result.tax.opening.income, ''); assert.equal(result.tax.opening.taxPaid, ''); assert.equal(result.tax.opening.confirmed, false);
  assert.ok(Object.values(result.tax.current).every(value => value === ''));
  assert.equal(result.ledger.priorSocialInsurance, ''); assert.equal(result.ledger.startDate, '');
  assert.throws(() => f.applyApprovedDeductionRules(f.emptyDeductionSettings(), source, 'other'), /主体/);
  assert.throws(() => f.applyApprovedDeductionRules(f.emptyDeductionSettings(), { ...source, status: 'pending' }, 'subject'), /已批准|已发布/);
  result.tax.brackets[0].rate = '0.99'; assert.equal(JSON.stringify(source), before);
});

test('personal copy locks identity and leaves target date and monthly facts explicit; unconfirmed carry cannot inherit opening', () => {
  const f = load(), source = approved(), before = JSON.stringify(source);
  const copy = f.copyDeductionForPayDate(source, '2037-02-10');
  assert.equal(copy.employeeId, 'alice'); assert.equal(copy.subjectId, 'subject'); assert.equal(copy.payDate, '2037-02-10');
  assert.equal(copy.settings.socialInsurance.items[0].base, '5000');
  assert.equal(copy.settings.socialInsurance.contributionDate, '');
  assert.equal(copy.settings.tax.opening.income, ''); assert.equal(copy.settings.tax.opening.confirmed, false);
  assert.ok(Object.values(copy.settings.tax.current).every(value => value === ''));
  assert.equal(copy.settings.ledger.startDate, ''); assert.equal(copy.settings.ledger.priorHousingFund, '');
  assert.equal(JSON.stringify(source), before);
});

test('same-year carry requires approved ledger evidence and must be reconfirmed; another year clears all opening facts', () => {
  const f = load(), source = approved();
  const copy = f.copyDeductionForPayDate(source, '2037-02-10', 'checked fictional ledger baseline');
  assert.equal(copy.settings.tax.opening.income, '8000'); assert.equal(copy.settings.tax.opening.taxPaid, '123');
  assert.equal(copy.settings.ledger.startDate, '2037-01-01'); assert.equal(copy.settings.tax.opening.confirmed, false);
  assert.match(copy.settings.tax.opening.evidenceRef, /checked fictional ledger baseline/);
  const nextYear = f.copyDeductionForPayDate(source, '2038-01-10', 'not a valid carry across years');
  assert.equal(nextYear.settings.tax.opening.income, ''); assert.equal(nextYear.settings.ledger.startDate, '');
  assert.equal(nextYear.settings.tax.opening.evidenceRef, ''); assert.equal(nextYear.settings.tax.opening.confirmed, false);
  const draft = f.copyDeductionForPayDate({ ...source, status: 'draft' }, '2037-02-10', 'unapproved');
  assert.equal(draft.settings.tax.opening.income, '');
  const noLedger = approved(); delete noLedger.settings.ledger;
  assert.equal(f.copyDeductionForPayDate(noLedger, '2037-02-10', 'no ledger').settings.tax.opening.income, '');
});

test('table paste matches selected employees by unique employee number and updates only recognized numeric cells atomically', () => {
  const f = load(), source = approved();
  const inputs = [f.copyDeductionForPayDate(source, '2037-02-10')];
  const people = [{ id: 'alice', employeeNo: 'F001', name: 'Fictional employee' }];
  const before = JSON.stringify(inputs);
  const result = f.pasteDeductionAmounts(inputs, people, '工号\t累计收入\t累计已扣个税\t本月专项附加扣除\nF001\t9000\t321\t0');
  assert.deepEqual(result.errors, []); assert.equal(result.drafts[0].settings.tax.opening.income, '9000');
  assert.equal(result.drafts[0].settings.tax.opening.taxPaid, '321'); assert.equal(result.drafts[0].settings.tax.current.additionalDeduction, '0');
  assert.equal(result.drafts[0].settings.tax.opening.confirmed, false); assert.equal(JSON.stringify(inputs), before);
  for (const text of ['工号\t累计收入\nF001\t1\nF001\t2', '工号\t累计收入\nUNKNOWN\t100', '工号\t已核对\nF001\ttrue', '工号\t累计收入\nF001\t-5']) {
    const rejected = f.pasteDeductionAmounts(inputs, people, text);
    assert.ok(rejected.errors.length); assert.equal(JSON.stringify(rejected.drafts), before);
  }
});

test('batch draft save reports exact successes and definite rejection, stops after unknown result, and never retries', async () => {
  const f = load(), ids = ['alice', 'bob', 'carol', 'dave'];
  const inputs = ids.map(employeeId => ({ subjectId: 'subject', employeeId, payDate: '2037-02-10', settings: approved().settings }));
  const before = JSON.stringify(inputs), calls = [], updates = [];
  const result = await f.saveDeductionDrafts(inputs, async input => {
    calls.push(input.employeeId);
    if (input.employeeId === 'bob') throw { response: { status: 400, data: { message: '请核对缴费归属日' } } };
    if (input.employeeId === 'carol') throw new Error('network lost after request');
    return { id: 'saved-alice' };
  }, rows => updates.push(rows.map(row => row.status)));
  assert.deepEqual(calls, ['alice', 'bob', 'carol']);
  assert.deepEqual(result.map(row => row.status), ['saved', 'failed', 'unknown', 'not_sent']);
  assert.equal(result[0].profileId, 'saved-alice'); assert.match(result[1].message, /缴费归属日/);
  assert.ok(updates.length >= 3); assert.equal(JSON.stringify(inputs), before);
});

test('server failures with uncertain commit are not treated as safe retry, and form errors resolve to their actual step', async () => {
  const f = load(), input = { subjectId: 'subject', employeeId: 'alice', payDate: '2037-02-10', settings: approved().settings };
  const result = await f.saveDeductionDrafts([input], async () => { throw { response: { status: 500, data: { message: 'internal' } } }; });
  assert.equal(result[0].status, 'unknown');
  const missingReceipt = await f.saveDeductionDrafts([input], async () => ({}));
  assert.equal(missingReceipt[0].status, 'unknown');
  assert.equal(f.deductionErrorStep('employeeId'), 'identity');
  assert.equal(f.deductionErrorStep('payDate'), 'identity');
  assert.equal(f.deductionErrorStep('housingFund.items.0.base'), 'contributions');
  assert.equal(f.deductionErrorStep('tax.brackets.0.rate'), 'tax');
  assert.equal(f.deductionErrorStep('ledger.startDate'), 'tax');
  assert.equal(f.deductionErrorStep('carryReference'), 'identity');
});

test('table paste keeps a deliberately empty final amount empty rather than dropping its column or filling zero', () => {
  const f = load(), source = approved(), inputs = [f.copyDeductionForPayDate(source, '2037-02-10')];
  const result = f.pasteDeductionAmounts(inputs, [{ id: 'alice', employeeNo: 'F001', name: 'Fictional' }], '工号\t累计收入\t累计已扣个税\nF001\t9000\t\n');
  assert.deepEqual(result.errors, []); assert.equal(result.drafts[0].settings.tax.opening.income, '9000');
  assert.equal(result.drafts[0].settings.tax.opening.taxPaid, '');
});
