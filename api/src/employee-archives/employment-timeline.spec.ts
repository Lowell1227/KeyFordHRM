import { employmentWarnings, selectEmploymentAt } from './employment-timeline';

const records = [
  {
    id: 'earlier',
    effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
    effectiveTo: null,
  },
  {
    id: 'later',
    effectiveFrom: new Date('2025-06-01T00:00:00.000Z'),
    effectiveTo: null,
  },
];

describe('employment timeline', () => {
  it('重叠时选择生效起始日较晚的记录并保留提醒', () => {
    const result = selectEmploymentAt(records, new Date('2026-09-01T00:00:00.000Z'));

    expect(result.current?.id).toBe('later');
    expect(result.warnings).toEqual(['任职时间重叠']);
  });

  it('历史补录与现有区间重叠时只生成提醒', () => {
    const warnings = employmentWarnings(records, {
      id: 'history',
      effectiveFrom: new Date('2025-03-01T00:00:00.000Z'),
      effectiveTo: new Date('2025-03-31T00:00:00.000Z'),
    });

    expect(warnings).toEqual(['任职时间与 1 条已有记录重叠']);
  });
});
