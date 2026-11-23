import { calculateNetWithLedger, NetLedgerFact } from './payroll-net-calculator';
import { PayrollDeductionSettings } from './payroll-deduction-settings';
import { PayrollTaxDeductions } from './payroll-deductions-calculator';

const identity = { subjectId: 'fictional-subject', employeeId: 'fictional-employee', payDate: '2035-11-10', gross: '10000' };
const zero = (): PayrollTaxDeductions => ({ exemptIncome: '0', standardDeduction: '0', specialDeduction: '0', additionalDeduction: '0', otherDeduction: '0', taxRelief: '0' });
function settings(): PayrollDeductionSettings {
  const rule = { ruleVersion: 'fictional-v1', evidenceRef: 'fictional-rule', effectiveFrom: '2035-01-01', effectiveTo: null };
  const contribution = (code: string) => ({ ...rule, status: 'applicable' as const, contributionDate: '2035-11-01', items: [{ code, base: '1000', rate: '0.1' }] });
  return {
    rounding: 'component_half_up', socialInsurance: contribution('social'), housingFund: contribution('housing'),
    tax: { ...rule, method: 'resident_cumulative_wage', brackets: [{ upTo: null, rate: '0.1', quickDeduction: '0' }],
      opening: { ...zero(), confirmed: true, sourceVersion: 'fictional-opening-v1', evidenceRef: 'fictional-opening', income: '0', taxPaid: '0' },
      current: { ...zero(), standardDeduction: '1000', specialDeduction: '200' } },
    ledger: { startDate: '2035-11-01', priorInPayMonth: zero(), priorSocialInsurance: '0', priorHousingFund: '0' },
  };
}
function fact(overrides: Partial<NetLedgerFact> = {}): NetLedgerFact {
  return { id: 'first', payDate: '2035-11-10', gross: '10000.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '880.00',
    taxDeductions: { ...zero(), standardDeduction: '1000', specialDeduction: '200' }, socialMonth: '2035-11', housingMonth: '2035-11',
    openingDate: '2035-11-01', openingHash: 'previous-approved-opening-hash', ...overrides };
}
function januarySettings(): PayrollDeductionSettings {
  const value = settings(); value.ledger!.startDate = '2036-01-01';
  value.socialInsurance.contributionDate = '2035-12-31'; value.housingFund.contributionDate = '2035-12-31';
  value.tax.effectiveFrom = '2036-01-01'; value.tax.current = { ...zero(), standardDeduction: '1000' };
  value.tax.opening.sourceVersion = 'fictional-opening-2036'; value.tax.opening.evidenceRef = 'fictional-2036-opening';
  return value;
}
const january = { ...identity, payDate: '2036-01-10' };
const decemberFact = (overrides: Partial<NetLedgerFact> = {}) => fact({ id: 'dec', payDate: '2035-12-20', socialMonth: '2035-12', housingMonth: '2035-12', openingDate: '2035-01-01', ...overrides });
function closed(result: ReturnType<typeof calculateNetWithLedger>, status: 'needs_review' | 'needs_configuration', issue: string) {
  expect(result.status).toBe(status);
  expect(result.issues.join(' ')).toContain(issue);
  for (const field of ['gross', 'socialInsurance', 'housingFund', 'incomeTax', 'net']) expect(result[field]).toBeNull();
  expect(result).not.toHaveProperty('ledger');
}

