import { BusinessCapabilitiesService } from './business-capabilities.service';

function createService() {
  const prisma = {
    user: { count: jest.fn(), groupBy: jest.fn() },
    department: { findMany: jest.fn() },
    assessmentTask: { count: jest.fn(), groupBy: jest.fn() },
    assessmentCycle: { count: jest.fn(), groupBy: jest.fn() },
    performanceInterview: { count: jest.fn() },
    probationReview: { count: jest.fn() },
    confirmationApplication: { count: jest.fn() },
  };
  return {
    service: new BusinessCapabilitiesService(prisma as never),
    prisma,
  };
}

describe('BusinessCapabilitiesService', () => {
  it('由实时组织关系和历史任务归属组合多个业务身份', async () => {
    const { service, prisma } = createService();
    prisma.user.count.mockResolvedValue(2);
    prisma.department.findMany.mockResolvedValue([
      {
        id: 'dept-led',
        name: '销售部',
        parentId: null,
        leaderId: 'user-1',
        leader: { name: '当前用户', directManagerId: 'approver-2', directManager: { name: '上级' } },
        approverId: null,
        approver: null,
      },
      {
        id: 'dept-approved',
        name: '运营部',
        parentId: null,
        leaderId: 'leader-2',
        leader: { name: '其他负责人', directManagerId: 'user-1', directManager: { name: '当前用户' } },
        approverId: null,
        approver: null,
      },
    ]);
    prisma.assessmentTask.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(4);
    prisma.assessmentCycle.count.mockResolvedValue(1);
    prisma.performanceInterview.count.mockResolvedValue(1);
    prisma.probationReview.count.mockResolvedValue(1);
    prisma.confirmationApplication.count.mockResolvedValue(1);

    await expect(service.getForUser({
      id: 'user-1',
      sysRole: 'employee',
      canViewAll: false,
    })).resolves.toEqual({
      canManageTeam: true,
      canReviewDepartment: true,
      canViewPerformanceApproval: true,
      canOperatePerformanceApproval: true,
      canHandleHrCycle: true,
      canHandleInterviews: true,
      canHandleProbationReviews: true,
      canHandleConfirmationApprovals: true,
      canViewReports: true,
      canManageObjectives: true,
      identities: [
        { type: 'performance_manager', label: '绩效直属上级', count: 5 },
        { type: 'department_leader', label: '部门负责人', count: 2 },
        { type: 'performance_approver', label: '最终业务审批人', count: 5 },
        { type: 'cycle_hr_owner', label: '本周期 HR 负责人', count: 1 },
      ],
    });

    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({ managerId: 'user-1' }),
    });
    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({ deptHeadId: 'user-1' }),
    });
    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(3, {
      where: expect.objectContaining({ approverId: 'user-1' }),
    });
  });

  it('canViewAll 只产生审批查看能力，不产生审批操作身份', async () => {
    const { service, prisma } = createService();
    prisma.user.count.mockResolvedValue(0);
    prisma.department.findMany.mockResolvedValue([]);
    prisma.assessmentTask.count.mockResolvedValue(0);
    prisma.assessmentCycle.count.mockResolvedValue(0);
    prisma.performanceInterview.count.mockResolvedValue(0);
    prisma.probationReview.count.mockResolvedValue(0);
    prisma.confirmationApplication.count.mockResolvedValue(0);

    await expect(service.getForUser({
      id: 'viewer-1',
      sysRole: 'chairman',
      canViewAll: true,
    })).resolves.toEqual({
      canManageTeam: false,
      canReviewDepartment: false,
      canViewPerformanceApproval: true,
      canOperatePerformanceApproval: false,
      canHandleHrCycle: false,
      canHandleInterviews: true,
      canHandleProbationReviews: false,
      canHandleConfirmationApprovals: false,
      canViewReports: true,
      canManageObjectives: false,
      identities: [],
    });
  });

  it('旧系统管理员也只有审批查看能力，不自动成为业务审批人', async () => {
    const { service, prisma } = createService();
    prisma.user.count.mockResolvedValue(0);
    prisma.department.findMany.mockResolvedValue([]);
    prisma.assessmentTask.count.mockResolvedValue(0);
    prisma.assessmentCycle.count.mockResolvedValue(0);
    prisma.performanceInterview.count.mockResolvedValue(0);
    prisma.probationReview.count.mockResolvedValue(0);
    prisma.confirmationApplication.count.mockResolvedValue(0);

    const capabilities = await service.getForUser({
      id: 'admin-1',
      sysRole: 'system_admin',
      canViewAll: false,
    });

    expect(capabilities.canViewPerformanceApproval).toBe(true);
    expect(capabilities.canOperatePerformanceApproval).toBe(false);
    expect(capabilities.canViewReports).toBe(true);
    expect(capabilities.canManageObjectives).toBe(true);
    expect(capabilities.identities).toEqual([]);
  });

  it('批量投影员工业务身份且不会逐人计算', async () => {
    const { service, prisma } = createService();
    prisma.user.groupBy.mockResolvedValue([
      { directManagerId: 'user-1', _count: { _all: 2 } },
    ]);
    prisma.department.findMany.mockResolvedValue([
      { id: 'dept-1', name: '销售部', parentId: null, leaderId: 'user-1', approverId: null },
      { id: 'dept-2', name: '运营部', parentId: null, leaderId: 'other', approverId: 'user-2' },
    ]);
    prisma.assessmentTask.groupBy
      .mockResolvedValueOnce([{ managerId: 'user-1', _count: { _all: 1 } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ approverId: 'user-2', _count: { _all: 3 } }]);
    prisma.assessmentCycle.groupBy.mockResolvedValue([]);

    const result = await (service as any).getIdentitySummariesForUsers(['user-1', 'user-2']);

    expect(result.get('user-1')).toEqual([
      { type: 'performance_manager', label: '绩效直属上级', count: 3 },
      { type: 'department_leader', label: '部门负责人', count: 1 },
    ]);
    expect(result.get('user-2')).toEqual([
      { type: 'performance_approver', label: '最终业务审批人', count: 4 },
    ]);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});
