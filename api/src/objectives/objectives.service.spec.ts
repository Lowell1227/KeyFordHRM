import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ObjectiveLevel, ObjectiveStatus, Prisma, SysRole } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { DataScopeService } from '@/common/services/data-scope.service';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { ObjectivesService } from './objectives.service';

describe('ObjectivesService visibility helpers', () => {
  let service: ObjectivesService;
  let prisma: {
    objective: { count: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    actionItem: { findMany: jest.Mock };
    user: { findMany: jest.Mock; findUnique: jest.Mock };
    assessmentTask: { findUnique: jest.Mock };
    indicatorInstance: { findUnique: jest.Mock; findFirst: jest.Mock };
    indicatorProgressUpdate: { findFirst: jest.Mock; create: jest.Mock };
    auditLog: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let dataScope: { getVisibleEmployeeFilter: jest.Mock };

  const viewer: AuthUser = {
    id: 'manager-1',
    name: 'Manager',
    sysRole: SysRole.manager,
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
  };

  const visibleObjective = {
    id: 'objective-visible',
    title: 'Visible objective',
    description: null,
    level: ObjectiveLevel.individual,
    deptId: 'dept-1',
    ownerId: 'employee-1',
    parentId: null,
    cycleId: 'cycle-1',
    weight: new Prisma.Decimal(50),
    priority: 0,
    progress: 25,
    status: ObjectiveStatus.active,
    relatedIndicatorId: null,
    createdBy: 'manager-1',
    createdAt: new Date('2026-08-08T08:00:00.000Z'),
    updatedAt: new Date('2026-08-08T08:00:00.000Z'),
    dept: { id: 'dept-1', name: 'Engineering' },
    owner: { id: 'employee-1', name: 'Employee' },
    cycle: { id: 'cycle-1', name: '2026 H2' },
    relatedIndicator: null,
    creator: { id: 'manager-1', name: 'Manager' },
  };

  beforeEach(() => {
    prisma = {
      objective: { count: jest.fn(), findMany: jest.fn(), create: jest.fn() },
      actionItem: { findMany: jest.fn() },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'manager-1' }, { id: 'employee-1' }]),
        findUnique: jest.fn().mockResolvedValue({ directManagerId: null }),
      },
      assessmentTask: { findUnique: jest.fn() },
      indicatorInstance: { findUnique: jest.fn(), findFirst: jest.fn() },
      indicatorProgressUpdate: { findFirst: jest.fn(), create: jest.fn() },
      auditLog: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    dataScope = {
      getVisibleEmployeeFilter: jest.fn().mockResolvedValue({
        OR: [{ directManagerId: 'manager-1' }, { id: 'manager-1' }],
      }),
    };
    service = new ObjectivesService(
      prisma as unknown as PrismaService,
      dataScope as unknown as DataScopeService,
    );
  });

  it('uses the same visibility predicate for submitted-id validation and read filtering', async () => {
    prisma.objective.count.mockResolvedValue(1);
    prisma.objective.findMany.mockResolvedValue([visibleObjective]);

    await service.assertVisibleIds(['objective-visible'], viewer);
    await service.findVisibleByIds(['objective-visible'], viewer);

    const assertionWhere = prisma.objective.count.mock.calls[0][0].where.AND[0];
    const readWhere = prisma.objective.findMany.mock.calls[0][0].where.AND[0];
    expect(assertionWhere).toEqual(readWhere);
    expect(assertionWhere).toEqual({
      OR: [
        { level: ObjectiveLevel.company },
        { ownerId: { in: ['manager-1', 'employee-1'] } },
        { deptId: 'dept-1' },
      ],
    });
  });

  it('returns indistinguishable forbidden responses for missing and invisible objective ids', async () => {
    prisma.objective.count.mockResolvedValue(0);

    const capture = async (id: string) => {
      try {
        await service.assertVisibleIds([id], viewer);
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        return (error as ForbiddenException).getResponse();
      }
      throw new Error('expected assertVisibleIds to reject');
    };

    const missingResponse = await capture('objective-missing');
    const invisibleResponse = await capture('objective-invisible');

    expect(missingResponse).toEqual(invisibleResponse);
    expect(missingResponse).toMatchObject({ code: ERROR_CODE.FORBIDDEN });
  });

  it('quietly omits missing or invisible objectives from read filtering', async () => {
    prisma.objective.findMany.mockResolvedValue([visibleObjective]);

    const result = await service.findVisibleByIds(
      ['objective-visible', 'objective-protected'],
      viewer,
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: 'objective-visible',
        title: 'Visible objective',
        ownerId: 'employee-1',
      }),
    ]);
    expect(prisma.objective.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({ OR: expect.any(Array) }),
            { id: { in: ['objective-visible', 'objective-protected'] } },
          ],
        },
      }),
    );
  });

  it('returns the employee-cycle assessment indicators with effective weights', async () => {
    prisma.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      employeeId: 'manager-1',
      cycleId: 'cycle-1',
      status: 'self_eval',
      selfEvalSubmittedAt: null,
      employee: { id: 'manager-1', name: 'Manager' },
      cycle: { id: 'cycle-1', name: '2026-Q3' },
      indicatorInstances: [
        {
          id: 'indicator-revenue',
          taskId: 'task-1',
          name: 'GMV 达成率',
          description: '按季度预算跟进 GMV 达成',
          scoringStandard: '达到预算目标得满分',
          dataSource: '经营报表',
          dataCaliber: '财务确认口径',
          targetValue: null,
          targetValueText: '完成季度预算的 100%',
          unit: '%',
          weight: new Prisma.Decimal('0.16'),
          indicatorType: 'kpi',
          dimensionName: '工作目标',
          dimensionWeight: new Prisma.Decimal('0.80'),
          visibilityScope: 'supervisors',
          actualValue: null,
          actualNote: null,
          sortOrder: 0,
          updatedAt: new Date('2026-08-08T08:00:00.000Z'),
          objectiveAlignments: [],
          progressUpdates: [
            {
              id: 'progress-1',
              progress: 45,
              healthStatus: 'on_track',
              content: '首轮方案已经完成评审',
              attachments: [],
              createdAt: new Date('2026-08-15T08:00:00.000Z'),
              creator: { id: 'manager-1', name: 'Manager' },
            },
          ],
        },
        {
          id: 'indicator-attitude',
          taskId: 'task-1',
          name: '工作态度与协作',
          description: null,
          scoringStandard: null,
          dataSource: null,
          dataCaliber: null,
          targetValue: new Prisma.Decimal('100'),
          targetValueText: null,
          unit: '分',
          weight: new Prisma.Decimal('0.20'),
          indicatorType: 'attitude',
          dimensionName: '工作态度',
          dimensionWeight: new Prisma.Decimal('0.20'),
          visibilityScope: 'supervisors',
          actualValue: null,
          actualNote: null,
          sortOrder: 1,
          updatedAt: new Date('2026-08-08T08:00:00.000Z'),
          objectiveAlignments: [],
          progressUpdates: [],
        },
      ],
    });

    const result = await service.findTracking(
      { ownerId: 'manager-1', cycleId: 'cycle-1' },
      viewer,
    );

    expect(prisma.assessmentTask.findUnique).toHaveBeenCalledWith({
      where: {
        cycleId_employeeId: {
          cycleId: 'cycle-1',
          employeeId: 'manager-1',
        },
      },
      include: expect.objectContaining({
        indicatorInstances: expect.objectContaining({
          orderBy: { sortOrder: 'asc' },
        }),
      }),
    });
    expect(result).toEqual({
      taskId: 'task-1',
      taskStatus: 'self_eval',
      canEdit: true,
      totalWeight: 36,
      items: [
        expect.objectContaining({
        id: 'indicator-revenue',
        title: 'GMV 达成率',
        weight: 16,
        progress: 45,
        latestProgress: {
          id: 'progress-1',
          content: '首轮方案已经完成评审',
          progress: 45,
          healthStatus: 'on_track',
          createdBy: 'manager-1',
          creatorName: 'Manager',
          attachments: [],
          updatedAt: new Date('2026-08-15T08:00:00.000Z'),
        },
      }),
        expect.objectContaining({
          id: 'indicator-attitude',
          title: '工作态度与协作',
          weight: 20,
          progress: 0,
          latestProgress: null,
        }),
      ],
    });
  });

  it('lets a standard user create an individual objective for their direct report', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'manager-1' });
    prisma.objective.create.mockResolvedValue(visibleObjective);

    await expect(service.create({
      title: 'Visible objective',
      level: ObjectiveLevel.individual,
      ownerId: 'employee-1',
      deptId: 'dept-1',
      cycleId: 'cycle-1',
    } as any, { ...viewer, sysRole: SysRole.employee })).resolves.toEqual(
      expect.objectContaining({ id: 'objective-visible' }),
    );
  });

  it('shows only explicitly shareable direct-manager indicators and keeps them read-only', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'director-1' });
    prisma.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-manager',
      employeeId: 'director-1',
      cycleId: 'cycle-1',
      status: 'self_eval',
      selfEvalSubmittedAt: null,
      employee: { id: 'director-1', name: 'Director' },
      cycle: { id: 'cycle-1', name: '2026-Q3' },
      indicatorInstances: [],
    });

    const result = await service.findTracking(
      { ownerId: 'director-1', cycleId: 'cycle-1' },
      viewer,
    );

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: viewer.id },
      select: { directManagerId: true },
    });
    expect(prisma.assessmentTask.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        indicatorInstances: expect.objectContaining({
          where: {
            OR: expect.arrayContaining([
              { visibilityScope: 'company' },
              { visibilityScope: 'direct_reports' },
              { visibilityScope: 'all_reports' },
              { visibleUsers: { some: { userId: viewer.id } } },
            ]),
          },
        }),
      }),
    }));
    expect(result.canEdit).toBe(false);
  });

  it('rejects an arbitrary tracking owner before loading their task', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'director-1' });

    await expect(service.findTracking(
      { ownerId: 'unrelated-user', cycleId: 'cycle-1' },
      viewer,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.assessmentTask.findUnique).not.toHaveBeenCalled();
  });

  it('appends an employee progress update and its audit record without overwriting history', async () => {
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1',
      name: 'GMV 达成率',
      task: {
        id: 'task-1',
        employeeId: viewer.id,
        status: 'self_eval',
        selfEvalSubmittedAt: null,
      },
    });
    prisma.indicatorProgressUpdate.findFirst.mockResolvedValue(null);
    prisma.indicatorProgressUpdate.create.mockResolvedValue({
      id: 'progress-1',
      indicatorInstanceId: 'indicator-1',
      progress: 45,
      healthStatus: 'on_track',
      content: '首轮方案已经完成评审',
      attachments: [{ name: 'review.pdf', url: '/files/review.pdf', size: 1024 }],
      createdBy: viewer.id,
      createdAt: new Date('2026-08-16T08:00:00.000Z'),
      creator: { id: viewer.id, name: viewer.name },
    });

    const result = await (service as any).updateIndicatorProgress(
      'indicator-1',
      {
        progress: 45,
        healthStatus: 'on_track',
        content: '首轮方案已经完成评审',
        attachments: [{ name: 'review.pdf', url: '/files/review.pdf', size: 1024 }],
        expectedLatestUpdateAt: null,
      },
      viewer,
    );

    expect(prisma.indicatorProgressUpdate.create).toHaveBeenCalledWith({
      data: {
        indicatorInstanceId: 'indicator-1',
        progress: 45,
        healthStatus: 'on_track',
        content: '首轮方案已经完成评审',
        attachments: [{ name: 'review.pdf', url: '/files/review.pdf', size: 1024 }],
        createdBy: viewer.id,
      },
      include: { creator: { select: { id: true, name: true } } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: viewer.id,
        action: 'progress_update',
        entityType: 'indicator_instance',
        entityId: 'indicator-1',
        oldValue: Prisma.JsonNull,
        newValue: expect.objectContaining({ progress: 45, healthStatus: 'on_track' }),
      }),
    });
    expect(result).toEqual(expect.objectContaining({
      id: 'progress-1',
      progress: 45,
      creatorName: viewer.name,
    }));
  });

  it('does not let a viewer update another employee indicator', async () => {
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-manager',
      name: '管理目标',
      task: {
        id: 'task-manager',
        employeeId: 'director-1',
        status: 'self_eval',
        selfEvalSubmittedAt: null,
      },
    });

    await expect((service as any).updateIndicatorProgress(
      'indicator-manager',
      { progress: 30, healthStatus: 'on_track', content: '尝试代改', attachments: [] },
      viewer,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'closed', selfEvalSubmittedAt: null },
    { status: 'self_eval', selfEvalSubmittedAt: new Date('2026-08-16T07:00:00.000Z') },
  ])('does not append progress after the task is locked: %o', async (taskState) => {
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1',
      name: 'GMV 达成率',
      task: { id: 'task-1', employeeId: viewer.id, ...taskState },
    });

    await expect((service as any).updateIndicatorProgress(
      'indicator-1',
      { progress: 80, healthStatus: 'on_track', content: '迟到更新', attachments: [] },
      viewer,
    )).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it('rejects a stale editor instead of overwriting a newer progress update', async () => {
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1',
      name: 'GMV 达成率',
      task: {
        id: 'task-1',
        employeeId: viewer.id,
        status: 'self_eval',
        selfEvalSubmittedAt: null,
      },
    });
    prisma.indicatorProgressUpdate.findFirst.mockResolvedValue({
      id: 'progress-newer',
      progress: 55,
      healthStatus: 'at_risk',
      createdAt: new Date('2026-08-16T09:00:00.000Z'),
    });

    await expect((service as any).updateIndicatorProgress(
      'indicator-1',
      {
        progress: 60,
        healthStatus: 'on_track',
        content: '旧编辑器提交',
        attachments: [],
        expectedLatestUpdateAt: '2026-08-16T08:00:00.000Z',
      },
      viewer,
    )).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it('returns real indicator details, immutable progress history, and audited changes', async () => {
    prisma.indicatorInstance.findFirst.mockResolvedValue({
      id: 'indicator-1',
      taskId: 'task-1',
      name: 'GMV 达成率',
      description: '跟进季度 GMV',
      scoringStandard: '达到预算目标得满分',
      dataSource: '经营报表',
      dataCaliber: '财务确认口径',
      targetValue: null,
      targetValueText: '完成季度预算的 100%',
      unit: '%',
      weight: new Prisma.Decimal('0.16'),
      indicatorType: 'kpi',
      dimensionName: '工作目标',
      dimensionWeight: new Prisma.Decimal('0.80'),
      visibilityScope: 'supervisors',
      actualValue: new Prisma.Decimal('96'),
      actualNote: '截至季度末完成预算的 96%',
      sortOrder: 0,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T08:00:00.000Z'),
      task: {
        id: 'task-1',
        employeeId: viewer.id,
        status: 'self_eval',
        selfEvalSubmittedAt: null,
        employee: { id: viewer.id, name: viewer.name },
        cycle: { id: 'cycle-1', name: '2026-Q3' },
      },
      objectiveAlignments: [
        { objective: { id: 'objective-1', title: '提升经营质量', level: 'company', ownerId: 'vp-1' } },
      ],
      progressUpdates: [
        {
          id: 'progress-2',
          progress: 60,
          healthStatus: 'at_risk',
          content: '渠道转化低于预期，已调整投放',
          attachments: [],
          createdAt: new Date('2026-08-16T08:00:00.000Z'),
          creator: { id: viewer.id, name: viewer.name },
        },
        {
          id: 'progress-1',
          progress: 40,
          healthStatus: 'on_track',
          content: '完成首轮投放',
          attachments: [],
          createdAt: new Date('2026-08-01T08:00:00.000Z'),
          creator: { id: viewer.id, name: viewer.name },
        },
      ],
    });
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'indicator_updated',
        oldValue: { targetValueText: '完成季度预算的 95%' },
        newValue: { targetValueText: '完成季度预算的 100%' },
        createdAt: new Date('2026-07-15T08:00:00.000Z'),
        user: { id: 'manager-1', name: 'Manager' },
      },
    ]);

    const result = await (service as any).findTrackingIndicator('indicator-1', viewer);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        entityType: 'indicator_instance',
        entityId: 'indicator-1',
        action: {
          in: ['indicator_baseline_confirmed', 'indicator_updated'],
        },
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      id: 'indicator-1',
      title: 'GMV 达成率',
      targetValueText: '完成季度预算的 100%',
      actualValue: 96,
      actualNote: '截至季度末完成预算的 96%',
      weight: 16,
      canEdit: true,
      alignedObjectives: [
        { id: 'objective-1', title: '提升经营质量', level: 'company', ownerId: 'vp-1' },
      ],
      progressUpdates: [
        expect.objectContaining({ id: 'progress-2', progress: 60, creatorName: viewer.name }),
        expect.objectContaining({ id: 'progress-1', progress: 40, creatorName: viewer.name }),
      ],
      changeRecords: [
        expect.objectContaining({ id: 'audit-1', action: 'indicator_updated', actorName: 'Manager' }),
      ],
    }));
  });

  it('opens a shareable direct-manager indicator as read-only without exposing edit authority', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'director-1' });
    prisma.indicatorInstance.findFirst.mockResolvedValue({
      id: 'indicator-manager',
      taskId: 'task-manager',
      name: '团队交付质量',
      description: null,
      scoringStandard: null,
      dataSource: null,
      dataCaliber: null,
      targetValue: null,
      targetValueText: '重大项目按期交付',
      unit: null,
      weight: new Prisma.Decimal('1'),
      indicatorType: 'kpi',
      dimensionName: '工作目标',
      dimensionWeight: new Prisma.Decimal('1'),
      visibilityScope: 'direct_reports',
      actualValue: null,
      actualNote: null,
      sortOrder: 0,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T08:00:00.000Z'),
      task: {
        id: 'task-manager',
        employeeId: 'director-1',
        status: 'self_eval',
        selfEvalSubmittedAt: null,
        employee: { id: 'director-1', name: 'Director' },
        cycle: { id: 'cycle-1', name: '2026-Q3' },
      },
      objectiveAlignments: [],
      progressUpdates: [],
    });
    prisma.auditLog.findMany.mockResolvedValue([]);

    const result = await (service as any).findTrackingIndicator('indicator-manager', viewer);

    expect(prisma.indicatorInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { id: 'indicator-manager' },
          {
            OR: expect.arrayContaining([
              { task: { employeeId: viewer.id } },
              {
                AND: [
                  { task: { employeeId: 'director-1' } },
                  { visibilityScope: 'direct_reports' },
                ],
              },
            ]),
          },
        ],
      },
    }));
    expect(result.canEdit).toBe(false);
  });

  it('resolves a deep link through the same visibility predicate', async () => {
    prisma.objective.findMany.mockResolvedValue([]);

    await service.findTracking({ objectiveId: 'objective-visible' }, viewer);

    expect(prisma.objective.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          expect.objectContaining({ OR: expect.any(Array) }),
          { id: 'objective-visible' },
        ],
      },
    }));
  });

  it('rejects tracking requests without a deep link or owner-cycle pair', async () => {
    await expect(service.findTracking({ ownerId: 'employee-1' }, viewer))
      .rejects.toMatchObject({ response: expect.objectContaining({ message: '请选择人员和考核周期' }) });
  });
});
