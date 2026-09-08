import {
  buildPerformanceApproverMap,
  PerformanceApprovalDepartment,
} from './performance-approval-relations';

describe('buildPerformanceApproverMap', () => {
  const department = (
    overrides: Partial<PerformanceApprovalDepartment> & Pick<PerformanceApprovalDepartment, 'id'>,
  ): PerformanceApprovalDepartment => ({
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    parentId: overrides.parentId ?? null,
    leaderId: overrides.leaderId ?? null,
    leaderName: overrides.leaderName ?? null,
    leaderDirectManagerId: overrides.leaderDirectManagerId ?? null,
    leaderDirectManagerName: overrides.leaderDirectManagerName ?? null,
    approverId: overrides.approverId ?? null,
    approverName: overrides.approverName ?? null,
  });

  it('uses the employee department explicit approver before any ancestor relationship', () => {
    const result = buildPerformanceApproverMap([
      department({
        id: 'child',
        parentId: 'parent',
        approverId: 'child-approver',
        approverName: '本部门审批人',
      }),
      department({
        id: 'parent',
        leaderId: 'parent-leader',
        approverId: 'parent-approver',
        approverName: '父部门审批人',
      }),
    ]).get('child');

    expect(result).toEqual({
      approverId: 'child-approver',
      approverName: '本部门审批人',
      source: 'department_explicit',
      sourceDeptId: 'child',
      sourceDeptName: 'child',
    });
  });

  it('inherits the nearest ancestor explicit approver instead of the parent leader', () => {
    const result = buildPerformanceApproverMap([
      department({ id: 'team', parentId: 'division' }),
      department({
        id: 'division',
        parentId: 'company',
        leaderId: 'division-leader',
        approverId: 'division-approver',
        approverName: '事业部审批人',
      }),
      department({
        id: 'company',
        approverId: 'company-approver',
        approverName: '公司审批人',
      }),
    ]).get('team');

    expect(result).toEqual({
      approverId: 'division-approver',
      approverName: '事业部审批人',
      source: 'ancestor_explicit',
      sourceDeptId: 'division',
      sourceDeptName: 'division',
    });
  });

  it('falls back to the top reachable department leader direct manager when no explicit approver exists', () => {
    const result = buildPerformanceApproverMap([
      department({ id: 'team', parentId: 'division', leaderId: 'team-leader' }),
      department({ id: 'division', parentId: 'company', leaderId: 'division-leader' }),
      department({
        id: 'company',
        leaderId: 'company-leader',
        leaderName: '公司负责人',
        leaderDirectManagerId: 'company-leader-manager',
        leaderDirectManagerName: '公司负责人直属上级',
      }),
    ]).get('team');

    expect(result).toEqual({
      approverId: 'company-leader-manager',
      approverName: '公司负责人直属上级',
      source: 'top_department_leader_manager',
      sourceDeptId: 'company',
      sourceDeptName: 'company',
    });
  });

  it('does not substitute an ancestor department leader for a missing approver', () => {
    const result = buildPerformanceApproverMap([
      department({ id: 'team', parentId: 'company' }),
      department({ id: 'company', leaderId: 'company-leader', leaderName: '公司负责人' }),
    ]).get('team');

    expect(result).toEqual({
      approverId: null,
      approverName: null,
      source: 'unresolved',
      sourceDeptId: null,
      sourceDeptName: null,
    });
  });

  it('returns unresolved for a department loop without an explicit approver', () => {
    const result = buildPerformanceApproverMap([
      department({ id: 'one', parentId: 'two' }),
      department({ id: 'two', parentId: 'one' }),
    ]);

    expect(result.get('one')?.source).toBe('unresolved');
    expect(result.get('two')?.source).toBe('unresolved');
  });

  it('returns unresolved when a referenced parent record is missing, even if the child leader has a manager', () => {
    const result = buildPerformanceApproverMap([
      department({
        id: 'orphan',
        parentId: 'missing-parent',
        leaderId: 'orphan-leader',
        leaderDirectManagerId: 'orphan-leader-manager',
        leaderDirectManagerName: '孤立部门负责人直属上级',
      }),
    ]).get('orphan');

    expect(result).toEqual({
      approverId: null,
      approverName: null,
      source: 'unresolved',
      sourceDeptId: null,
      sourceDeptName: null,
    });
  });
});
