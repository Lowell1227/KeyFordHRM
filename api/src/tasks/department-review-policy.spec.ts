import { isSelfDepartmentReviewSkipped, shouldSkipDepartmentReview } from './department-review-policy';

describe('department review skip policy', () => {
  const task = { employeeId: 'emp-1', managerId: 'mgr-1' as string | null, deptHeadId: 'head-1' as string | null };

  it('skips the department review when the manager is the frozen department head (combined handling)', () => {
    expect(shouldSkipDepartmentReview({ ...task, deptHeadId: 'mgr-1' })).toBe(true);
    expect(isSelfDepartmentReviewSkipped({ ...task, deptHeadId: 'mgr-1' })).toBe(false);
  });

  it('skips the department review when the employee is the frozen department head', () => {
    expect(shouldSkipDepartmentReview({ ...task, deptHeadId: 'emp-1' })).toBe(true);
    expect(isSelfDepartmentReviewSkipped({ ...task, deptHeadId: 'emp-1' })).toBe(true);
  });

  it('does not treat the combined case as a self skip', () => {
    const combined = { employeeId: 'emp-1', managerId: 'emp-1', deptHeadId: 'emp-1' };
    expect(shouldSkipDepartmentReview(combined)).toBe(true);
    expect(isSelfDepartmentReviewSkipped(combined)).toBe(false);
  });

  it.each([
    { deptHeadId: 'head-1' },
    { deptHeadId: null },
    { managerId: null, deptHeadId: 'head-1' },
  ])('keeps a separate department reviewer: %o', (relations) => {
    expect(shouldSkipDepartmentReview({ ...task, ...relations })).toBe(false);
    expect(isSelfDepartmentReviewSkipped({ ...task, ...relations })).toBe(false);
  });
});
