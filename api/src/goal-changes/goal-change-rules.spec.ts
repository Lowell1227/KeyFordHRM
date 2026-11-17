import { nextChangeStage, validateChangeGoals, canGrantChanges } from './goal-change-rules';

describe('goal change rules', () => {
  const actors = { employeeId: 'employee', managerId: 'manager', deptHeadId: 'head', approverId: 'vp' };
  const item = { sourceInstanceId: 'source', name: 'Goal', description: null, scoringStandard: null,
    targetValue: 10, targetValueText: null, unit: null, weight: 1, indicatorType: 'kpi' as const,
    dimensionName: null, dimensionWeight: 1, sortOrder: 0 };
  it('follows the original five stage chain including employee confirmation', () => {
    let stage = 'indicator_drafting';
    const chain: string[] = [];
    while (stage !== 'active') { stage = nextChangeStage(actors, stage, 2).status; chain.push(stage); }
    expect(chain).toEqual(['indicator_reviewing', 'indicator_dept_reviewing', 'indicator_confirming', 'indicator_approving', 'active']);
  });
  it('retains the legacy manager then employee chain', () => {
    expect(nextChangeStage(actors, 'indicator_reviewing', 1).status).toBe('indicator_confirming');
    expect(nextChangeStage(actors, 'indicator_confirming', 1).status).toBe('active');
  });
  it('reuses same actor skips without skipping employee confirmation', () => {
    const next = nextChangeStage({ ...actors, deptHeadId: 'manager' }, 'indicator_reviewing', 2);
    expect(next.status).toBe('indicator_confirming');
    expect(next.skipped).toHaveLength(1);
  });
  it('rejects missing reviewers instead of leaving orphan approvals', () => {
    expect(() => nextChangeStage({ ...actors, managerId: null }, 'indicator_drafting', 2)).toThrow();
  });
  it('rejects duplicate identities, invalid numeric values and weights', () => {
    expect(() => validateChangeGoals([item, item], [item])).toThrow();
    expect(() => validateChangeGoals([{ ...item, weight: .5 }], [item])).toThrow();
    expect(() => validateChangeGoals([{ ...item, targetValue: Number.NaN }], [item])).toThrow();
    expect(() => validateChangeGoals([{ ...item, sourceInstanceId: 'other' }], [item])).toThrow();
  });
  it('does not authorize HR actions from admin, viewAll or job titles', () => {
    const viewer: any = { id: 'u', sysRole: 'system_admin', canViewAll: true };
    expect(canGrantChanges(viewer, { hrOwnerId: 'u' })).toBe(false);
    expect(canGrantChanges({ ...viewer, sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit'] }, { hrOwnerId: 'other' })).toBe(false);
    expect(canGrantChanges({ ...viewer, sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit'] }, { hrOwnerId: 'u' })).toBe(true);
    expect(canGrantChanges({ ...viewer, sysRole: 'hr' }, {})).toBe(true);
  });
  it('permits additions and removals without reusing foreign goal identities', () => {
    expect(validateChangeGoals([{ ...item, sourceInstanceId: null, name: 'New goal' }], [item])).toHaveLength(1);
  });
  it('preserves the approved scoring dimensions when adding or changing goals', () => {
    const baseline = { ...item, dimensionName: 'Business', dimensionWeight: .6 };
    expect(() => validateChangeGoals([{ ...baseline, dimensionWeight: 1 }], [baseline])).toThrow();
    expect(() => validateChangeGoals([{ ...item, sourceInstanceId: null }], [baseline])).toThrow();
    expect(validateChangeGoals([{ ...baseline, sourceInstanceId: null }], [baseline])).toHaveLength(1);
  });
});
