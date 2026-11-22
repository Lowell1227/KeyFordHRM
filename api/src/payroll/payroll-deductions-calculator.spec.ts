import { Prisma } from '@prisma/client';
import {
  calculatePayrollDeductions,
  PayrollDeductionsInput,
} from './payroll-deductions-calculator';

function input(): PayrollDeductionsInput {
  const rule = {
    ruleVersion: 'fictional-v1',
    evidenceRef: 'fictional-rule',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
  };
  const deductions = {
    exemptIncome: '0',
    standardDeduction: '0',
    specialDeduction: '0',
    additionalDeduction: '0',
    otherDeduction: '0',
    taxRelief: '0',
  };
  return {
    subjectId: 'fictional-subject',
    employeeId: 'fictional-employee',
    payDate: '2026-11-30',
    gross: '10000',
    rounding: 'component_half_up' as const,
    socialInsurance: {
      ...rule,
      status: 'applicable' as const,
      contributionDate: '2026-11-01',
      items: [{ code: 'fictional-social', base: '1000', rate: '0.1' }],
    },
    housingFund: {
      ...rule,
      status: 'applicable' as const,
      contributionDate: '2026-11-01',
      items: [{ code: 'fictional-housing', base: '1000', rate: '0.1' }],
    },
    tax: {
      ...rule,
      method: 'resident_cumulative_wage',
      brackets: [
        { upTo: null as string | null, rate: '0.1', quickDeduction: '0' },
      ],
      opening: {
        ...deductions,
        subjectId: 'fictional-subject',
        employeeId: 'fictional-employee',
        year: 2026,
        sourceVersion: 'fictional-opening-v1',
        evidenceRef: 'fictional-confirmed-opening',
        confirmed: true,
        income: '0',
        taxPaid: '0',
      },
      current: { ...deductions, specialDeduction: '200' },
    },
  };
}

const moneyFields = [
  'gross',
  'socialInsurance',
  'housingFund',
  'incomeTax',
  'net',
] as const;
const deductionFields = [
  'exemptIncome',
  'standardDeduction',
  'specialDeduction',
  'additionalDeduction',
  'otherDeduction',
  'taxRelief',
] as const;
const contributionFields = ['socialInsurance', 'housingFund'] as const;
const ruleFields = [...contributionFields, 'tax'] as const;

function change(
  value: PayrollDeductionsInput,
  path: string,
  replacement: unknown,
) {
  const parts = path.split('.');
  let target: any = value;
  for (const part of parts.slice(0, -1)) target = target[part];
  target[parts[parts.length - 1]] = replacement;
}

function expectClosed(value: unknown, path: string) {
  const result = calculatePayrollDeductions(value as PayrollDeductionsInput);
  expect(result.status).toBe('needs_configuration');
  expect(result.issues.some((issue) => issue.includes(path))).toBe(true);
  for (const field of moneyFields) expect(result[field]).toBeNull();
}

function noContributions(value = input()): PayrollDeductionsInput {
  for (const field of contributionFields) {
    value[field].status = 'not_applicable';
    value[field].items = [];
  }
  value.tax.current.specialDeduction = '0';
  return value;
}

