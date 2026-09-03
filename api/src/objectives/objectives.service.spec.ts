import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ObjectiveLevel, ObjectiveStatus, Prisma, SysRole } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { DataScopeService } from '@/common/services/data-scope.service';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { ObjectivesService } from './objectives.service';

describe('ObjectivesService visibility helpers', () => {
  let service: ObjectivesService;
  let prisma: {
    objective: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    actionItem: { findMany: jest.Mock };
    assessmentCycle: { findUnique: jest.Mock };
    user: { findMany: jest.Mock; findUnique: jest.Mock };
    assessmentTask: { findUnique: jest.Mock; findMany: jest.Mock };
    indicatorInstance: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    indicatorProgressUpdate: { findMany: jest.Mock; create: jest.Mock };
    auditLog: { create: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let dataScope: { getVisibleEmployeeFilter: jest.Mock; getAncestorDeptIds: jest.Mock };

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
    reviewStatus: 'pending',
    reviewedById: null,
    reviewedAt: null,
    reviewComment: null,
    relatedIndicatorId: null,
    createdBy: 'manager-1',
    createdAt: new Date('2026-08-08T08:00:00.000Z'),
    updatedAt: new Date('2026-08-08T08:00:00.000Z'),
    dept: { id: 'dept-1', name: 'Engineering' },
    owner: {
      id: 'employee-1',
      name: 'Employee',
      directManagerId: 'manager-1',
      directManager: { id: 'manager-1', name: 'Manager' },
    },
    cycle: { id: 'cycle-1', name: '2026 H2' },
    relatedIndicator: null,
    creator: { id: 'manager-1', name: 'Manager' },
    reviewedBy: null,
  };

  beforeEach(() => {
    prisma = {
      objective: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      actionItem: { findMany: jest.fn() },
      assessmentCycle: { findUnique: jest.fn() },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'manager-1' }, { id: 'employee-1' }]),
        findUnique: jest.fn().mockResolvedValue({ directManagerId: null }),
      },
      assessmentTask: { findUnique: jest.fn(), findMany: jest.fn() },
      indicatorInstance: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      indicatorProgressUpdate: { findMany: jest.fn(), create: jest.fn() },
      auditLog: { create: jest.fn(), findMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    dataScope = {
      getVisibleEmployeeFilter: jest.fn().mockResolvedValue({
        OR: [{ directManagerId: 'manager-1' }, { id: 'manager-1' }],
      }),
      getAncestorDeptIds: jest.fn().mockResolvedValue(['dept-1', 'dept-parent']),
    };
    service = new ObjectivesService(
      prisma as unknown as PrismaService,
      dataScope as unknown as DataScopeService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
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
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T08:00:00.000Z'));
    prisma.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      employeeId: 'manager-1',
      cycleId: 'cycle-1',
      status: 'manager_scoring',
      isExempt: false,
      participantDisposition: 'active',
      indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
      closedAt: null,
      selfEvalSubmittedAt: new Date('2026-08-18T08:00:00.000Z'),
      publishedAt: null,
      employee: { id: 'manager-1', name: 'Manager' },
      cycle: {
        id: 'cycle-1',
        name: '2026-Q3',
        monthlyFollowUpRequired: true,
        workflowVersion: 2,
        openedAt: new Date('2026-07-01T00:00:00.000Z'),
        publishedAt: null,
        closedAt: null,
      },
      periods: [
        {
          id: 'period-july', periodKey: '2026-07', periodStart: new Date('2026-07-01T00:00:00.000Z'), periodEnd: new Date('2026-07-31T00:00:00.000Z'),
          status: 'completed', employeeSubmittedAt: new Date('2026-08-01T08:00:00.000Z'), managerSubmittedAt: new Date('2026-08-03T08:00:00.000Z'),
          selfScoreTotal: new Prisma.Decimal('82'),
          indicatorReviews: [
            { selfScore: new Prisma.Decimal('80'), indicatorVersionItem: { sourceInstanceId: 'indicator-revenue' } },
            { selfScore: new Prisma.Decimal('84'), indicatorVersionItem: { sourceInstanceId: 'indicator-attitude' } },
          ],
        },
        {
          id: 'period-august', periodKey: '2026-08', periodStart: new Date('2026-08-01T00:00:00.000Z'), periodEnd: new Date('2026-08-31T00:00:00.000Z'),
          status: 'completed', employeeSubmittedAt: new Date('2026-09-01T08:00:00.000Z'), managerSubmittedAt: null,
          selfScoreTotal: new Prisma.Decimal('91'),
          indicatorReviews: [
            { selfScore: new Prisma.Decimal('90'), indicatorVersionItem: { sourceInstanceId: 'indicator-revenue' } },
            { selfScore: new Prisma.Decimal('92'), indicatorVersionItem: { sourceInstanceId: 'indicator-attitude' } },
          ],
        },
        {
          id: 'period-september', periodKey: '2026-09', periodStart: new Date('2026-09-01T00:00:00.000Z'), periodEnd: new Date('2026-09-30T00:00:00.000Z'),
          status: 'self_eval', employeeSubmittedAt: null, managerSubmittedAt: null, selfScoreTotal: null, indicatorReviews: [],
        },
      ],
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
              id: 'progress-july-formal',
              progress: 99,
              healthStatus: 'completed',
              content: '七月月度自评结果',
              attachments: [],
              createdAt: new Date('2026-09-03T02:00:00.000Z'),
              periodReviewRevisionId: 'revision-july',
              period: { periodKey: '2026-07' },
              creator: { id: 'manager-1', name: 'Manager' },
            },
            {
              id: 'progress-1',
              progress: 45,
              healthStatus: 'on_track',
              content: '首轮方案已经完成评审',
              attachments: [],
              createdAt: new Date('2026-08-15T08:00:00.000Z'),
              periodReviewRevisionId: null,
              period: null,
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
      taskStatus: 'manager_scoring',
      canEdit: true,
      monthlyFollowUpRequired: true,
      summary: {
        periodCount: 3,
        employeeSubmittedCount: 2,
        managerCompletedCount: 1,
        activeBusinessPeriodKey: '2026-09',
        activeUpdatedGoalCount: 0,
        goalCount: 2,
        latestSelfEvaluation: {
          periodKey: '2026-08',
          selfScoreTotal: 91,
          submittedAt: new Date('2026-09-01T08:00:00.000Z'),
        },
      },
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
          businessPeriodKey: '2026-08',
          source: 'active_progress',
        },
        latestSelfEvaluation: {
          periodKey: '2026-08',
          selfScore: 90,
          submittedAt: new Date('2026-09-01T08:00:00.000Z'),
        },
      }),
        expect.objectContaining({
          id: 'indicator-attitude',
          title: '工作态度与协作',
          weight: 20,
          progress: 0,
          latestProgress: null,
          latestSelfEvaluation: {
            periodKey: '2026-08',
            selfScore: 92,
            submittedAt: new Date('2026-09-01T08:00:00.000Z'),
          },
        }),
      ],
    });
  });

  it('keeps the current month visible but closes active progress after its monthly self evaluation is submitted', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T08:00:00.000Z'));
    prisma.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      employeeId: viewer.id,
      cycleId: 'cycle-1',
      status: 'manager_scoring',
      isExempt: false,
      participantDisposition: 'active',
      indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
      closedAt: null,
      selfEvalSubmittedAt: new Date('2026-09-02T08:00:00.000Z'),
      publishedAt: null,
      employee: { id: viewer.id, name: viewer.name },
      cycle: {
        id: 'cycle-1', name: '2026-Q3', monthlyFollowUpRequired: true, workflowVersion: 2,
        openedAt: new Date('2026-07-01T00:00:00.000Z'), publishedAt: null, closedAt: null,
      },
      periods: [{
        periodKey: '2026-09',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-06T00:00:00.000Z'),
        status: 'manager_scoring',
        employeeSubmittedAt: new Date('2026-09-02T08:00:00.000Z'),
        managerSubmittedAt: null,
      }],
      indicatorInstances: [],
    });

    try {
      const result = await service.findTracking(
        { ownerId: viewer.id, cycleId: 'cycle-1' },
        viewer,
      );

      expect(result).toEqual(expect.objectContaining({
        canEdit: false,
        summary: expect.objectContaining({ activeBusinessPeriodKey: '2026-09' }),
      }));
    } finally {
      jest.useRealTimers();
    }
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

  it('includes every descendant level but marks only direct-report objectives reviewable', async () => {
    const managerObjective = {
      ...visibleObjective,
      id: 'objective-manager',
      ownerId: 'manager-1',
      parentId: null,
      owner: {
        id: 'manager-1',
        name: 'Manager',
        directManagerId: null,
        directManager: null,
      },
      reviewStatus: 'not_required',
    };
    const leadObjective = {
      ...visibleObjective,
      id: 'objective-lead',
      ownerId: 'lead-1',
      parentId: 'objective-manager',
      owner: {
        id: 'lead-1',
        name: 'Lead',
        directManagerId: 'manager-1',
        directManager: { id: 'manager-1', name: 'Manager' },
      },
    };
    const employeeObjective = {
      ...visibleObjective,
      id: 'objective-employee',
      ownerId: 'employee-1',
      parentId: 'objective-lead',
      owner: {
        id: 'employee-1',
        name: 'Employee',
        directManagerId: 'lead-1',
        directManager: { id: 'lead-1', name: 'Lead' },
      },
    };
    prisma.user.findMany.mockImplementation(async (args: any) => (
      args?.select?.directManagerId
        ? [
            { id: 'manager-1', directManagerId: null },
            { id: 'lead-1', directManagerId: 'manager-1' },
            { id: 'employee-1', directManagerId: 'lead-1' },
          ]
        : [{ id: 'manager-1' }, { id: 'lead-1' }]
    ));
    prisma.objective.findMany.mockResolvedValue([
      managerObjective,
      leadObjective,
      employeeObjective,
    ]);

    const result = await service.findTree(viewer, 'cycle-1');
    const flattened = [
      ...result,
      ...(result[0]?.children ?? []),
      ...(result[0]?.children?.[0]?.children ?? []),
    ];

    expect(prisma.objective.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { ownerId: { in: ['manager-1', 'lead-1', 'employee-1'] } },
        ]),
      }),
    }));
    expect(flattened.find((objective) => objective.id === 'objective-lead')).toEqual(
      expect.objectContaining({ ownerReportingDepth: 1, canReview: true }),
    );
    expect(flattened.find((objective) => objective.id === 'objective-employee')).toEqual(
      expect.objectContaining({ ownerReportingDepth: 2, canReview: false }),
    );
  });

  it('submits an active objective to the owner current direct manager', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'manager-1' });
    prisma.objective.create.mockResolvedValue(visibleObjective);

    const result = await service.create({
      title: 'Visible objective',
      level: ObjectiveLevel.individual,
      ownerId: 'employee-1',
      deptId: 'dept-1',
      cycleId: 'cycle-1',
    } as any, viewer);

    expect(result).toEqual(expect.objectContaining({
      id: 'objective-visible',
      reviewStatus: 'pending',
      reviewerId: 'manager-1',
      canReview: true,
    }));
    expect(prisma.objective.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewStatus: 'pending' }),
    }));
  });

  it('rejects creating a child objective under a parent from another cycle', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'manager-1' });
    prisma.objective.findUnique
      .mockResolvedValueOnce({ level: ObjectiveLevel.department })
      .mockResolvedValueOnce({ cycleId: 'cycle-parent' });

    await expect(service.create({
      title: 'Cross-cycle child',
      level: ObjectiveLevel.individual,
      ownerId: 'employee-1',
      deptId: 'dept-1',
      cycleId: 'cycle-child',
      parentId: 'parent-other-cycle',
    } as any, viewer)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.objective.create).not.toHaveBeenCalled();
  });

  it.each([
    { childCycleId: undefined, parentCycleId: 'cycle-parent' },
    { childCycleId: 'cycle-child', parentCycleId: null },
  ])(
    'rejects creating a child when null and non-null cycles differ ($childCycleId vs $parentCycleId)',
    async ({ childCycleId, parentCycleId }) => {
      prisma.user.findUnique.mockResolvedValue({ directManagerId: 'manager-1' });
      prisma.objective.create.mockResolvedValue(visibleObjective);
      prisma.objective.findUnique
        .mockResolvedValueOnce({ level: ObjectiveLevel.department })
        .mockResolvedValueOnce({ cycleId: parentCycleId });

      await expect(service.create({
        title: 'Cycle-mismatched child',
        level: ObjectiveLevel.individual,
        ownerId: 'employee-1',
        deptId: 'dept-1',
        cycleId: childCycleId,
        parentId: 'parent-cycle-mismatch',
      } as any, viewer)).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.objective.create).not.toHaveBeenCalled();
    },
  );

  it('lets only the current direct manager approve a pending objective', async () => {
    const approvedObjective = {
      ...visibleObjective,
      reviewStatus: 'approved',
      reviewedById: viewer.id,
      reviewedAt: new Date('2026-08-25T08:00:00.000Z'),
      reviewComment: '对齐清晰',
      reviewedBy: { id: viewer.id, name: viewer.name },
    };
    prisma.objective.findUnique
      .mockResolvedValueOnce(visibleObjective)
      .mockResolvedValueOnce(approvedObjective);

    const result = await (service as any).reviewObjective(
      'objective-visible',
      'approved',
      '对齐清晰',
      viewer,
      visibleObjective.updatedAt.toISOString(),
    );

    expect(result).toEqual(expect.objectContaining({
      reviewStatus: 'approved',
      reviewedById: viewer.id,
      reviewComment: '对齐清晰',
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: viewer.id,
        action: 'objective_review_approved',
        entityType: 'objective',
        entityId: 'objective-visible',
      }),
    });
  });

  it('does not grant objective review authority from HR or all-data read access', async () => {
    prisma.objective.findUnique.mockResolvedValue(visibleObjective);
    const broadReader = {
      ...viewer,
      id: 'hr-1',
      name: 'HR',
      sysRole: SysRole.hr,
      canViewAll: true,
    };

    await expect((service as any).reviewObjective(
      'objective-visible',
      'approved',
      undefined,
      broadReader,
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.objective.update).not.toHaveBeenCalled();
  });

  it('returns a conflict when a pending objective has already been reviewed', async () => {
    prisma.objective.findUnique.mockResolvedValue({
      ...visibleObjective,
      reviewStatus: 'approved',
    });

    await expect((service as any).reviewObjective(
      'objective-visible',
      'changes_requested',
      '请补充量化口径',
      viewer,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.objective.update).not.toHaveBeenCalled();
  });

  it('returns a conflict when another request claims the pending review first', async () => {
    prisma.objective.findUnique.mockResolvedValue(visibleObjective);
    prisma.objective.update.mockResolvedValue({
      ...visibleObjective,
      reviewStatus: 'approved',
    });
    prisma.objective.updateMany.mockResolvedValue({ count: 0 });

    await expect((service as any).reviewObjective(
      'objective-visible',
      'approved',
      undefined,
      viewer,
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('claims database timestamps within the client millisecond version', async () => {
    prisma.objective.findUnique.mockResolvedValue(visibleObjective);

    await (service as any).reviewObjective(
      'objective-visible',
      'approved',
      undefined,
      viewer,
      '2026-08-07T08:00:00.000Z',
    );

    expect(prisma.objective.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'objective-visible',
        reviewStatus: 'pending',
        updatedAt: {
          gte: new Date('2026-08-07T08:00:00.000Z'),
          lt: new Date('2026-08-07T08:00:00.001Z'),
        },
        owner: { directManagerId: viewer.id },
      }),
    }));
  });

  it('requires a reason before requesting objective changes', async () => {
    prisma.objective.findUnique.mockResolvedValue(visibleObjective);
    prisma.objective.update.mockResolvedValue({
      ...visibleObjective,
      reviewStatus: 'changes_requested',
      reviewedById: viewer.id,
      reviewedAt: new Date('2026-08-25T08:00:00.000Z'),
      reviewComment: null,
      reviewedBy: { id: viewer.id, name: viewer.name },
    });

    await expect((service as any).reviewObjective(
      'objective-visible',
      'changes_requested',
      '   ',
      viewer,
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.objective.update).not.toHaveBeenCalled();
  });

  it('resubmits an approved objective after a material definition change', async () => {
    const approvedObjective = {
      ...visibleObjective,
      reviewStatus: 'approved',
      reviewedById: viewer.id,
      reviewedAt: new Date('2026-08-25T08:00:00.000Z'),
      reviewComment: '同意',
      reviewedBy: { id: viewer.id, name: viewer.name },
    };
    prisma.objective.findUnique.mockResolvedValue(approvedObjective);
    prisma.user.findUnique.mockResolvedValue({ directManagerId: viewer.id });
    prisma.objective.update.mockResolvedValue({
      ...approvedObjective,
      title: 'Updated objective',
      reviewStatus: 'pending',
      reviewedById: null,
      reviewedAt: null,
      reviewComment: null,
      reviewedBy: null,
    });

    const result = await service.update(
      'objective-visible',
      { title: 'Updated objective' },
      viewer,
    );

    expect(result).toEqual(expect.objectContaining({
      reviewStatus: 'pending',
      reviewedById: null,
    }));
    expect(prisma.objective.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        reviewStatus: 'pending',
        reviewedById: null,
        reviewedAt: null,
        reviewComment: null,
      }),
    }));
  });

  it('rejects changing cycleId while keeping a parent from another cycle', async () => {
    prisma.objective.findUnique
      .mockResolvedValueOnce({
        ...visibleObjective,
        parentId: 'parent-other-cycle',
      })
      .mockResolvedValueOnce({ level: ObjectiveLevel.department })
      .mockResolvedValueOnce({ cycleId: 'cycle-parent' });

    await expect(service.update(
      'objective-visible',
      { cycleId: 'cycle-child' },
      viewer,
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.objective.update).not.toHaveBeenCalled();
  });

  it.each([
    { childCycleId: null, parentCycleId: 'cycle-parent' },
    { childCycleId: 'cycle-child', parentCycleId: null },
  ])(
    'rejects updating a child when null and non-null cycles differ ($childCycleId vs $parentCycleId)',
    async ({ childCycleId, parentCycleId }) => {
      prisma.objective.update.mockResolvedValue(visibleObjective);
      prisma.objective.findUnique
        .mockResolvedValueOnce({
          ...visibleObjective,
          parentId: 'parent-cycle-mismatch',
        })
        .mockResolvedValueOnce({ level: ObjectiveLevel.department })
        .mockResolvedValueOnce({ cycleId: parentCycleId });

      await expect(service.update(
        'objective-visible',
        { cycleId: childCycleId },
        viewer,
      )).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.objective.update).not.toHaveBeenCalled();
    },
  );

  it('rejects changing a parent cycle when an existing child would become incompatible', async () => {
    prisma.objective.update.mockResolvedValue({
      ...visibleObjective,
      cycleId: 'cycle-new',
    });
    prisma.objective.findUnique.mockResolvedValue({
      ...visibleObjective,
      level: ObjectiveLevel.department,
      parentId: null,
      cycleId: 'cycle-old',
    });
    prisma.objective.findMany.mockResolvedValue([{ cycleId: 'cycle-old' }]);

    await expect(service.update(
      'objective-visible',
      { cycleId: 'cycle-new' },
      viewer,
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.objective.update).not.toHaveBeenCalled();
  });

  it('shows only explicitly shareable direct-manager indicators and keeps them read-only', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'new-roster-manager' });
    prisma.assessmentTask.findUnique
      .mockResolvedValueOnce({ managerId: 'director-1' })
      .mockResolvedValueOnce({
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

    expect(prisma.assessmentTask.findUnique).toHaveBeenNthCalledWith(1, {
      where: { cycleId_employeeId: { cycleId: 'cycle-1', employeeId: viewer.id } },
      select: { managerId: true },
    });
    const trackingQuery = JSON.stringify(prisma.assessmentTask.findUnique.mock.calls[1][0]);
    expect(trackingQuery).toContain('visibilityRules');
    expect(trackingQuery).toContain('"scope":"company"');
    expect(trackingQuery).toContain('"scope":"direct_reports"');
    expect(trackingQuery).toContain('"scope":"all_reports"');
    expect(trackingQuery).toContain(`"userId":"${viewer.id}"`);
    expect(result.canEdit).toBe(false);
  });

  it('rejects an arbitrary tracking owner before loading their task', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'unrelated-user' });
    prisma.assessmentTask.findUnique.mockResolvedValue({ managerId: 'director-1' });

    await expect(service.findTracking(
      { ownerId: 'unrelated-user', cycleId: 'cycle-1' },
      viewer,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.assessmentTask.findUnique).toHaveBeenCalledTimes(1);
  });

  it('builds the indicator map from explicit visible alignments and keeps unaligned peers separate', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1', name: '2026 Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'),
    });
    prisma.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-self', cycleId: 'cycle-1', employeeId: 'manager-1', managerId: 'leader-1', deptId: 'dept-1',
    });
    prisma.assessmentTask.findMany.mockResolvedValue([
      { employeeId: 'manager-1', managerId: 'leader-1' },
      { employeeId: 'leader-1', managerId: 'director-1' },
    ]);
    prisma.indicatorInstance.findMany.mockResolvedValue([
      {
        id: 'parent-1', name: '提升组织效能', description: null, weight: new Prisma.Decimal('1'), sortOrder: 0,
        visibilityScope: 'direct_reports', visibilityRules: [{ scope: 'direct_reports' }],
        task: { employeeId: 'leader-1', deptId: 'dept-1', employee: { id: 'leader-1', name: 'Leader' }, dept: { id: 'dept-1', name: 'HR' } },
        childAlignments: [], progressUpdates: [],
      },
      {
        id: 'child-1', name: '完成招聘交付', description: null, weight: new Prisma.Decimal('0.7'), sortOrder: 0,
        visibilityScope: 'supervisors', visibilityRules: [{ scope: 'supervisors' }],
        task: { employeeId: 'manager-1', deptId: 'dept-1', employee: { id: 'manager-1', name: 'Manager' }, dept: { id: 'dept-1', name: 'HR' } },
        childAlignments: [{ parentIndicatorId: 'parent-1' }], progressUpdates: [{ progress: 60 }],
      },
      {
        id: 'peer-1', name: '推动培训落地', description: null, weight: new Prisma.Decimal('0.5'), sortOrder: 0,
        visibilityScope: 'department', visibilityRules: [{ scope: 'department' }],
        task: { employeeId: 'peer-1', deptId: 'dept-1', employee: { id: 'peer-1', name: 'Peer' }, dept: { id: 'dept-1', name: 'HR' } },
        childAlignments: [], progressUpdates: [],
      },
    ]);

    const result = await service.findIndicatorMap('cycle-1', viewer);

    expect(result.roots).toEqual(['parent-1']);
    expect(result.edges).toEqual([{ id: 'parent-1:child-1', source: 'parent-1', target: 'child-1' }]);
    expect(result.nodes.map((node) => node.id)).toEqual(['parent-1', 'child-1']);
    expect(result.sameDepartmentUnaligned.map((node) => node.id)).toEqual(['peer-1']);
    expect(result.nodes[1]).toMatchObject({ progress: 60, owner: { id: 'manager-1', name: 'Manager' } });
  });

  it('promotes a visible child to a root without leaking its hidden parent', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1', name: '2026 Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'),
    });
    prisma.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-self', cycleId: 'cycle-1', employeeId: 'manager-1', managerId: 'leader-1', deptId: 'dept-1',
    });
    prisma.assessmentTask.findMany.mockResolvedValue([{ employeeId: 'manager-1', managerId: 'leader-1' }]);
    prisma.indicatorInstance.findMany.mockResolvedValue([{
      id: 'child-1', name: '完成招聘交付', description: null, weight: new Prisma.Decimal('1'), sortOrder: 0,
      visibilityScope: 'supervisors', visibilityRules: [{ scope: 'supervisors' }],
      task: { employeeId: 'manager-1', deptId: 'dept-1', employee: { id: 'manager-1', name: 'Manager' }, dept: { id: 'dept-1', name: 'HR' } },
      childAlignments: [{ parentIndicatorId: 'hidden-parent' }], progressUpdates: [],
    }]);

    const result = await service.findIndicatorMap('cycle-1', viewer);

    expect(result.roots).toEqual(['child-1']);
    expect(result.edges).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('hidden-parent');
    expect(result).not.toHaveProperty('hiddenCount');
  });

  it('appends an employee progress update and its audit record without overwriting history', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T08:00:00.000Z'));
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1',
      name: 'GMV 达成率',
      task: {
        id: 'task-1',
        employeeId: viewer.id,
        status: 'manager_scoring',
        isExempt: false,
        participantDisposition: 'active',
        indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
        closedAt: null,
        selfEvalSubmittedAt: new Date('2026-08-16T07:00:00.000Z'),
        publishedAt: null,
        periods: [{
          periodKey: '2026-09',
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T00:00:00.000Z'),
          status: 'self_eval',
          employeeSubmittedAt: null,
        }],
        cycle: {
          workflowVersion: 2,
          openedAt: new Date('2026-07-01T00:00:00.000Z'),
          publishedAt: null,
          closedAt: null,
        },
      },
    });
    prisma.indicatorProgressUpdate.findMany.mockResolvedValue([]);
    prisma.indicatorProgressUpdate.create.mockResolvedValue({
      id: 'progress-1',
      indicatorInstanceId: 'indicator-1',
      progress: 45,
      healthStatus: 'on_track',
      content: '首轮方案已经完成评审',
      attachments: [],
      createdBy: viewer.id,
      createdAt: new Date('2026-08-16T08:00:00.000Z'),
      creator: { id: viewer.id, name: viewer.name },
    });

    let result;
    try {
      result = await (service as any).updateIndicatorProgress(
        'indicator-1',
        {
          progress: 45,
          healthStatus: 'on_track',
          content: '首轮方案已经完成评审',
          expectedLatestUpdateAt: null,
        },
        viewer,
      );
    } finally {
      jest.useRealTimers();
    }

    expect(prisma.indicatorProgressUpdate.create).toHaveBeenCalledWith({
      data: {
        indicatorInstanceId: 'indicator-1',
        progress: 45,
        healthStatus: 'on_track',
        content: '首轮方案已经完成评审',
        attachments: [],
        createdBy: viewer.id,
      },
      include: { creator: { select: { id: true, name: true } } },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
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

  it('rejects another progress update after the current month self evaluation is submitted early', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T08:00:00.000Z'));
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1',
      name: 'GMV 达成率',
      task: {
        id: 'task-1', employeeId: viewer.id, status: 'manager_scoring', isExempt: false,
        participantDisposition: 'active', indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
        closedAt: null, selfEvalSubmittedAt: new Date('2026-09-02T08:00:00.000Z'), publishedAt: null,
        periods: [{
          periodKey: '2026-09',
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-06T00:00:00.000Z'),
          status: 'manager_scoring',
          employeeSubmittedAt: new Date('2026-09-02T08:00:00.000Z'),
        }],
        cycle: {
          workflowVersion: 2, openedAt: new Date('2026-07-01T00:00:00.000Z'),
          publishedAt: null, closedAt: null,
        },
      },
    });

    try {
      await expect((service as any).updateIndicatorProgress(
        'indicator-1',
        { progress: 90, healthStatus: 'on_track', content: '提前提交后的更新' },
        viewer,
      )).rejects.toMatchObject({
        response: expect.objectContaining({ message: '本期月度自评已提交，不能再更新当期进展' }),
      });
      expect(prisma.indicatorProgressUpdate.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects progress after the assessment period ends even when the monthly self evaluation is overdue', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T08:00:00.000Z'));
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1',
      name: 'GMV 达成率',
      task: {
        id: 'task-1', employeeId: viewer.id, status: 'self_eval', isExempt: false,
        participantDisposition: 'active', indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
        closedAt: null, selfEvalSubmittedAt: null, publishedAt: null,
        periods: [{
          periodKey: '2026-09',
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-06T00:00:00.000Z'),
          status: 'self_eval',
          employeeSubmittedAt: null,
        }],
        cycle: {
          workflowVersion: 2, openedAt: new Date('2026-07-01T00:00:00.000Z'),
          publishedAt: null, closedAt: null,
        },
      },
    });

    try {
      await expect((service as any).updateIndicatorProgress(
        'indicator-1',
        { progress: 90, healthStatus: 'on_track', content: '期末后的更新' },
        viewer,
      )).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.indicatorProgressUpdate.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
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
    {
      status: 'self_eval',
      isExempt: false,
      participantDisposition: 'active',
      indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
      closedAt: null,
      selfEvalSubmittedAt: null,
      publishedAt: null,
      cycle: { workflowVersion: 2, openedAt: null, publishedAt: null, closedAt: null },
    },
    {
      status: 'self_eval',
      isExempt: false,
      participantDisposition: 'active',
      indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
      closedAt: null,
      selfEvalSubmittedAt: null,
      publishedAt: new Date('2026-09-15T07:00:00.000Z'),
      cycle: {
        workflowVersion: 2,
        openedAt: new Date('2026-07-01T00:00:00.000Z'),
        publishedAt: new Date('2026-09-15T07:00:00.000Z'),
        closedAt: null,
      },
    },
  ])('does not append progress outside an open unpublished cycle: %o', async (taskState) => {
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1',
      name: 'GMV 达成率',
      task: { id: 'task-1', employeeId: viewer.id, ...taskState },
    });

    await expect((service as any).updateIndicatorProgress(
      'indicator-1',
      { progress: 80, healthStatus: 'on_track', content: '迟到更新' },
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
        isExempt: false,
        participantDisposition: 'active',
        indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
        closedAt: null,
        selfEvalSubmittedAt: null,
        publishedAt: null,
        cycle: {
          workflowVersion: 2,
          openedAt: new Date('2026-07-01T00:00:00.000Z'),
          publishedAt: null,
          closedAt: null,
        },
      },
    });
    prisma.indicatorProgressUpdate.findMany.mockResolvedValue([{
      id: 'progress-newer',
      progress: 55,
      healthStatus: 'at_risk',
      createdAt: new Date('2026-08-16T09:00:00.000Z'),
      periodReviewRevisionId: null,
      period: null,
    }]);

    await expect((service as any).updateIndicatorProgress(
      'indicator-1',
      {
        progress: 60,
        healthStatus: 'on_track',
        content: '旧编辑器提交',
        expectedLatestUpdateAt: '2026-08-16T08:00:00.000Z',
      },
      viewer,
    )).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it('uses the latest business month for concurrency when an older month was archived later', async () => {
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1',
      name: 'GMV 达成率',
      task: {
        id: 'task-1',
        employeeId: viewer.id,
        status: 'self_eval',
        isExempt: false,
        participantDisposition: 'active',
        indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
        closedAt: null,
        selfEvalSubmittedAt: null,
        publishedAt: null,
        cycle: {
          workflowVersion: 2,
          openedAt: new Date('2026-07-01T00:00:00.000Z'),
          publishedAt: null,
          closedAt: null,
        },
      },
    });
    const augustCreatedAt = new Date('2026-09-03T02:42:07.893Z');
    prisma.indicatorProgressUpdate.findMany.mockResolvedValue([
      {
        id: 'july-archived-later',
        progress: 99,
        healthStatus: 'on_track',
        createdAt: new Date('2026-09-03T02:52:15.301Z'),
        periodReviewRevisionId: 'revision-july',
        period: { periodKey: '2026-07' },
      },
      {
        id: 'august-current',
        progress: 80,
        healthStatus: 'on_track',
        createdAt: augustCreatedAt,
        periodReviewRevisionId: 'revision-august',
        period: { periodKey: '2026-08' },
      },
    ]);
    prisma.indicatorProgressUpdate.create.mockResolvedValue({
      id: 'progress-new',
      indicatorInstanceId: 'indicator-1',
      progress: 87,
      healthStatus: 'on_track',
      content: '更新8月进展',
      attachments: [],
      createdBy: viewer.id,
      createdAt: new Date('2026-09-03T03:00:00.000Z'),
      creator: { id: viewer.id, name: viewer.name },
    });

    await expect((service as any).updateIndicatorProgress(
      'indicator-1',
      {
        progress: 87,
        healthStatus: 'on_track',
        content: '更新8月进展',
        expectedLatestUpdateAt: augustCreatedAt.toISOString(),
      },
      viewer,
    )).resolves.toEqual(expect.objectContaining({ id: 'progress-new', progress: 87 }));
  });

  it.each([
    { indicatorConfirmedAt: null },
    { isExempt: true },
    { participantDisposition: 'cycle_exempt' },
    { closedAt: new Date('2026-09-30T00:00:00.000Z') },
    { cycle: { workflowVersion: 2, openedAt: new Date('2026-07-01T00:00:00.000Z'), publishedAt: null, closedAt: new Date('2026-09-30T00:00:00.000Z') } },
  ])('does not append progress until the task is confirmed, active, non-exempt, and open: %o', async (override) => {
    const base = {
      id: 'task-1', employeeId: viewer.id, status: 'self_eval', isExempt: false,
      participantDisposition: 'active', indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
      closedAt: null, selfEvalSubmittedAt: null, publishedAt: null,
      cycle: {
        workflowVersion: 2, openedAt: new Date('2026-07-01T00:00:00.000Z'),
        publishedAt: null, closedAt: null,
      },
    };
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      id: 'indicator-1', name: 'GMV 达成率', task: { ...base, ...override },
    });

    await expect((service as any).updateIndicatorProgress(
      'indicator-1',
      { progress: 80, healthStatus: 'on_track', content: '迟到更新' },
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
        isExempt: false,
        participantDisposition: 'active',
        indicatorConfirmedAt: new Date('2026-07-02T00:00:00.000Z'),
        closedAt: null,
        selfEvalSubmittedAt: null,
        publishedAt: null,
        employee: { id: viewer.id, name: viewer.name },
        cycle: {
          id: 'cycle-1',
          name: '2026-Q3',
          workflowVersion: 2,
          openedAt: new Date('2026-07-01T00:00:00.000Z'),
          publishedAt: null,
          closedAt: null,
        },
        periods: [
          {
            id: 'period-july', periodKey: '2026-07', status: 'manager_scoring',
            employeeSubmittedAt: new Date('2026-08-01T00:00:00.000Z'), selfScoreTotal: new Prisma.Decimal('82'),
            indicatorReviews: [{ selfScore: new Prisma.Decimal('80'), indicatorVersionItem: { sourceInstanceId: 'indicator-1' } }],
          },
          {
            id: 'period-august', periodKey: '2026-08', status: 'completed',
            employeeSubmittedAt: new Date('2026-09-01T00:00:00.000Z'), selfScoreTotal: new Prisma.Decimal('91'),
            indicatorReviews: [{ selfScore: new Prisma.Decimal('90'), indicatorVersionItem: { sourceInstanceId: 'indicator-1' } }],
          },
          { id: 'period-september', periodKey: '2026-09', status: 'unopened', employeeSubmittedAt: null, selfScoreTotal: null, indicatorReviews: [] },
        ],
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
          periodReviewRevisionId: null,
          period: null,
          creator: { id: viewer.id, name: viewer.name },
        },
        {
          id: 'progress-1',
          progress: 40,
          healthStatus: 'on_track',
          content: '完成首轮投放',
          attachments: [],
          createdAt: new Date('2026-08-01T08:00:00.000Z'),
          periodReviewRevisionId: null,
          period: null,
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
      activeBusinessPeriodKey: '2026-09',
      alignedObjectives: [
        { id: 'objective-1', title: '提升经营质量', level: 'company', ownerId: 'vp-1' },
      ],
      progressUpdates: [
        expect.objectContaining({ id: 'progress-2', progress: 60, creatorName: viewer.name }),
        expect.objectContaining({ id: 'progress-1', progress: 40, creatorName: viewer.name }),
      ],
      selfEvaluationResults: [
        { periodKey: '2026-08', selfScore: 90, submittedAt: new Date('2026-09-01T00:00:00.000Z') },
        { periodKey: '2026-07', selfScore: 80, submittedAt: new Date('2026-08-01T00:00:00.000Z') },
      ],
      changeRecords: [
        expect.objectContaining({ id: 'audit-1', action: 'indicator_updated', actorName: 'Manager' }),
      ],
    }));
  });

  it('opens a shareable direct-manager indicator as read-only without exposing edit authority', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: 'new-roster-manager' });
    prisma.indicatorInstance.findUnique.mockResolvedValue({
      task: { employeeId: 'director-1', cycleId: 'cycle-1' },
    });
    prisma.assessmentTask.findUnique.mockResolvedValue({ managerId: 'director-1' });
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
      visibilityRules: [
        { scope: 'direct_reports' },
        { scope: 'department' },
      ],
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

    expect(prisma.assessmentTask.findUnique).toHaveBeenCalledWith({
      where: { cycleId_employeeId: { cycleId: 'cycle-1', employeeId: viewer.id } },
      select: { managerId: true },
    });

    const detailQuery = JSON.stringify(prisma.indicatorInstance.findFirst.mock.calls[0][0]);
    expect(detailQuery).toContain('"employeeId":"manager-1"');
    expect(detailQuery).toContain('"employeeId":"director-1"');
    expect(detailQuery).toContain('"scope":"direct_reports"');
    expect(detailQuery).toContain('visibilityRules');
    expect(result.canEdit).toBe(false);
    expect(result.visibilityScopes).toEqual(['direct_reports', 'department']);
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

  it('returns only same-cycle visible indicators owned by the frozen performance manager', async () => {
    prisma.assessmentTask.findUnique.mockResolvedValue({
      id: 'task-child',
      cycleId: 'cycle-1',
      employeeId: viewer.id,
      managerId: 'director-1',
      deptId: 'dept-1',
      manager: { id: 'director-1', name: 'Director', avatarUrl: 'https://example.com/director.png' },
    });
    prisma.indicatorInstance.findMany.mockResolvedValue([{
      id: 'parent-1',
      name: '部门交付目标',
      task: { employee: { id: 'director-1', name: 'Director' } },
    }]);

    const result = await service.findIndicatorAlignmentCandidates('task-child', viewer);

    expect(result).toEqual({
      items: [{ id: 'parent-1', name: '部门交付目标', owner: { id: 'director-1', name: 'Director' } }],
      owners: [{
        id: 'director-1',
        name: 'Director',
        avatarUrl: 'https://example.com/director.png',
        relation: 'performance_manager',
        items: [{ id: 'parent-1', name: '部门交付目标', owner: { id: 'director-1', name: 'Director' } }],
      }],
      reason: null,
    });
    const query = JSON.stringify(prisma.indicatorInstance.findMany.mock.calls[0][0]);
    expect(query).toContain('"cycleId":"cycle-1"');
    expect(query).toContain('"employeeId":"director-1"');
    expect(query).toContain('"scope":"direct_reports"');
    expect(query).toContain('"scope":"department_tree"');
    expect(query).toContain('"userId":"manager-1"');
  });

  it('rejects an alignment id that is not a visible indicator of the frozen manager', async () => {
    prisma.indicatorInstance.count.mockResolvedValue(0);

    await expect(service.assertIndicatorAlignmentCandidateIds(
      {
        id: 'task-child',
        cycleId: 'cycle-1',
        employeeId: viewer.id,
        managerId: 'director-1',
        deptId: 'dept-1',
      },
      ['protected-parent'],
      viewer,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });
});
