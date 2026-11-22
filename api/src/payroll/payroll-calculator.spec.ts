import { Prisma } from '@prisma/client';
import {
  calculatePayroll,
  PayrollCalculationInput,
  PayrollCalculationResult,
  PayrollSegment,
} from './payroll-calculator';

function segment(overrides: Partial<PayrollSegment> = {}): PayrollSegment {
  return {
    from: '2026-11-01',
    to: '2026-11-30',
    units: '20',
    monthUnits: '20',
    fixedMonthly: '17400',
    performanceBase: null,
    performanceMode: 'none',
    coefficient: null,
    ...overrides,
  };
}

function input(
  overrides: Partial<PayrollCalculationInput> = {},
): PayrollCalculationInput {
  return {
    segments: [segment()],
    absences: [],
    overtime: [],
    adjustments: [],
    ...overrides,
  };
}

function item(result: PayrollCalculationResult, code: string) {
  const found = result.items.find((entry) => entry.code === code);
  expect(found).toBeDefined();
  return found!;
}

function expectUnresolved(value: PayrollCalculationInput, path: string) {
  const result = calculatePayroll(value);
  expect(result.status).toBe('needs_configuration');
  expect(result.gross).toBeNull();
  expect(result.issues.some((issue) => issue.includes(path))).toBe(true);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
}