describe('calculatePayrollDeductions (fictional rules only)', () => {
  it('calculates employee contributions, tax and net in yuan, not integer cents', () => {
    expect(calculatePayrollDeductions(input())).toMatchObject({
      status: 'ready',
      issues: [],
      gross: '10000.00',
      socialInsurance: '100.00',
      housingFund: '100.00',
      incomeTax: '980.00',
      net: '8820.00',
    });
  });

  it.each([null, undefined, [], 'invalid', 1])(
    'closes malformed root %j',
    (value) => {
      expectClosed(value, 'input');
    },
  );

  it.each([
    'subjectId',
    'employeeId',
    'payDate',
    'gross',
    'rounding',
    'socialInsurance',
    'housingFund',
    'tax',
    'tax.method',
    'tax.brackets',
    'tax.opening',
    'tax.current',
    'tax.opening.subjectId',
    'tax.opening.employeeId',
    'tax.opening.year',
    'tax.opening.sourceVersion',
    'tax.opening.evidenceRef',
    'tax.opening.confirmed',
  ])('does not default absent or null %s', (path) => {
    for (const missing of [undefined, null, '']) {
      const value = input();
      change(value, path, missing);
      expectClosed(value, path);
    }
  });

  it('accepts explicit zero facts, not missing values', () => {
    const value = noContributions();
    value.gross = '0';
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      gross: '0.00',
      socialInsurance: '0.00',
      housingFund: '0.00',
      incomeTax: '0.00',
      net: '0.00',
    });
  });

  it.each(contributionFields)(
    'requires explicit nonapplicability and evidence for %s',
    (field) => {
      const value = input();
      value[field].status = 'not_applicable';
      expectClosed(value, `${field}.items`);
      value[field].items = [];
      value[field].evidenceRef = ' ';
      expectClosed(value, `${field}.evidenceRef`);
    },
  );

  it.each(contributionFields)(
    'rejects empty applicable, unknown status and repeated codes in %s',
    (field) => {
      const empty = input();
      empty[field].items = [];
      expectClosed(empty, `${field}.items`);
      const unknown = input();
      change(unknown, `${field}.status`, 'assumed');
      expectClosed(unknown, `${field}.status`);
      const duplicate = input();
      duplicate[field].items.push({ ...duplicate[field].items[0] });
      expectClosed(duplicate, `${field}.items[1].code`);
    },
  );

  it.each(contributionFields)(
    'rejects malformed entries and absent dates in %s',
    (field) => {
      for (const entry of [null, [], 'entry', {}]) {
        const value = input();
        change(value, `${field}.items`, [entry]);
        expectClosed(value, `${field}.items[0]`);
      }
      const value = input();
      change(value, `${field}.contributionDate`, undefined);
      expectClosed(value, `${field}.contributionDate`);
    },
  );

  it.each([
    '',
    ' ',
    '-1',
    '+1',
    '.1',
    '1.',
    'NaN',
    'Infinity',
    '1e3',
    '0x10',
    '1,000',
    '1_000',
    '1.00001',
    '1000000000000',
    '1\n',
    ' 1',
    1,
    null,
  ])('rejects malformed or out-of-scale money %j', (amount) => {
    for (const path of [
      'gross',
      'socialInsurance.items.0.base',
      'tax.current.otherDeduction',
      'tax.opening.taxPaid',
      'tax.brackets.0.quickDeduction',
    ]) {
      const value = input();
      change(value, path, amount);
      expectClosed(value, path.replace('.0', '[0]'));
    }
  });

  it.each(['', '-0.1', '1.0001', 'NaN', '1e-1', '0.1\n', '.1', 0.1, null])(
    'rejects invalid rate %j in contributions and tax',
    (rate) => {
      for (const path of [
        'socialInsurance.items.0.rate',
        'housingFund.items.0.rate',
        'tax.brackets.0.rate',
      ]) {
        const value = input();
        change(value, path, rate);
        expectClosed(value, path.replace('.0', '[0]'));
      }
    },
  );

  it.each(['0', '1'])('accepts explicit boundary rate %s', (rate) => {
    const value = input();
    value.socialInsurance.items[0].rate = rate;
    value.tax.brackets[0].rate = rate;
    value.tax.current.standardDeduction = '2000';
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      incomeTax: rate === '1' ? '7800.00' : '0.00',
      net: rate === '1' ? '1100.00' : '9900.00',
    });
  });

  it.each(ruleFields)(
    'requires all provenance and valid inclusive dates on %s',
    (field) => {
      for (const name of [
        'ruleVersion',
        'evidenceRef',
        'effectiveFrom',
        'effectiveTo',
      ]) {
        const value = input();
        change(
          value,
          `${field}.${name}`,
          name === 'effectiveTo' ? undefined : null,
        );
        expectClosed(value, `${field}.${name}`);
      }
      const value = input();
      value[field].effectiveFrom = '2026-12-31';
      value[field].effectiveTo = '2026-01-01';
      expectClosed(value, field);
    },
  );

  it('accepts explicit null rule endings without inventing a cutoff date', () => {
    const value = input();
    value.payDate = '2027-01-31';
    value.tax.opening.year = 2027;
    for (const field of ruleFields) change(value, `${field}.effectiveTo`, null);
    for (const field of contributionFields)
      value[field].contributionDate = '2027-01-01';
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      incomeTax: '980.00',
      net: '8820.00',
    });
  });

  it('does not treat undefined or absent rule endings as explicit null', () => {
    for (const field of ruleFields) {
      const undefinedEnding = input();
      change(undefinedEnding, `${field}.effectiveTo`, undefined);
      expectClosed(undefinedEnding, `${field}.effectiveTo`);
      const absentEnding = input();
      delete (absentEnding[field] as unknown as Record<string, unknown>)
        .effectiveTo;
      expectClosed(absentEnding, `${field}.effectiveTo`);
    }
  });

  it.each([
    '2026-02-29',
    '2026-11-31',
    '2026-00-01',
    '2026-13-01',
    '2026-11-00',
    '0000-01-01',
    '2026-1-01',
    '2026-11-30T00:00:00Z',
    '2026-11-30\n',
  ])('rejects noncalendar date %s', (date) => {
    for (const path of [
      'payDate',
      'socialInsurance.contributionDate',
      'housingFund.effectiveFrom',
      'tax.effectiveTo',
    ]) {
      const value = input();
      change(value, path, date);
      expectClosed(value, path);
    }
  });

  it('accepts actual leap day and inclusive effective endpoints', () => {
    const value = input();
    value.payDate = '2028-02-29';
    value.tax.opening.year = 2028;
    for (const field of ruleFields) {
      value[field].effectiveFrom = '2028-02-29';
      value[field].effectiveTo = '2028-02-29';
    }
    for (const field of contributionFields)
      value[field].contributionDate = '2028-02-29';
    expect(calculatePayrollDeductions(value).status).toBe('ready');
  });

  it('keeps prior-year contribution dates separate from the payment tax year', () => {
    const value = input();
    for (const field of contributionFields) {
      value[field].contributionDate = '2025-12-31';
      value[field].effectiveFrom = '2025-01-01';
      value[field].effectiveTo = '2025-12-31';
    }
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      incomeTax: '980.00',
      evidence: { tax: { taxYear: 2026 } },
    });
    value.tax.opening.year = 2025;
    expectClosed(value, 'tax.opening.year');
  });

  it.each(contributionFields)(
    'uses %s contributionDate for expiry, never payDate',
    (field) => {
      const value = input();
      value[field].contributionDate = '2025-12-31';
      expectClosed(value, `${field}.effective`);
    },
  );

  it('uses payDate for tax-rule expiry', () => {
    const value = input();
    value.tax.effectiveTo = '2026-11-29';
    expectClosed(value, 'tax.effective');
  });

  it.each(['nonresident', 'annual_bonus', 'not_applicable', 'resident', ' '])(
    'does not infer resident cumulative method from %j',
    (method) => {
      const value = input();
      value.tax.method = method;
      expectClosed(value, 'tax.method');
    },
  );

  it.each([
    ['subjectId', 'other-subject'],
    ['employeeId', 'other-employee'],
    ['year', 2025],
    ['year', 2027],
    ['year', '2026'],
    ['year', 2026.5],
    ['confirmed', false],
    ['confirmed', 'true'],
    ['sourceVersion', ' '],
    ['evidenceRef', ' '],
  ])(
    'rejects unconfirmed or mismatched opening %s=%j',
    (field, replacement) => {
      const value = input();
      change(value, `tax.opening.${field}`, replacement);
      expectClosed(value, `tax.opening.${field}`);
    },
  );

  it.each(deductionFields)(
    'requires explicit current and opening %s',
    (field) => {
      for (const section of ['opening', 'current']) {
        for (const missing of [undefined, null]) {
          const value = input();
          change(value, `tax.${section}.${field}`, missing);
          expectClosed(value, `tax.${section}.${field}`);
        }
      }
    },
  );

  it.each(['income', 'taxPaid'])('requires explicit opening %s', (field) => {
    const value = input();
    change(value, `tax.opening.${field}`, null);
    expectClosed(value, `tax.opening.${field}`);
  });

  it('does not accept a second current income or taxPaid as a silent competing source', () => {
    for (const field of ['income', 'taxPaid']) {
      const value = input();
      change(value, `tax.current.${field}`, '100');
      expectClosed(value, `tax.current.${field}`);
    }
  });

  it('uses all explicit cumulative deductions and relief with already-paid tax', () => {
    const value = input();
    Object.assign(value.tax.opening, {
      income: '20000',
      exemptIncome: '1000',
      standardDeduction: '2000',
      specialDeduction: '300',
      additionalDeduction: '400',
      otherDeduction: '500',
      taxRelief: '30',
      taxPaid: '500',
    });
    Object.assign(value.tax.current, {
      exemptIncome: '100',
      standardDeduction: '200',
      specialDeduction: '200',
      additionalDeduction: '300',
      otherDeduction: '400',
      taxRelief: '20',
    });
    // 30000 - 1100 - 2200 - 500 - 700 - 900 = 24600; 2460 - 50 - 500 = 1910.
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      incomeTax: '1910.00',
      net: '7890.00',
      evidence: { tax: { taxableIncome: '24600', unroundedBalance: '1910' } },
    });
  });

  it('uses confirmed paid-to-date for a second payment in the same month', () => {
    const value = input();
    value.tax.opening.income = '10000';
    value.tax.opening.specialDeduction = '200';
    value.tax.opening.taxPaid = '980';
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      incomeTax: '980.00',
      net: '8820.00',
    });
  });

  it('does not reset old cumulative facts automatically at a new year', () => {
    const value = input();
    value.payDate = '2027-01-01';
    value.tax.effectiveFrom = '2027-01-01';
    value.tax.effectiveTo = '2027-12-31';
    expectClosed(value, 'tax.opening.year');
    value.tax.opening.year = 2027;
    expect(calculatePayrollDeductions(value).status).toBe('ready');
  });

  it.each(['0', '500', '12000'])(
    'keeps specialDeduction=%s independent of personal contributions',
    (amount) => {
      const value = input();
      value.tax.current.specialDeduction = amount;
      const result = calculatePayrollDeductions(value);
      expect(result.status).toBe('ready');
      expect(result.incomeTax).toBe(
        { '0': '1000.00', '500': '950.00', '12000': '0.00' }[amount],
      );
      expect(result.socialInsurance).toBe('100.00');
    },
  );

  it('records a negative tax balance as credit, never as a cash refund', () => {
    const value = input();
    value.tax.opening.taxPaid = '1200';
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      incomeTax: '0.00',
      net: '9800.00',
      evidence: {
        tax: { unroundedBalance: '-220', carryForwardCredit: '220.00' },
      },
    });
  });

  it('subtracts cumulative tax relief rather than taxing exempt or deducted income', () => {
    const value = input();
    value.tax.opening.taxRelief = '30';
    value.tax.current.taxRelief = '50';
    expect(calculatePayrollDeductions(value).incomeTax).toBe('900.00');
  });

  it.each([
    ['1000', '100.00'],
    ['1000.01', '100.00'],
    ['1001', '100.20'],
    ['2000', '300.00'],
  ])('uses continuous fictional brackets at income %s', (gross, tax) => {
    const value = noContributions();
    value.gross = gross;
    value.tax.brackets = [
      { upTo: '1000', rate: '0.1', quickDeduction: '0' },
      { upTo: null, rate: '0.2', quickDeduction: '100' },
    ];
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      incomeTax: tax,
    });
  });

  it.each([
    [],
    [{ upTo: '1000', rate: '0.1', quickDeduction: '0' }],
    [{ upTo: null, rate: '0.1', quickDeduction: '1' }],
    [
      { upTo: '0', rate: '0.1', quickDeduction: '0' },
      { upTo: null, rate: '0.2', quickDeduction: '0' },
    ],
    [
      { upTo: '1000', rate: '0.1', quickDeduction: '0' },
      { upTo: null, rate: '0.2', quickDeduction: '99' },
    ],
    [
      { upTo: '1000', rate: '0.1', quickDeduction: '0' },
      { upTo: '1000', rate: '0.2', quickDeduction: '100' },
      { upTo: null, rate: '0.3', quickDeduction: '200' },
    ],
    [
      { upTo: null, rate: '0.1', quickDeduction: '0' },
      { upTo: null, rate: '0.2', quickDeduction: '0' },
    ],
    [null],
    [{ upTo: undefined, rate: '0.1', quickDeduction: '0' }],
  ])(
    'rejects incomplete, overlapping or discontinuous tax table %#',
    (...rows) => {
      const value = input();
      // Jest expands array cases into arguments; the final case index is not included.
      change(value, 'tax.brackets', rows);
      expectClosed(value, 'tax.brackets');
    },
  );

  it('rounds each personal contribution component half up, retaining raw products', () => {
    const value = noContributions();
    value.gross = '100.005';
    value.socialInsurance.status = 'applicable';
    value.socialInsurance.items = [
      { code: 'synthetic-a', base: '1.005', rate: '1' },
      { code: 'synthetic-b', base: '1.005', rate: '1' },
    ];
    value.tax.brackets[0].rate = '0';
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      gross: '100.01',
      socialInsurance: '2.02',
      net: '97.99',
      evidence: {
        grossUnrounded: '100.005',
        socialInsurance: {
          entries: [
            { unroundedAmount: '1.005', amount: '1.01' },
            { unroundedAmount: '1.005', amount: '1.01' },
          ],
        },
      },
    });
  });

  it('uses the rounded payable gross as the current taxable income source', () => {
    const value = noContributions();
    value.gross = '100.005';
    value.tax.brackets[0].rate = '1';
    expect(calculatePayrollDeductions(value)).toMatchObject({
      status: 'ready',
      gross: '100.01',
      incomeTax: '100.01',
      net: '0.00',
      evidence: { tax: { cumulative: { income: '100.01' } } },
    });
  });

  it('rounds current tax half up only after relief and paid-to-date subtraction', () => {
    const value = noContributions();
    value.gross = '10';
    value.tax.current.taxRelief = '0.005';
    expect(calculatePayrollDeductions(value).incomeTax).toBe('1.00');
  });

  it('preserves large cents and long rate precision without shared Decimal settings', () => {
    const settings = {
      precision: Prisma.Decimal.precision,
      rounding: Prisma.Decimal.rounding,
      minE: Prisma.Decimal.minE,
      maxE: Prisma.Decimal.maxE,
    };
    try {
      Prisma.Decimal.set({
        precision: 3,
        rounding: Prisma.Decimal.ROUND_DOWN,
        minE: -2,
        maxE: 2,
      });
      const value = noContributions();
      value.gross = '999999999999.995';
      value.tax.brackets[0].rate = '0.10000000000000000000000000000000000001';
      expect(calculatePayrollDeductions(value)).toMatchObject({
        status: 'ready',
        gross: '1000000000000.00',
        incomeTax: '100000000000.00',
        net: '900000000000.00',
      });
      expect(Prisma.Decimal.precision).toBe(3);
      expect(Prisma.Decimal.rounding).toBe(Prisma.Decimal.ROUND_DOWN);
      expect(Prisma.Decimal.minE).toBe(-2);
      expect(Prisma.Decimal.maxE).toBe(2);
    } finally {
      Prisma.Decimal.set(settings);
    }
  });

  it('holds a negative net for review with all result money null, preserving evidence', () => {
    const value = input();
    value.gross = '50';
    const result = calculatePayrollDeductions(value);
    expect(result.status).toBe('needs_review');
    for (const field of moneyFields) expect(result[field]).toBeNull();
    expect(result.issues.some((issue) => issue.includes('net'))).toBe(true);
    expect(result.evidence).toMatchObject({
      unroundedNet: '-150',
      socialInsurance: { amount: '100.00' },
    });
  });

  it('detaches evidence and does not mutate even frozen input', () => {
    const value = input();
    const freeze = (object: any) => {
      if (object && typeof object === 'object') {
        Object.values(object).forEach(freeze);
        Object.freeze(object);
      }
    };
    const before = JSON.stringify(value);
    freeze(value);
    const result = calculatePayrollDeductions(value);
    expect(result.status).toBe('ready');
    expect(JSON.stringify(value)).toBe(before);
    expect(result.evidence.input).toEqual(value);
    expect(result.evidence.input).not.toBe(value);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('retains original input strings and version evidence after callers change them', () => {
    const value = input();
    value.gross = '10000.00';
    const result = calculatePayrollDeductions(value);
    value.tax.opening.sourceVersion = 'changed';
    value.socialInsurance.items[0].base = '5';
    expect(result.evidence.input).toMatchObject({
      gross: '10000.00',
      tax: { opening: { sourceVersion: 'fictional-opening-v1' } },
      socialInsurance: { items: [{ base: '1000' }] },
    });
  });

  it('hashes recursively canonical object keys deterministically', () => {
    const value = input();
    const reverseKeys = (entry: any): any => {
      if (Array.isArray(entry)) return entry.map(reverseKeys);
      if (entry && typeof entry === 'object') {
        return Object.fromEntries(
          Object.entries(entry)
            .reverse()
            .map(([key, child]) => [key, reverseKeys(child)]),
        );
      }
      return entry;
    };
    const first = calculatePayrollDeductions(value);
    const second = calculatePayrollDeductions(reverseKeys(value));
    expect(first.evidence.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.evidence.sourceHash).toBe(first.evidence.sourceHash);
    expect(calculatePayrollDeductions(value)).toEqual(first);
  });

  it.each([
    ['subjectId', 'other'],
    ['employeeId', 'other'],
    ['payDate', '2026-11-29'],
    ['gross', '10001'],
    ['socialInsurance.contributionDate', '2026-11-02'],
    ['socialInsurance.ruleVersion', 'v2'],
    ['housingFund.evidenceRef', 'other'],
    ['tax.ruleVersion', 'v2'],
    ['tax.evidenceRef', 'other'],
    ['tax.opening.sourceVersion', 'v2'],
    ['tax.opening.evidenceRef', 'other'],
    ['tax.opening.taxPaid', '1'],
    ['tax.current.specialDeduction', '300'],
    ['tax.brackets.0.rate', '0.2'],
  ])('changes source hash for changed %s', (path, replacement) => {
    const value = input();
    const first = calculatePayrollDeductions(value).evidence.sourceHash;
    change(value, path, replacement);
    const second = calculatePayrollDeductions(value).evidence.sourceHash;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });

  it('rejects non-JSON values or cycles without mutating them or throwing', () => {
    const value = input();
    change(value, 'tax.current.taxRelief', NaN);
    expectClosed(value, 'input');
    change(value, 'tax.current.taxRelief', value);
    expectClosed(value, 'input');
  });
});
