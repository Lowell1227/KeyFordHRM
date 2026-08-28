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

  it('builds one YYYY-MM period per calendar month for monthly scoring', () => {
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