describe('ledger-aware net calculation (fictional rules only)', () => {
  it('uses monthly targets only once across two actual batches in the same pay/contribution month', () => {
    const first = calculateNetWithLedger(identity, settings(), []);
    expect(first).toMatchObject({ status: 'ready', gross: '10000.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '880.00', net: '8920.00',
      ledger: { openingDate: '2035-11-01', factIds: [], taxDeductions: { standardDeduction: '1000', specialDeduction: '200' }, socialMonth: '2035-11', housingMonth: '2035-11' } });
    const second = calculateNetWithLedger({ ...identity, payDate: '2035-11-20', gross: '2000' }, settings(), [fact()]);
    expect(second).toMatchObject({ status: 'ready', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '200.00', net: '1800.00',
      ledger: { factIds: ['first'], taxDeductions: zero() }, evidence: { tax: { cumulative: { income: '12000', taxPaid: '880', standardDeduction: '1000', specialDeduction: '200' } } } });
  });
  it('carries actual income, paid tax and deductions into next month with separate contribution months', () => {
    const value = settings(); value.socialInsurance.contributionDate = '2035-12-01'; value.housingFund.contributionDate = '2035-12-01';
    const result = calculateNetWithLedger({ ...identity, payDate: '2035-12-10' }, value, [fact()]);
    expect(result).toMatchObject({ status: 'ready', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '880.00', net: '8920.00',
      ledger: { socialMonth: '2035-12', housingMonth: '2035-12', taxDeductions: { standardDeduction: '1000', specialDeduction: '200' } },
      evidence: { tax: { cumulative: { income: '20000', taxPaid: '880', standardDeduction: '2000', specialDeduction: '400' } } } });
  });
  it('subtracts actual partial monthly deductions and contributions, not whole previous profile targets', () => {
    const result = calculateNetWithLedger({ ...identity, gross: '9000' }, settings(), [fact({ gross: '1000', incomeTax: '52', socialInsurance: '40', housingFund: '25',
      taxDeductions: { ...zero(), standardDeduction: '400', specialDeduction: '80' } })]);
    expect(result).toMatchObject({ status: 'ready', socialInsurance: '60.00', housingFund: '75.00', incomeTax: '828.00', net: '8037.00',
      ledger: { taxDeductions: { standardDeduction: '600', specialDeduction: '120' } } });
  });
  it('independently reconciles social and housing months rather than using payment month for both', () => {
    const value = settings(); value.housingFund.contributionDate = '2035-12-01';
    expect(calculateNetWithLedger({ ...identity, payDate: '2035-12-10' }, value, [fact()])).toMatchObject({ status: 'ready', socialInsurance: '0.00', housingFund: '100.00',
      ledger: { socialMonth: '2035-11', housingMonth: '2035-12' } });
  });
  it('deducts contribution corrections by contribution month even when paid in the next month', () => {
    const value = settings(); value.socialInsurance.items[0].base = '1500'; value.tax.current.specialDeduction = '250';
    const result = calculateNetWithLedger({ ...identity, payDate: '2035-12-10', gross: '2000' }, value, [fact()]);
    expect(result).toMatchObject({ status: 'ready', socialInsurance: '50.00', housingFund: '0.00', incomeTax: '75.00', net: '1875.00',
      ledger: { socialMonth: '2035-11', taxDeductions: { standardDeduction: '1000', specialDeduction: '250' } } });
  });
  it('subtracts explicit partial-cutoff-month prior totals without adding them twice to cumulative opening', () => {
    const value = settings(); value.ledger!.startDate = '2035-11-15';
    value.ledger!.priorInPayMonth = { ...zero(), standardDeduction: '400', specialDeduction: '80' };
    value.ledger!.priorSocialInsurance = '40'; value.ledger!.priorHousingFund = '40';
    value.tax.opening = { ...value.tax.opening, income: '4000', taxPaid: '352', standardDeduction: '400', specialDeduction: '80' };
    const result = calculateNetWithLedger({ ...identity, payDate: '2035-11-20', gross: '6000' }, value, []);
    expect(result).toMatchObject({ status: 'ready', socialInsurance: '60.00', housingFund: '60.00', incomeTax: '528.00', net: '5352.00',
      ledger: { openingDate: '2035-11-15', taxDeductions: { standardDeduction: '600', specialDeduction: '120' } },
      evidence: { tax: { cumulative: { income: '10000', taxPaid: '352', standardDeduction: '1000', specialDeduction: '200' } } } });
  });
  it('allows a newly approved opening correction at the same cutoff and fingerprints all opening fields', () => {
    const value = settings(); const before = calculateNetWithLedger(identity, value, [fact()]);
    value.tax.opening.income = '1000'; value.tax.opening.taxPaid = '100'; value.tax.opening.standardDeduction = '100';
    value.tax.opening.sourceVersion = 'approved-correction'; value.tax.opening.evidenceRef = 'new-evidence';
    const after = calculateNetWithLedger(identity, value, [fact()]);
    expect(after).toMatchObject({ status: 'ready', incomeTax: '990.00', net: '9010.00' });
    expect(after.ledger!.openingHash).not.toBe(before.ledger!.openingHash);
    const next = calculateNetWithLedger({ ...identity, payDate: '2035-11-20', gross: '1000' }, value, [fact(), fact({ id: 'correction', incomeTax: '990', socialInsurance: '0', housingFund: '0', taxDeductions: zero(), openingHash: after.ledger!.openingHash })]);
    expect(next).toMatchObject({ status: 'ready', incomeTax: '100.00', net: '900.00', ledger: { openingHash: after.ledger!.openingHash }, evidence: { tax: { cumulative: { income: '22000', taxPaid: '1970', standardDeduction: '1100' } } } });
    expect(next.ledger!.sourceHash).not.toBe(after.ledger!.sourceHash);
    const metadataOnly = settings(); metadataOnly.tax.opening.sourceVersion = 'different';
    expect(calculateNetWithLedger(identity, metadataOnly, []).ledger!.openingHash).not.toBe(calculateNetWithLedger(identity, settings(), []).ledger!.openingHash);
    const metadataHash = calculateNetWithLedger(identity, metadataOnly, []).ledger!.openingHash;
    metadataOnly.tax.opening.evidenceRef = 'different-evidence';
    expect(calculateNetWithLedger(identity, metadataOnly, []).ledger!.openingHash).not.toBe(metadataHash);
  });
  it('blocks cutoff changes after payments instead of relying on matching opening hashes', () => {
    const value = settings(); value.ledger!.startDate = '2035-11-02';
    closed(calculateNetWithLedger(identity, value, [fact()]), 'needs_review', 'openingDate');
  });
  it('blocks moving cutoff past an earlier actual payment with its old opening', () => {
    const value = settings(); value.ledger!.startDate = '2035-11-15';
    closed(calculateNetWithLedger({ ...identity, payDate: '2035-11-20' }, value, [fact()]), 'needs_review', 'openingDate');
  });
  it('blocks cutoff-month prior deductions inconsistent with the cumulative opening', () => {
    const value = settings(); value.ledger!.priorInPayMonth.standardDeduction = '1';
    closed(calculateNetWithLedger(identity, value, []), 'needs_configuration', 'priorInPayMonth.standardDeduction');
  });
  it('reports ledger validation in concise Chinese with a stable field identifier', () => {
    const result = calculateNetWithLedger(identity, settings(), [fact({ payDate: '2035-11-11' })]);
    expect(result.issues).toEqual([expect.stringContaining('不能倒序核算')]);
    expect(result.issues[0]).toContain('[facts[0].payDate]');
    const noContext = settings(); delete noContext.ledger;
    expect(calculateNetWithLedger(identity, noContext, []).issues[0]).toContain('请先补齐');
  });
  it.each([
    ['future date', { payDate: '2035-11-11' }, 'payDate'],
    ['before cutoff', { payDate: '2035-10-31' }, 'payDate'],
    ['unrelated older tax year', { payDate: '2034-11-10', openingDate: '2034-01-01', socialMonth: '2034-11', housingMonth: '2034-11' }, 'payDate'],
    ['invalid date', { payDate: '2035-02-31' }, 'payDate'],
    ['negative gross', { gross: '-1' }, 'gross'],
    ['missing contribution', { socialInsurance: undefined }, 'socialInsurance'],
    ['negative paid tax', { incomeTax: '-1' }, 'incomeTax'],
    ['invalid month', { socialMonth: '2035-13' }, 'socialMonth'],
    ['invalid housing month', { housingMonth: '2035-00' }, 'housingMonth'],
    ['missing opening hash', { openingHash: '' }, 'openingHash'],
  ] as Array<[string, Partial<NetLedgerFact>, string]>)('blocks an invalid actual fact: %s', (_name, change, path) => {
    closed(calculateNetWithLedger(identity, settings(), [fact(change)]), 'needs_review', path);
  });
  it('blocks duplicate fact IDs and missing/negative deduction facts', () => {
    closed(calculateNetWithLedger(identity, settings(), [fact(), fact()]), 'needs_review', 'id');
    for (const replacement of ['-1', undefined]) {
      closed(calculateNetWithLedger(identity, settings(), [fact({ taxDeductions: { ...zero(), otherDeduction: replacement } as PayrollTaxDeductions })]), 'needs_review', 'otherDeduction');
    }
  });
  it.each(['socialInsurance', 'housingFund'] as const)('does not silently floor reduced %s targets or refund actual deductions', field => {
    const value = settings(); value[field].items[0].base = '500';
    closed(calculateNetWithLedger(identity, value, [fact()]), 'needs_review', field);
  });
  it.each(Object.keys(zero()) as Array<keyof PayrollTaxDeductions>)('blocks a reduced monthly %s target', field => {
    const value = settings(); value.tax.current[field] = '10';
    closed(calculateNetWithLedger(identity, value, [fact({ taxDeductions: { ...zero(), [field]: '11' } })]), 'needs_review', field);
  });
  it('blocks negative deltas against prior cutoff-month totals rather than silently zeroing them', () => {
    const value = settings(); value.ledger!.priorInPayMonth.standardDeduction = '1001'; value.tax.opening.standardDeduction = '1001';
    closed(calculateNetWithLedger(identity, value, []), 'needs_review', 'standardDeduction');
    value.ledger!.priorInPayMonth = zero(); value.ledger!.priorSocialInsurance = '101';
    closed(calculateNetWithLedger(identity, value, []), 'needs_review', 'socialInsurance');
  });
  it('blocks negative residual net but not a residual net made positive by already paid contributions', () => {
    closed(calculateNetWithLedger({ ...identity, gross: '1' }, settings(), []), 'needs_review', 'net');
    expect(calculateNetWithLedger({ ...identity, gross: '10' }, settings(), [fact()])).toMatchObject({ status: 'ready', net: '9.00' });
  });
  it('carries a tax credit rather than refunding it as cash', () => {
    const value = settings(); value.tax.opening.taxPaid = '2000';
    expect(calculateNetWithLedger(identity, value, [])).toMatchObject({ status: 'ready', incomeTax: '0.00', net: '9800.00', evidence: { tax: { carryForwardCredit: '1120.00' } } });
  });
  it('requires a new explicit opening at the actual pay-year boundary', () => {
    closed(calculateNetWithLedger({ ...identity, payDate: '2036-01-10' }, settings(), []), 'needs_configuration', 'startDate');
    const value = settings(); value.ledger!.startDate = '2036-01-01';
    value.socialInsurance.contributionDate = '2036-01-01'; value.housingFund.contributionDate = '2036-01-01';
    expect(calculateNetWithLedger({ ...identity, payDate: '2036-01-10' }, value, [])).toMatchObject({ status: 'ready', incomeTax: '880.00' });
    closed(calculateNetWithLedger({ ...identity, payDate: '2036-01-10' }, value, [fact()]), 'needs_review', 'payDate');
  });
  it('calculates December contributions paid in January without carrying last-year income, tax or allowances', () => {
    const value = januarySettings(), prior = decemberFact();
    const result = calculateNetWithLedger(january, value, [prior]);
    expect(result).toMatchObject({ status: 'ready', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '900.00', net: '9100.00',
      ledger: { openingDate: '2036-01-01', factIds: ['dec'], socialMonth: '2035-12', housingMonth: '2035-12', taxDeductions: { ...zero(), standardDeduction: '1000' } },
      evidence: { tax: { taxYear: 2036, cumulative: { income: '10000', taxPaid: '0', standardDeduction: '1000', specialDeduction: '0' } } } });
    const noOldFact = calculateNetWithLedger(january, value, []);
    expect(noOldFact).toMatchObject({ status: 'ready', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '900.00', net: '8900.00' });
    expect(result.ledger!.openingHash).toBe(noOldFact.ledger!.openingHash);
    expect(result.ledger!.sourceHash).not.toBe(noOldFact.ledger!.sourceHash);
    const changedOldTax = calculateNetWithLedger(january, value, [decemberFact({ gross: '20000', incomeTax: '1880', taxDeductions: { ...zero(), standardDeduction: '2000', taxRelief: '50' } })]);
    expect(changedOldTax).toMatchObject({ status: 'ready', incomeTax: '900.00', net: '9100.00', ledger: { openingHash: result.ledger!.openingHash } });
    expect(changedOldTax.ledger!.sourceHash).not.toBe(result.ledger!.sourceHash);
  });
  it('uses only explicitly external December contribution totals when January has no HRM actual facts', () => {
    const value = januarySettings(); value.ledger!.priorSocialInsurance = '100'; value.ledger!.priorHousingFund = '100';
    expect(calculateNetWithLedger(january, value, [])).toMatchObject({ status: 'ready', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '900.00', net: '9100.00',
      ledger: { factIds: [] }, evidence: { tax: { cumulative: { income: '10000', taxPaid: '0', specialDeduction: '0' } } } });
  });
  it('combines matching contribution facts across pay years but only current-year tax actuals', () => {
    const result = calculateNetWithLedger(january, januarySettings(), [decemberFact({ socialInsurance: '40', housingFund: '10' }),
      fact({ id: 'jan', payDate: '2036-01-05', openingDate: '2036-01-01', gross: '1000', incomeTax: '100', taxDeductions: zero(), socialInsurance: '60', housingFund: '30', socialMonth: '2035-12', housingMonth: '2035-12' })]);
    expect(result).toMatchObject({ status: 'ready', socialInsurance: '0.00', housingFund: '60.00', incomeTax: '900.00', net: '9040.00', ledger: { factIds: ['dec', 'jan'] },
      evidence: { tax: { cumulative: { income: '11000', taxPaid: '100', standardDeduction: '1000', specialDeduction: '0' } } } });
  });
  it.each(['social', 'housing'])('accepts an older fact matching only the requested %s period', field => {
    const prior = decemberFact(field === 'social' ? { housingMonth: '2035-11' } : { socialMonth: '2035-11' });
    expect(calculateNetWithLedger(january, januarySettings(), [prior])).toMatchObject({ status: 'ready', incomeTax: '900.00', net: '9000.00',
      socialInsurance: field === 'social' ? '0.00' : '100.00', housingFund: field === 'housing' ? '0.00' : '100.00' });
  });
  it('rejects unrelated older facts and invalid own opening dates instead of silently filtering them out', () => {
    for (const [prior, issue] of [
      [decemberFact({ socialMonth: '2035-11', housingMonth: '2035-11' }), 'payDate'],
      [decemberFact({ openingDate: '2035-02-31' }), 'openingDate'],
      [decemberFact({ openingDate: '2035-12-21' }), 'openingDate'],
    ] as Array<[NetLedgerFact, string]>) closed(calculateNetWithLedger(january, januarySettings(), [prior]), 'needs_review', issue);
  });
  it('still rejects future actual dates and current-year cutoff changes with prior-year contribution periods', () => {
    closed(calculateNetWithLedger(january, januarySettings(), [decemberFact({ payDate: '2036-01-11', openingDate: '2036-01-01' })]), 'needs_review', 'payDate');
    closed(calculateNetWithLedger(january, januarySettings(), [decemberFact({ payDate: '2037-01-01' })]), 'needs_review', 'payDate');
    closed(calculateNetWithLedger(january, januarySettings(), [decemberFact({ payDate: '2036-01-05' })]), 'needs_review', 'openingDate');
  });
  it('still blocks reduced contribution targets against older-year actual deductions', () => {
    const value = januarySettings(); value.socialInsurance.items[0].base = '500';
    closed(calculateNetWithLedger(january, value, [decemberFact()]), 'needs_review', 'socialInsurance');
  });
  it('hashes sorted actual facts, rules, opening and results and keeps original reviewed settings immutable', () => {
    const value = settings(); const facts = [fact({ id: 'z', gross: '1000', incomeTax: '100', taxDeductions: zero(), socialInsurance: '0', housingFund: '0' }), fact({ id: 'a' })];
    const original = JSON.stringify({ value, facts });
    const result = calculateNetWithLedger(identity, value, facts);
    expect(result.status).toBe('ready');
    expect(result.ledger!.factIds).toEqual(['a', 'z']);
    expect(result.ledger!.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.ledger!.sourceHash).toBe(result.evidence.sourceHash);
    expect(calculateNetWithLedger(identity, value, [...facts].reverse())).toEqual(result);
    expect(result.evidence.input).toMatchObject({ settings: value });
    expect(JSON.stringify({ value, facts })).toBe(original);
    value.tax.ruleVersion = 'fictional-v2';
    expect(calculateNetWithLedger(identity, value, facts).ledger!.sourceHash).not.toBe(result.ledger!.sourceHash);
    value.tax.ruleVersion = 'fictional-v1'; facts[0].openingHash = 'another-approved-opening';
    expect(calculateNetWithLedger(identity, value, facts).ledger!.sourceHash).not.toBe(result.ledger!.sourceHash);
    expect(calculateNetWithLedger({ ...identity, gross: '10001' }, settings(), [fact({ id: 'a' }), fact({ ...facts[0], openingHash: 'previous-approved-opening-hash' })]).ledger!.sourceHash).not.toBe(result.ledger!.sourceHash);
    expect(result.evidence.input).toMatchObject({ settings: { tax: { ruleVersion: 'fictional-v1' } }, facts: [{ id: 'a' }, { id: 'z', openingHash: 'previous-approved-opening-hash' }] });
  });
  it('canonicalizes object keys as well as actual fact order', () => {
    const reverse = (value: any): any => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ?
      Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value;
    expect(calculateNetWithLedger(reverse(identity), reverse(settings()), reverse([fact()]))).toEqual(calculateNetWithLedger(identity, settings(), [fact()]));
  });
  it('uses per-component half-up targets before reconciling already deducted contributions', () => {
    const value = settings(); value.socialInsurance.items = [{ code: 'a', base: '0.015', rate: '1' }, { code: 'b', base: '0.015', rate: '1' }];
    expect(calculateNetWithLedger(identity, value, [fact({ socialInsurance: '0.01' })])).toMatchObject({ status: 'ready', socialInsurance: '0.03' });
  });
  it('requires integrated ledger context, facts, dates and rates without assigning defaults', () => {
    const value = settings(); delete value.ledger;
    closed(calculateNetWithLedger(identity, value, []), 'needs_configuration', 'ledger');
    closed(calculateNetWithLedger(undefined as any, undefined as any, undefined as any), 'needs_configuration', '');
    closed(calculateNetWithLedger(identity, settings(), undefined as any), 'needs_review', 'facts');
    for (const change of [
      (s: any) => { delete s.socialInsurance.items[0].rate; },
      (s: any) => { delete s.tax.current.standardDeduction; },
      (s: any) => { delete s.ledger.priorHousingFund; },
    ]) { const changed = settings(); change(changed); closed(calculateNetWithLedger(identity, changed, []), 'needs_configuration', ''); }
    closed(calculateNetWithLedger({ ...identity, payDate: '2035-10-31' }, settings(), []), 'needs_configuration', 'startDate');
    closed(calculateNetWithLedger({ ...identity, gross: undefined } as any, settings(), []), 'needs_configuration', 'gross');
  });
  it('fails closed for sparse/non-JSON facts rather than losing actual ledger evidence', () => {
    closed(calculateNetWithLedger(identity, settings(), new Array(1)), 'needs_review', 'facts');
    const cyclic: any = fact(); cyclic.extra = cyclic;
    closed(calculateNetWithLedger(identity, settings(), [cyclic]), 'needs_review', 'JSON');
  });
});
