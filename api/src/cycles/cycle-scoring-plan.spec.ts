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

  it('builds one row for each calendar month in a standard quarterly range', () => {
    const periods = buildPeriodDefinitions({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
    });

    expect(periods.map((item) => item.periodKey)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(periods.map((item) => item.periodType)).toEqual(['month', 'month', 'month']);
    expect(periods.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it.each([
    {
      type: 'monthly' as const,
      startDate: '2026-01-20T00:00:00.000Z',
      endDate: '2026-02-19T00:00:00.000Z',
      expectedKeys: ['2026-01', '2026-02'],
    },
    {
      type: 'quarterly' as const,
      startDate: '2026-10-02T00:00:00.000Z',
      endDate: '2026-11-24T00:00:00.000Z',
      expectedKeys: ['2026-10', '2026-11'],
    },
    {
      type: 'quarterly' as const,
      startDate: '2026-11-15T00:00:00.000Z',
      endDate: '2027-02-14T00:00:00.000Z',
      expectedKeys: ['2026-11', '2026-12', '2027-01', '2027-02'],
    },
    {
      type: 'semiannual' as const,
      startDate: '2026-09-15T00:00:00.000Z',
      endDate: '2027-03-14T00:00:00.000Z',
      expectedKeys: ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'],
    },
    {
      type: 'annual' as const,
      startDate: '2026-03-15T00:00:00.000Z',
      endDate: '2027-03-14T00:00:00.000Z',
      expectedKeys: [
        '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
        '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
      ],
    },
  ])('builds one follow-up row per covered calendar month for a $type cycle', ({
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

  it('uses the cycle boundary dates for partial first and last months', () => {
    const startDate = new Date('2026-07-10T00:00:00.000Z');
    const endDate = new Date('2026-09-20T00:00:00.000Z');
    const periods = buildPeriodDefinitions({
      type: 'quarterly',
      scoringFrequency: 'monthly',
      startDate,
      endDate,
    });

    expect(periods.map((period) => [period.periodStart.toISOString(), period.periodEnd.toISOString()])).toEqual([
      ['2026-07-10T00:00:00.000Z', '2026-07-31T00:00:00.000Z'],
      ['2026-08-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z'],
      ['2026-09-01T00:00:00.000Z', '2026-09-20T00:00:00.000Z'],
    ]);
  });

  it('builds a single cycle period for cycle scoring', () => {
    expect(
      buildPeriodDefinitions({
        type: 'quarterly',
        scoringFrequency: 'cycle',
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-09-30T00:00:00.000Z'),
      }),
    ).toEqual([expect.objectContaining({ periodKey: 'cycle', periodType: 'cycle', sequence: 1 })]);
  });

  it('rejects a cycle whose end calendar date precedes its start calendar date', () => {
    expect(() =>
      buildPeriodDefinitions({
        type: 'quarterly',
        scoringFrequency: 'monthly',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2026-08-31T00:00:00.000Z'),
      }),
    ).toThrow(BadRequestException);
  });
});