describe('calculatePayroll', () => {
  it('calculates 17400 - 200 + 300 = 17500 without changing its input', () => {
    const value = input({
      absences: [{ hours: '2', normalHourly: '100', paidHourly: '0' }],
      overtime: [{ hours: '2', hourlyBase: '100', multiplier: '1.5' }],
    });
    const original = JSON.parse(JSON.stringify(value));

    const result = calculatePayroll(value);

    expect(result.status).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(item(result, 'fixed').amount).toBe('17400.00');
    expect(item(result, 'absence').amount).toBe('-200.00');
    expect(item(result, 'overtime').amount).toBe('300.00');
    expect(result.gross).toBe('17500.00');
    expect(value).toEqual(original);
  });

  it('prorates a partial month to 8700 without inferring units from dates', () => {
    const result = calculatePayroll(
      input({ segments: [segment({ to: '2026-11-15', units: '10' })] }),
    );
    expect(result.status).toBe('ready');
    expect(result.gross).toBe('8700.00');
  });

  it('sums two effective salary standards before item rounding to get 18400', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({ to: '2026-11-15', units: '10' }),
          segment({ from: '2026-11-16', units: '10', fixedMonthly: '19400' }),
        ],
      }),
    );
    expect(result.status).toBe('ready');
    expect(item(result, 'fixed').amount).toBe('18400.00');
    expect(result.gross).toBe('18400.00');
  });

  it.each([
    ['included', '8000.00', '10400.00'],
    ['additional', '10000.00', '12400.00'],
  ] as const)(
    'handles %s performance without counting its base twice',
    (mode, fixed, gross) => {
      const result = calculatePayroll(
        input({
          segments: [
            segment({
              fixedMonthly: '10000',
              performanceBase: '2000',
              performanceMode: mode,
              coefficient: '1.2',
            }),
          ],
        }),
      );
      expect(result.status).toBe('ready');
      expect(item(result, 'fixed').amount).toBe(fixed);
      expect(item(result, 'performance').amount).toBe('2400.00');
      expect(result.gross).toBe(gross);
    },
  );

  it('prorates the fixed and performance components independently in each segment', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({
            to: '2026-11-15',
            units: '10',
            fixedMonthly: '10000',
            performanceBase: '2000',
            performanceMode: 'included',
            coefficient: '1.2',
          }),
          segment({
            from: '2026-11-16',
            units: '10',
            fixedMonthly: '12000',
            performanceBase: '3000',
            performanceMode: 'included',
            coefficient: '0.8',
          }),
        ],
      }),
    );
    expect(result.status).toBe('ready');
    expect(item(result, 'fixed').amount).toBe('8500.00');
    expect(item(result, 'performance').amount).toBe('2400.00');
    expect(result.gross).toBe('10900.00');
  });

  it('uses explicit none without requiring or silently adding performance', () => {
    const result = calculatePayroll(input());
    expect(result.status).toBe('ready');
    expect(result.items.some((entry) => entry.code === 'performance')).toBe(
      false,
    );
    expect(result.gross).toBe('17400.00');
  });

  it('adds three explicitly approved monthly performance amounts of 2400 as 7200 to gross', () => {
    const months = ['09', '10', '11'];
    const performance = months.map((month) =>
      calculatePayroll(
        input({
          segments: [
            segment({
              from: `2026-${month}-01`,
              to: `2026-${month}-28`,
              fixedMonthly: '0',
              performanceBase: '2000',
              performanceMode: 'additional',
              coefficient: '1.2',
            }),
          ],
        }),
      ),
    );
    for (const result of performance) {
      expect(result.status).toBe('ready');
      expect(item(result, 'performance').amount).toBe('2400.00');
    }
    const result = calculatePayroll(
      input({
        adjustments: performance.map((result, index) => ({
          amount: item(result, 'performance').amount,
          reason: `Approved synthetic performance for 2026-${months[index]}`,
        })),
      }),
    );
    expect(item(result, 'adjustment').amount).toBe('7200.00');
    expect(result.gross).toBe('24600.00');
  });

  it('keeps explicit zero standards, zero hours, zero rates and zero coefficients valid', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({
            fixedMonthly: '0',
            performanceBase: '0',
            performanceMode: 'included',
            coefficient: '0',
            units: '0',
          }),
        ],
        absences: [{ hours: '0', normalHourly: '0', paidHourly: '0' }],
        overtime: [{ hours: '0', hourlyBase: '0', multiplier: '0' }],
        adjustments: [{ amount: '0', reason: 'Explicit synthetic zero' }],
      }),
    );
    expect(result.status).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.items).toHaveLength(5);
    expect(result.items.every((entry) => entry.amount === '0.00')).toBe(true);
    expect(result.gross).toBe('0.00');
  });

  it('calculates 7200 performance and 24600 gross from an explicitly supplied aggregate payout base', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({
            performanceBase: '6000',
            performanceMode: 'additional',
            coefficient: '1.2',
          }),
        ],
      }),
    );
    expect(result.status).toBe('ready');
    expect(item(result, 'performance').amount).toBe('7200.00');
    expect(result.gross).toBe('24600.00');
  });

  it('does not replace an explicit zero coefficient with one', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({
            fixedMonthly: '10000',
            performanceBase: '2000',
            performanceMode: 'included',
            coefficient: '0',
          }),
        ],
      }),
    );
    expect(result.status).toBe('ready');
    expect(item(result, 'performance').amount).toBe('0.00');
    expect(result.gross).toBe('8000.00');
  });

  it('rounds each item half-up after summing its entries, then sums rounded items', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({ to: '2026-11-15', units: '10', fixedMonthly: '0.01' }),
          segment({ from: '2026-11-16', units: '10', fixedMonthly: '0.01' }),
        ],
        absences: [
          { hours: '0.001', normalHourly: '1', paidHourly: '0' },
          { hours: '0.004', normalHourly: '1', paidHourly: '0' },
        ],
        overtime: [{ hours: '0.005', hourlyBase: '1', multiplier: '1' }],
        adjustments: [
          { amount: '0.002', reason: 'Synthetic correction one' },
          { amount: '0.003', reason: 'Synthetic correction two' },
        ],
      }),
    );
    expect(result.status).toBe('ready');
    expect(item(result, 'fixed').amount).toBe('0.01');
    expect(item(result, 'absence').amount).toBe('-0.01');
    expect(item(result, 'overtime').amount).toBe('0.01');
    expect(item(result, 'adjustment').amount).toBe('0.01');
    expect(result.gross).toBe('0.02');
  });

  it('rounds aggregated performance once, not each half-cent segment', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({
            to: '2026-11-15',
            units: '10',
            fixedMonthly: '0',
            performanceBase: '0.01',
            performanceMode: 'additional',
            coefficient: '1',
          }),
          segment({
            from: '2026-11-16',
            units: '10',
            fixedMonthly: '0',
            performanceBase: '0.01',
            performanceMode: 'additional',
            coefficient: '1',
          }),
        ],
      }),
    );
    expect(result.status).toBe('ready');
    expect(item(result, 'performance').amount).toBe('0.01');
    expect(result.gross).toBe('0.01');
  });

  it('sums segment numerators before division at an exact half-cent boundary', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({
            to: '2026-11-15',
            units: '1',
            monthUnits: '3',
            fixedMonthly: '0.01',
          }),
          segment({
            from: '2026-11-16',
            units: '1',
            monthUnits: '3',
            fixedMonthly: '0.005',
          }),
        ],
      }),
    );
    expect(result.status).toBe('ready');
    expect(item(result, 'fixed').amount).toBe('0.01');
    expect(result.gross).toBe('0.01');
  });

  it('never emits negative zero for sub-cent deductions', () => {
    const result = calculatePayroll(
      input({
        segments: [segment({ fixedMonthly: '0' })],
        adjustments: [
          { amount: '-0.001', reason: 'Synthetic sub-cent correction' },
        ],
      }),
    );
    expect(item(result, 'adjustment').amount).toBe('0.00');
    expect(result.gross).toBe('0.00');
  });

  it('does not lose cents beyond binary float or the default Decimal precision', () => {
    const result = calculatePayroll(
      input({
        segments: [
          segment({ fixedMonthly: '123456789012345678901234567890.12' }),
        ],
        adjustments: [{ amount: '0.01', reason: 'Synthetic exact cent' }],
      }),
    );
    expect(result.status).toBe('ready');
    expect(result.gross).toBe('123456789012345678901234567890.13');
  });

  it('preserves original strings and intermediate calculations in JSON-friendly detached evidence', () => {
    const value = input({
      segments: [
        segment({
          to: '2026-11-15',
          units: '10.00',
          fixedMonthly: '10000.00',
          performanceBase: '2000.00',
          performanceMode: 'included',
          coefficient: '1.20',
        }),
      ],
      absences: [
        { hours: '2.00', normalHourly: '100.00', paidHourly: '50.00' },
      ],
      overtime: [{ hours: '2.00', hourlyBase: '100.00', multiplier: '1.50' }],
      adjustments: [
        { amount: '-10.001', reason: 'Synthetic authorized correction' },
      ],
    });
    const result = calculatePayroll(value);
    expect(result.status).toBe('ready');
    expect(item(result, 'fixed').evidence).toMatchObject({
      unroundedAmount: '4000',
      entries: [
        {
          index: 0,
          input: { units: '10.00', coefficient: '1.20' },
          ratio: '0.5',
          fixedBase: '8000',
          amount: '4000',
        },
      ],
    });
    expect(item(result, 'performance').evidence).toMatchObject({
      unroundedAmount: '1200',
      entries: [{ amount: '1200' }],
    });
    expect(item(result, 'absence').evidence).toMatchObject({
      entries: [
        { input: value.absences[0], hourlyDifference: '-50', amount: '-100' },
      ],
    });
    expect(item(result, 'overtime').evidence).toMatchObject({
      entries: [{ input: value.overtime[0], amount: '300' }],
    });
    expect(item(result, 'adjustment').evidence).toMatchObject({
      unroundedAmount: '-10.001',
      entries: [{ input: value.adjustments[0], amount: '-10.001' }],
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    value.segments[0].units = '1';
    value.adjustments[0].reason = 'Changed after calculation';
    expect(item(result, 'fixed').evidence.entries[0].input).toMatchObject({
      units: '10.00',
    });
    expect(item(result, 'adjustment').evidence.entries[0].input).toMatchObject({
      reason: 'Synthetic authorized correction',
    });
  });

  it('does not mutate or depend on the shared Prisma.Decimal configuration', () => {
    const before = {
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
      const result = calculatePayroll(
        input({ segments: [segment({ fixedMonthly: '17400.005' })] }),
      );
      expect(result.gross).toBe('17400.01');
      expect(Prisma.Decimal.precision).toBe(3);
      expect(Prisma.Decimal.rounding).toBe(Prisma.Decimal.ROUND_DOWN);
      expect(Prisma.Decimal.minE).toBe(-2);
      expect(Prisma.Decimal.maxE).toBe(2);
    } finally {
      Prisma.Decimal.set(before);
    }
  });

  describe('invalid or missing configuration', () => {
    it.each([
      'fixedMonthly',
      'units',
      'monthUnits',
      'performanceMode',
    ] as const)('rejects missing %s', (field) => {
      const value = input();
      delete (value.segments[0] as unknown as Record<string, unknown>)[field];
      expectUnresolved(value, `segments[0].${field}`);
    });

    it.each(['included', 'additional'] as const)(
      'requires base and coefficient for %s performance even with zero units',
      (mode) => {
        expectUnresolved(
          input({ segments: [segment({ performanceMode: mode, units: '0' })] }),
          'performanceBase',
        );
        expectUnresolved(
          input({
            segments: [
              segment({ performanceMode: mode, performanceBase: '2000' }),
            ],
          }),
          'coefficient',
        );
      },
    );

    it('does not turn null fixed pay into zero', () => {
      expectUnresolved(
        input({ segments: [segment({ fixedMonthly: null })] }),
        'fixedMonthly',
      );
    });

    it.each([
      '',
      ' ',
      'NaN',
      'Infinity',
      '-Infinity',
      '1e3',
      '0x10',
      '1_000',
      '1,000',
      '1.2.3',
      ' 1 ',
      '1\n',
    ])('rejects invalid decimal %j', (value) => {
      expectUnresolved(
        input({ segments: [segment({ fixedMonthly: value })] }),
        'fixedMonthly',
      );
    });

    it('rejects numbers at runtime rather than converting an already rounded float', () => {
      expectUnresolved(
        input({
          segments: [segment({ fixedMonthly: 17400 as unknown as string })],
        }),
        'fixedMonthly',
      );
    });

    it.each([
      ['units', '-1'],
      ['monthUnits', '0'],
      ['monthUnits', '-1'],
      ['fixedMonthly', '-1'],
      ['performanceBase', '-1'],
      ['coefficient', '-1'],
    ] as const)('rejects invalid %s=%s', (field, value) => {
      expectUnresolved(
        input({ segments: [segment({ [field]: value })] }),
        field,
      );
    });

    it('rejects included performance exceeding the configured monthly total', () => {
      expectUnresolved(
        input({
          segments: [
            segment({
              fixedMonthly: '1000',
              performanceBase: '2000',
              performanceMode: 'included',
              coefficient: '1',
            }),
          ],
        }),
        'performanceBase',
      );
    });

    it('rejects an unrecognized performance mode rather than assuming none', () => {
      expectUnresolved(
        input({
          segments: [
            segment({
              performanceMode: 'unknown' as PayrollSegment['performanceMode'],
            }),
          ],
        }),
        'performanceMode',
      );
    });

    it('rejects invalid optional decimals even when performance is explicitly none', () => {
      expectUnresolved(
        input({ segments: [segment({ coefficient: 'NaN' })] }),
        'coefficient',
      );
    });

    it.each([
      ['2026-02-29', '2026-02-29'],
      ['2026-11-31', '2026-11-31'],
      ['2026-00-01', '2026-11-30'],
      ['2026-13-01', '2026-13-31'],
      ['2026-11-00', '2026-11-30'],
      ['2026-11-02', '2026-11-01'],
      ['2026-11-01T00:00:00Z', '2026-11-30'],
      ['2026-1-01', '2026-11-30'],
      ['2026-11-30', '2026-12-01'],
      ['2026-12-31', '2027-01-01'],
    ])('rejects invalid or cross-month range %s to %s', (from, to) => {
      expectUnresolved(
        input({ segments: [segment({ from, to })] }),
        'segments[0]',
      );
    });

    it('accepts a real leap day and a one-day inclusive segment', () => {
      const result = calculatePayroll(
        input({
          segments: [
            segment({
              from: '2028-02-29',
              to: '2028-02-29',
              units: '1',
              monthUnits: '20',
            }),
          ],
        }),
      );
      expect(result.status).toBe('ready');
      expect(result.gross).toBe('870.00');
    });

    it('rejects inclusive endpoint overlap even when units do not exceed monthUnits', () => {
      expectUnresolved(
        input({
          segments: [
            segment({ to: '2026-11-15', units: '10' }),
            segment({ from: '2026-11-15', units: '10' }),
          ],
        }),
        'overlap',
      );
    });

    it('rejects overlap in unsorted input', () => {
      expectUnresolved(
        input({
          segments: [
            segment({ from: '2026-11-16', units: '5' }),
            segment({ from: '2026-11-01', to: '2026-11-17', units: '5' }),
          ],
        }),
        'overlap',
      );
    });

    it('accepts unsorted nonoverlapping input without sorting or mutating caller data', () => {
      const value = input({
        segments: [
          segment({ from: '2026-11-16', units: '10', fixedMonthly: '19400' }),
          segment({ to: '2026-11-15', units: '10' }),
        ],
      });
      const original = JSON.parse(JSON.stringify(value));
      expect(calculatePayroll(value).gross).toBe('18400.00');
      expect(value).toEqual(original);
    });

    it('requires all segments in a calculation to use the same calendar month', () => {
      expectUnresolved(
        input({
          segments: [
            segment({ from: '2026-10-01', to: '2026-10-15', units: '10' }),
            segment({ from: '2026-11-16', units: '10' }),
          ],
        }),
        'month',
      );
    });

    it('requires one consistent monthUnits denominator', () => {
      expectUnresolved(
        input({
          segments: [
            segment({ to: '2026-11-15', units: '10' }),
            segment({ from: '2026-11-16', units: '10', monthUnits: '21' }),
          ],
        }),
        'monthUnits',
      );
    });

    it('rejects total segment units exceeding the configured monthUnits', () => {
      expectUnresolved(
        input({
          segments: [
            segment({ to: '2026-11-15', units: '10.001' }),
            segment({ from: '2026-11-16', units: '10' }),
          ],
        }),
        'units',
      );
    });

    it('rejects a single segment exceeding monthUnits', () => {
      expectUnresolved(
        input({ segments: [segment({ units: '21' })] }),
        'units',
      );
    });

    it.each(['hours', 'normalHourly', 'paidHourly'] as const)(
      'validates absence %s without defaults',
      (field) => {
        for (const value of ['-1', 'NaN', null, undefined]) {
          expectUnresolved(
            input({
              absences: [
                {
                  hours: '2',
                  normalHourly: '100',
                  paidHourly: '0',
                  [field]: value,
                } as never,
              ],
            }),
            `absences[0].${field}`,
          );
        }
      },
    );

    it.each(['hours', 'hourlyBase', 'multiplier'] as const)(
      'validates overtime %s without defaults',
      (field) => {
        for (const value of ['-1', 'Infinity', null, undefined]) {
          expectUnresolved(
            input({
              overtime: [
                {
                  hours: '2',
                  hourlyBase: '100',
                  multiplier: '1.5',
                  [field]: value,
                } as never,
              ],
            }),
            `overtime[0].${field}`,
          );
        }
      },
    );

    it.each(['', ' ', null, undefined])(
      'rejects a missing adjustment reason %j',
      (reason) => {
        expectUnresolved(
          input({ adjustments: [{ amount: '1', reason: reason as string }] }),
          'adjustments[0].reason',
        );
      },
    );

    it('rejects an invalid adjustment amount without defaulting it to zero', () => {
      expectUnresolved(
        input({
          adjustments: [{ amount: 'NaN', reason: 'Synthetic correction' }],
        }),
        'adjustments[0].amount',
      );
    });

    it('keeps a configured item preview but does not emit a partial invalid item or gross', () => {
      const result = calculatePayroll(
        input({
          overtime: [
            { hours: '1', hourlyBase: '100', multiplier: '1.5' },
            {
              hours: '1',
              hourlyBase: '100',
              multiplier: null as unknown as string,
            },
          ],
        }),
      );
      expect(result.status).toBe('needs_configuration');
      expect(result.gross).toBeNull();
      expect(item(result, 'fixed').amount).toBe('17400.00');
      expect(result.items.some((entry) => entry.code === 'overtime')).toBe(
        false,
      );
    });

    it.each(['segments', 'absences', 'overtime', 'adjustments'] as const)(
      'requires the explicit %s array',
      (field) => {
        const value = input();
        delete (value as unknown as Record<string, unknown>)[field];
        expectUnresolved(value, field);
      },
    );

    it('does not silently treat no salary segments as a configured zero salary', () => {
      expectUnresolved(input({ segments: [] }), 'segments');
    });
  });
});
