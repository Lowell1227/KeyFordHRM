import { buildEffectiveApproverMap, DepartmentRelationRecord } from './department-relations';

describe('buildEffectiveApproverMap', () => {
  it('一级部门使用部门负责人的直属主管作为最终业务审批人', () => {
    const departments = [
      {
        id: 'root-dept',
        name: '人事行政部',
        parentId: null,
        leaderId: 'hr-leader',
        leaderName: '姚瑶',
        leaderDirectManagerId: 'general-manager',
        leaderDirectManagerName: '郭志浩',
        approverId: null,
        approverName: null,
      },
    ] as unknown as DepartmentRelationRecord[];

    const result = buildEffectiveApproverMap(departments).get('root-dept');

    expect(result).toEqual({
      effectiveApproverId: 'general-manager',
      effectiveApproverName: '郭志浩',
      effectiveApproverSource: 'leader_manager',
      sourceDeptId: 'root-dept',
      sourceDeptName: '人事行政部',
    });
  });

  it('手动设置的最终业务审批人优先于自动匹配', () => {
    const departments = [
      {
        id: 'root-dept',
        name: '人事行政部',
        parentId: null,
        leaderId: 'hr-leader',
        leaderName: '姚瑶',
        leaderDirectManagerId: 'general-manager',
        leaderDirectManagerName: '郭志浩',
        approverId: 'manual-approver',
        approverName: '李宏',
      },
    ] as unknown as DepartmentRelationRecord[];

    const result = buildEffectiveApproverMap(departments).get('root-dept');

    expect(result).toMatchObject({
      effectiveApproverId: 'manual-approver',
      effectiveApproverName: '李宏',
      effectiveApproverSource: 'manual_override',
    });
  });
});
