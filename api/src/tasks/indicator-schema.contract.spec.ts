import { FlowAction, IndicatorVisibilityScope } from '@prisma/client';

describe('indicator visibility Prisma contract', () => {
  it('exports every supported scope and withdraw action', () => {
    expect(Object.values(IndicatorVisibilityScope)).toEqual([
      'company',
      'department',
      'department_tree',
      'direct_reports',
      'all_reports',
      'supervisors',
      'custom',
    ]);
    expect(FlowAction.withdraw).toBe('withdraw');
  });
});
