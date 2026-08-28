import { CycleStatus, Prisma, ScoringFrequency, SysRole } from '@prisma/client';
import { CyclesService } from './cycles.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { AuthUser } from '@/common/types/auth.types';

describe('CyclesService', () => {
  const explicitExemptDeptId = 'c134b614-5d97-4f1c-a72e-0afc6d12eb99';
  const companyFinalApproverId = '88888888-8888-4888-8888-888888888888';
  const creator = {
    id: '11111111-1111-4111-8111-111111111111',
    sysRole: SysRole.hr,
    deptId: null,
    canViewAll: true,
  } as AuthUser;

  let prisma: any;
  let service: CyclesService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      assessmentCycle: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'cycle-1', ...data })),
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      assessmentTask: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
      assessmentTemplateSnapshot: { count: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999' }) },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue({ value: { userId: companyFinalApproverId } }),
      },
      auditLog: { create: jest.fn() },
    };
    service = new CyclesService(prisma as never);
  });

  function quarterlyCycle(overrides: Partial<CreateCycleDto> = {}): CreateCycleDto {
    return {
      name: '2027年第一季度',
      type: 'quarterly',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      ...overrides,
    };
  }

  function taskScope(userId: string) {
    return {
      OR: [
        { employeeId: userId },
        { managerId: userId },
        { deptHeadId: userId },
        { approverId: userId },
      ],
    };
  }

  it('allows goal-setting deadlines before the performance period starts', async () => {
    const dto = quarterlyCycle({
      deadlineIndicatorSetting: new Date('2026-12-27T00:00:00.000Z'),
      deadlineIndicatorConfirm: new Date('2026-12-31T00:00:00.000Z'),
      deadlineSelfEval: new Date('2027-04-05T00:00:00.000Z'),
    });

    await expect(service.create(dto, creator)).resolves.toEqual(
      expect.objectContaining({ id: 'cycle-1' }),
    );
    expect(prisma.assessmentCycle.create).toHaveBeenCalledTimes(1);
  });

  it('derives the default goal-setting and self-evaluation opening dates', async () => {
    await service.create(quarterlyCycle(), creator);

    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
        selfEvalOpenAt: new Date('2027-04-01T00:00:00.000Z'),
        gradeAMaxRatio: new Prisma.Decimal(0.2),
        gradeBMaxRatio: new Prisma.Decimal(0.4),
        gradeCMaxRatio: new Prisma.Decimal(0.3),
        gradeDMaxRatio: new Prisma.Decimal(0.1),
      }),
    }));
  });

  it('stores explicit exempt departments when creating a cycle', async () => {
    await service.create(quarterlyCycle({
      explicitExemptDeptIds: [explicitExemptDeptId],
    } as Partial<CreateCycleDto>), creator);

    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        explicitExemptDeptIds: [explicitExemptDeptId],
      }),
    }));
  });

  it('stores explicit exempt departments when updating a draft cycle', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      name: '2027年第一季度',
      type: 'quarterly',
      status: CycleStatus.draft,
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-04-01T00:00:00.000Z'),
      hrOwnerId: creator.id,
    });
    prisma.assessmentCycle.update.mockResolvedValue({
      id: 'cycle-1',
      name: '2027年第一季度',
      type: 'quarterly',
      status: CycleStatus.draft,
    });

    await service.updateDraft('cycle-1', {
      explicitExemptDeptIds: [explicitExemptDeptId],
    } as any, creator);

    expect(prisma.assessmentCycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle-1' },
      data: expect.objectContaining({
        explicitExemptDeptIds: [explicitExemptDeptId],
      }),
    });
  });

  it.each([
    {
      label: 'scoring frequency',
      update: { scoringFrequency: ScoringFrequency.cycle },
    },
    {
      label: 'schedule timestamp',
      update: {
        periodSchedules: [{
          periodKey: '2027-01',
          selfEvalOpenAt: '2027-02-02T09:00:00+08:00',
          selfEvalDueAt: '2027-02-03T18:00:00+08:00',
          managerDueAt: '2027-02-08T18:00:00+08:00',
        }],
      },
    },
  ])('forces reapproval and audits an approved draft after changing $label', async ({ update }) => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      name: '2027年第一季度',
      type: 'quarterly',
      workflowVersion: 2,
      scoringFrequency: ScoringFrequency.monthly,
      status: CycleStatus.draft,
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-04-01T00:00:00.000Z'),
      reviewerId: '99999999-9999-4999-8999-999999999999',
      reviewStatus: 'approved',
      reviewedAt: new Date('2026-12-20T00:00:00.000Z'),
      reviewComment: '通过',
      periodSchedules: [{
        periodKey: '2027-01',
        periodType: 'month',
        sequence: 1,
        periodStart: new Date('2027-01-01T00:00:00.000Z'),
        periodEnd: new Date('2027-01-31T00:00:00.000Z'),
        selfEvalOpenAt: new Date('2027-02-01T01:00:00.000Z'),
        selfEvalDueAt: new Date('2027-02-03T10:00:00.000Z'),
        managerDueAt: new Date('2027-02-08T10:00:00.000Z'),
        isException: false,
      }],
    });
    prisma.assessmentCycle.update.mockImplementation(({ data }) => ({
      id: 'cycle-1',
      name: '2027年第一季度',
      type: 'quarterly',
      status: CycleStatus.draft,
      ...data,
    }));

    await service.updateDraft('cycle-1', update as any, creator);

    expect(prisma.assessmentCycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle-1' },
      data: expect.objectContaining({
        reviewStatus: 'pending',
        reviewedAt: null,
        reviewComment: null,
        periodSchedules: {
          deleteMany: {},
          create: expect.any(Array),
        },
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'cycle_scoring_plan_updated',
        oldValue: expect.objectContaining({ scoringFrequency: ScoringFrequency.monthly }),
        newValue: expect.objectContaining({ changedPeriodKeys: expect.any(Array) }),
      }),
    });
  });

  it('allows a manually customized schedule to cross the performance period boundaries', async () => {
    const dto = quarterlyCycle({
      goalSettingOpenAt: new Date('2027-01-02T01:00:00.000Z'),
      deadlineIndicatorSetting: new Date('2027-01-03T10:00:00.000Z'),
      deadlineIndicatorConfirm: new Date('2027-01-04T10:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-03-01T01:00:00.000Z'),
      deadlineSelfEval: new Date('2027-03-02T10:00:00.000Z'),
      deadlineManagerScore: new Date('2027-03-03T10:00:00.000Z'),
      deadlineHrCalibration: new Date('2027-03-04T10:00:00.000Z'),
      deadlineApproval: new Date('2027-03-05T10:00:00.000Z'),
      deadlinePublish: new Date('2027-03-06T10:00:00.000Z'),
    });

    await expect(service.create(dto, creator)).resolves.toEqual(
      expect.objectContaining({ id: 'cycle-1' }),
    );
    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        goalSettingOpenAt: dto.goalSettingOpenAt,
        selfEvalOpenAt: dto.selfEvalOpenAt,
      }),
    }));
  });

  it('persists a normalized v2 scoring plan and snapshots the configured final approver', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: '99999999-9999-4999-8999-999999999999' })
      .mockResolvedValueOnce({ id: companyFinalApproverId });

    const result = await service.create(quarterlyCycle({
      workflowVersion: 2,
      scoringFrequency: ScoringFrequency.monthly,
      periodSchedules: [{
        periodKey: '2027-01',
        selfEvalOpenAt: '2027-02-01T09:00:00+08:00',
        selfEvalDueAt: '2027-02-03T18:00:00+08:00',
        managerDueAt: '2027-02-08T18:00:00+08:00',
      }],
    } as any), creator);

    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowVersion: 2,
        scoringFrequency: ScoringFrequency.monthly,
        companyFinalApprover: { connect: { id: companyFinalApproverId } },
        periodSchedules: {
          create: expect.arrayContaining([
            expect.objectContaining({ periodKey: '2027-01', sequence: 1 }),
          ]),
        },
      }),
      include: expect.objectContaining({
        periodSchedules: { orderBy: { sequence: 'asc' } },
        companyFinalApprover: { select: { id: true, name: true } },
      }),
    });
    expect(result).toEqual(expect.objectContaining({
      reviewFrequency: 'cycle',
      scheduleWarnings: expect.any(Array),
    }));
  });

  it('returns only opened cycles that contain a task for the current employee', async () => {
    prisma.assessmentCycle.findMany.mockResolvedValue([{
      id: 'cycle-1',
      name: '2027年第一季度',
      status: 'indicator_setting',
      tasks: [{ id: 'task-1', status: 'indicator_drafting', isExempt: false }],
    }]);
    const employee = { ...creator, id: 'employee-1', sysRole: SysRole.employee } as AuthUser;
    const visibleCycles = service as unknown as {
      findMine: (viewer: AuthUser) => Promise<unknown[]>;
    };

    await expect(visibleCycles.findMine(employee)).resolves.toHaveLength(1);
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['draft', 'scheduled', 'launch_blocked'] },
        tasks: { some: taskScope(employee.id) },
      },
      include: {
        tasks: {
          where: taskScope(employee.id),
          select: { id: true, status: true, isExempt: true },
          take: 1,
        },
      },
      orderBy: { startDate: 'desc' },
    });
  });

  it('returns cycles where the current user is the direct manager of a task', async () => {
    prisma.assessmentCycle.findMany.mockResolvedValue([{
      id: 'cycle-1',
      name: '2027年第一季度',
      status: 'indicator_setting',
      tasks: [{ id: 'task-1', status: 'indicator_reviewing', isExempt: false }],
    }]);
    const manager = { ...creator, id: 'manager-1', sysRole: SysRole.manager } as AuthUser;
    const visibleCycles = service as unknown as {
      findMine: (viewer: AuthUser) => Promise<unknown[]>;
    };

    await expect(visibleCycles.findMine(manager)).resolves.toHaveLength(1);
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['draft', 'scheduled', 'launch_blocked'] },
        tasks: {
          some: taskScope(manager.id),
        },
      },
      include: {
        tasks: {
          where: taskScope(manager.id),
          select: { id: true, status: true, isExempt: true },
          take: 1,
        },
      },
      orderBy: { startDate: 'desc' },
    });
  });

  it('returns approval cycles to an employee who is the saved task approver', async () => {
    prisma.assessmentCycle.findMany.mockResolvedValue([{
      id: 'cycle-1',
      name: '2027年第一季度',
      status: 'approval',
      tasks: [{ id: 'task-1', status: 'approval', isExempt: false }],
    }]);
    const approver = { ...creator, id: 'approver-1', sysRole: SysRole.employee } as AuthUser;

    await expect(service.findMine(approver)).resolves.toHaveLength(1);
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tasks: {
          some: {
            OR: expect.arrayContaining([
              { employeeId: approver.id },
              { approverId: approver.id },
            ]),
          },
        },
      }),
    }));
  });

  it('allows a direct manager to open a cycle that only contains team tasks', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      status: 'indicator_setting',
      deadlineIndicatorSetting: null,
      deadlineIndicatorConfirm: null,
    });
    prisma.assessmentTask.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.assessmentTask.groupBy.mockResolvedValue([]);
    prisma.assessmentTemplateSnapshot.count.mockResolvedValue(1);
    const manager = { ...creator, id: 'manager-1', sysRole: SysRole.manager } as AuthUser;

    await expect(service.findOne('cycle-1', manager)).resolves.toEqual(
      expect.objectContaining({ id: 'cycle-1', reviewFrequency: 'cycle' }),
    );
    expect(prisma.assessmentCycle.findUnique).toHaveBeenCalledWith({
      where: { id: 'cycle-1' },
      include: expect.objectContaining({
        periodSchedules: { orderBy: { sequence: 'asc' } },
        companyFinalApprover: { select: { id: true, name: true } },
      }),
    });
    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(1, {
      where: {
        cycleId: 'cycle-1',
        ...taskScope(manager.id),
      },
    });
    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(2, {
      where: {
        cycleId: 'cycle-1',
        ...taskScope(manager.id),
      },
    });
  });

  it('scopes the general cycle list to the current employee task', async () => {
    prisma.assessmentCycle.count.mockResolvedValue(1);
    prisma.assessmentCycle.findMany.mockResolvedValue([{ id: 'cycle-1' }]);
    const employee = { ...creator, id: 'employee-1', sysRole: SysRole.employee } as AuthUser;

    await expect(service.findAll(
      { page: 1, pageSize: 20, skip: 0, take: 20 } as any,
      employee,
    )).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ id: 'cycle-1', reviewFrequency: 'cycle' })],
    }));

    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { notIn: ['draft', 'scheduled', 'launch_blocked'] },
        tasks: { some: taskScope(employee.id) },
      }),
      include: expect.objectContaining({
        periodSchedules: { orderBy: { sequence: 'asc' } },
        companyFinalApprover: { select: { id: true, name: true } },
      }),
    }));
  });

  it('scopes the general cycle list to the current manager own or direct-team tasks', async () => {
    prisma.assessmentCycle.count.mockResolvedValue(1);
    prisma.assessmentCycle.findMany.mockResolvedValue([]);
    const manager = { ...creator, id: 'manager-1', sysRole: SysRole.manager } as AuthUser;

    await service.findAll({ page: 1, pageSize: 20, skip: 0, take: 20 } as any, manager);

    const managerTaskScope = taskScope(manager.id);
    expect(prisma.assessmentCycle.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ tasks: { some: managerTaskScope } }),
    });
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tasks: { some: managerTaskScope } }),
    }));
  });

  it('filters the cycle list by the attention status group', async () => {
    prisma.assessmentCycle.count.mockResolvedValue(0);
    prisma.assessmentCycle.findMany.mockResolvedValue([]);

    await service.findAll({
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
      group: 'attention',
    } as any, creator);

    const expectedWhere = { status: { in: ['draft', 'launch_blocked'] } };
    expect(prisma.assessmentCycle.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedWhere,
    }));
  });

  it('uses an exact cycle status instead of the broader status group', async () => {
    prisma.assessmentCycle.count.mockResolvedValue(0);
    prisma.assessmentCycle.findMany.mockResolvedValue([]);

    await service.findAll({
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
      group: 'attention',
      status: 'scheduled',
    } as any, creator);

    expect(prisma.assessmentCycle.count).toHaveBeenCalledWith({
      where: { status: 'scheduled' },
    });
  });

  it('stores an explicit per-cycle notification mode and defaults to off', async () => {
    await service.create(quarterlyCycle({ notificationMode: 'launch_only' } as Partial<CreateCycleDto>), creator);
    expect(prisma.assessmentCycle.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notificationMode: 'launch_only' }),
    }));

    await service.create(quarterlyCycle(), creator);
    expect(prisma.assessmentCycle.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notificationMode: 'off' }),
    }));
  });

  it('changes notification mode only before a cycle has opened', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      status: CycleStatus.draft,
      notificationMode: 'off',
    });
    prisma.assessmentCycle.findUniqueOrThrow.mockResolvedValue({
      id: 'cycle-1',
      status: CycleStatus.draft,
      notificationMode: 'launch_only',
    });

    await expect((service as any).updateNotificationMode(
      'cycle-1',
      'launch_only',
      creator,
    )).resolves.toEqual(expect.objectContaining({ notificationMode: 'launch_only' }));
    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: { id: 'cycle-1', status: CycleStatus.draft },
      data: { notificationMode: 'launch_only' },
    });
  });

  it('deletes a draft cycle and records who deleted it', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      name: '2027年第一季度',
      type: 'quarterly',
      status: CycleStatus.draft,
    });

    await expect(service.remove('cycle-1', creator)).resolves.toEqual({ id: 'cycle-1' });
    expect(prisma.assessmentCycle.deleteMany).toHaveBeenCalledWith({
      where: { id: 'cycle-1', status: CycleStatus.draft },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: creator.id,
        action: 'cycle_draft_deleted',
        entityType: 'assessment_cycle',
        entityId: 'cycle-1',
      }),
    });
  });

  it('rejects deletion after a cycle leaves draft status', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      name: '2027年第一季度',
      type: 'quarterly',
      status: CycleStatus.scheduled,
    });

    await expect(service.remove('cycle-1', creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('仅草稿') },
    });
    expect(prisma.assessmentCycle.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects deletion when the draft status changes during the request', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      name: '2027年第一季度',
      type: 'quarterly',
      status: CycleStatus.draft,
    });
    prisma.assessmentCycle.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove('cycle-1', creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('状态已变化') },
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not expose organization-wide task counts to an employee', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      status: 'indicator_setting',
      deadlineIndicatorSetting: null,
      deadlineIndicatorConfirm: null,
    });
    prisma.assessmentTask.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.assessmentTask.groupBy.mockResolvedValue([{ status: 'indicator_drafting', _count: { _all: 1 } }]);
    prisma.assessmentTemplateSnapshot.count.mockResolvedValue(1);
    const employee = { ...creator, id: 'employee-1', sysRole: SysRole.employee } as AuthUser;

    await service.findOne('cycle-1', employee);

    expect(prisma.assessmentTask.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { cycleId: 'cycle-1', ...taskScope(employee.id) },
    }));
  });

  it('requires schedule cancellation before deadlines can be changed', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', status: 'scheduled' });

    await expect(service.updateDeadlines('cycle-1', {
      deadlineIndicatorSetting: new Date('2026-12-28T00:00:00.000Z'),
    }, creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('取消预约') },
    });
  });

  it('uses a status CAS so concurrent scheduling cannot race a deadline update', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      status: 'draft',
      deadlineIndicatorSetting: new Date('2026-12-20T00:00:00.000Z'),
    });
    prisma.assessmentCycle.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateDeadlines('cycle-1', {
      deadlineIndicatorSetting: new Date('2026-12-21T00:00:00.000Z'),
    }, creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('状态已变化') },
    });
    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cycle-1', status: 'draft' },
    }));
  });
});
