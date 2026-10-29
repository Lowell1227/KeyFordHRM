import {
  nextGoalStep,
  hasApprovedGoalBaseline,
  getGoalReviewActorId,
} from './goal-workflow';
const task = {
  employeeId: 'e',
  managerId: 'm',
  deptHeadId: 'd',
  approverId: 'l',
  status: 'indicator_reviewing' as const,
};
describe('five step goal workflow', () => {
  it('routes manager to department', () =>
    expect(nextGoalStep(task, 'indicator_reviewing').status).toBe(
      'indicator_dept_reviewing',
    ));
  it('merges adjacent reviewers with audit', () => {
    const next = nextGoalStep(
      { ...task, deptHeadId: 'm' },
      'indicator_reviewing',
    );
    expect(next.status).toBe('indicator_confirming');
    expect(next.skipped).toEqual([
      { status: 'indicator_dept_reviewing', reason: 'consecutive_same_actor' },
    ]);
  });
  it('does not merge across employee confirmation', () =>
    expect(
      nextGoalStep({ ...task, approverId: 'd' }, 'indicator_confirming').status,
    ).toBe('indicator_approving'));
  it('skips self review', () =>
    expect(
      nextGoalStep(
        { ...task, managerId: 'e', deptHeadId: 'e' },
        'indicator_drafting',
      ).status,
    ).toBe('indicator_confirming'));
  it('requires final approval for v2 baseline', () =>
    expect(
      hasApprovedGoalBaseline({
        indicatorConfirmedAt: new Date(),
        cycle: { goalWorkflowVersion: 2 },
      }),
    ).toBe(false));
  it('keeps legacy baseline', () =>
    expect(hasApprovedGoalBaseline({ indicatorConfirmedAt: new Date() })).toBe(
      true,
    ));
  it('uses assigned department actor', () =>
    expect(
      getGoalReviewActorId({ ...task, status: 'indicator_dept_reviewing' }),
    ).toBe('d'));
});
