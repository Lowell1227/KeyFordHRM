import { BadRequestException } from '@nestjs/common';
import { buildPeriodDefinitions, normalizeScoringFrequency } from './cycle-scoring-plan';

describe('cycle scoring plan rules', () => {
  it('normalizes scoring frequency to the cycle type defaults and constraints', () => {
    expect(normalizeScoringFrequency('monthly')).toBe('monthly');
    expect(normalizeScoringFrequency('custom', 'monthly')).toBe('cycle');
    expect(normalizeScoringFrequency('quarterly')).toBe('monthly');
    expect(normalizeScoringFrequency('semiannual')).toBe('monthly');
    expect(normalizeScoringFrequency('annual')).toBe('monthly');
    expect(normalizeScoringFrequency('annual', 'cycle')).toBe('cycle');
  });

  it('builds the fixed number of start-month-anchored periods for monthly scoring', () => {
    const periods = buildPeriodDefinitions({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2026-07-01T00:00:00+08:00'),
      endDate: new Date('2026-09-30T00:00:00+08:00'),
    });

    expect(periods.map((item) => item.periodKey)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(periods.map((item) => item.periodType)).toEqual(['month', 'month', 'month']);
    expect(periods.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it.each([
    {
      type: 'quarterly' as const,
      startDate: '2026-11-15T00:00:00+08:00',
      endDate: '2027-02-14T00:00:00+08:00',
      expectedKeys: ['2026-11', '2026-12', '2027-01'],
    },
    {
      type: 'semiannual' as const,
      startDate: '2026-09-15T00:00:00+08:00',
      endDate: '2027-03-14T00:00:00+08:00',
      expectedKeys: ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'],
    },
    {
      type: 'annual' as const,
      startDate: '2026-03-15T00:00:00+08:00',
      endDate: '2027-03-14T00:00:00+08:00',
      expectedKeys: [
        '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
        '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02',
      ],
    },
  ])('returns the business period count for a partial cross-year $type range', ({
    type,
    startDate,
    endDate,
    expectedKeys,
  }) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const periods = buildPeriodDefinitions({
      type,
      scoringFrequency: 'monthly',
      startDate: start,
      endDate: end,
    });

    expect(periods.map((period) => period.periodKey)).toEqual(expectedKeys);
    expect(periods[0].periodStart).toEqual(start);
    expect(periods.at(-1)?.periodEnd).toEqual(end);
  });

  it('keeps a monthly cycle as one period when adjusted dates cross a calendar-month boundary', () => {
    const periods = buildPeriodDefinitions({
      type: 'monthly',
      scoringFrequency: 'monthly',
      startDate: new Date('2026-01-20T00:00:00+08:00'),
      endDate: new Date('2026-02-19T00:00:00+08:00'),
    });

    expect(periods).toHaveLength(1);
    expect(periods[0]).toEqual(expect.objectContaining({
      periodKey: '2026-01',
      periodEnd: new Date('2026-02-19T00:00:00+08:00'),
    }));
  });

  it('uses the cycle boundary dates for partial first and last months', () => {
    const startDate = new Date('2026-07-10T00:00:00+08:00');
    const endDate = new Date('2026-09-20T00:00:00+08:00');
    const periods = buildPeriodDefinitions({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate,
      endDate,
    });

    expect(periods[0]).toEqual(expect.objectContaining({ periodKey: '2026-07', periodStart: startDate }));
    expect(periods[2]).toEqual(expect.objectContaining({ periodKey: '2026-09', periodEnd: endDate }));
  });

  it('builds a single cycle period for cycle scoring', () => {
    expect(
      buildPeriodDefinitions({
        type: 'quarterly',
        scoringFrequency: 'cycle',
        startDate: new Date('2026-07-01T00:00:00+08:00'),
        endDate: new Date('2026-09-30T00:00:00+08:00'),
      }),
    ).toEqual([expect.objectContaining({ periodKey: 'cycle', periodType: 'cycle', sequence: 1 })]);
  });

  it('rejects a cycle whose end calendar date precedes its start calendar date', () => {
    expect(() =>
      buildPeriodDefinitions({
        type: 'quarterly',
        scoringFrequency: 'monthly',
        startDate: new Date('2026-09-01T00:00:00+08:00'),
        endDate: new Date('2026-08-31T00:00:00+08:00'),
      }),
    ).toThrow(BadRequestException);
  });
});
