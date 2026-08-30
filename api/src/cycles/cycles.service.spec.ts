import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CycleStatus, Prisma, ScoringFrequency, SysRole } from '@prisma/client';
import { CyclesService } from './cycles.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateCycleDto } from './dto/update-cycle.dto';
import { AuthUser } from '@/common/types/auth.types';
import { plainToInstance } from 'class-transformer';

describe('CyclesService', () => {
  const explicitExemptDeptId = 'c134b614-5d97-4f1c-a72e-0afc6d12eb99';
  const companyFinalApproverId = '88888888-8888-4888-8888-888888888888';
  const creator = {
    id: '11111111-1111-4111-8111-111111111111',
    sysRole: SysRole.hr,
    deptId: null,
    canViewAll: true,
  } as AuthUser;
  const reviewer = {
    ...creator,
    id: '99999999-9999-4999-8999-999999999999',
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
      cyclePeriodSchedule: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999' }),
        findUnique: jest.fn(),
      },
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

  function storedDraft(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cycle-1',
      name: '2027年第一季度',
      type: 'quarterly',
      workflowVersion: 2,
      planVersion: 3,
      scoringFrequency: ScoringFrequency.monthly,
      status: CycleStatus.draft,
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-04-01T00:00:00.000Z'),
      deadlineIndicatorSetting: null,
      deadlineIndicatorConfirm: null,
      deadlineSelfEval: null,
      deadlineManagerScore: null,
      deadlineHrCalibration: null,
      deadlineApproval: null,
      deadlinePublish: null,
      hrOwnerId: creator.id,
      reviewerId: '99999999-9999-4999-8999-999999999999',
      reviewStatus: 'approved',
      reviewedAt: new Date('2026-12-20T00:00:00.000Z'),
      reviewComment: '通过',
      monthlyFollowUpRequired: false,
      participantDeptIds: [],
      participantUserIds: [],
      explicitExemptDeptIds: [],
      explicitExemptUserIds: [],
      notificationMode: 'off',
      publishVisibleFields: {},
      gradeAMaxRatio: new Prisma.Decimal(0.2),
      gradeBMaxRatio: new Prisma.Decimal(0.4),
      gradeCMaxRatio: new Prisma.Decimal(0.3),
      gradeDMaxRatio: new Prisma.Decimal(0.1),
      periodSchedules: [],
      companyFinalApprover: { id: companyFinalApproverId, name: '李宏' },
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

  it('allows a one-day performance period', async () => {
    const day = new Date('2027-01-01T00:00:00.000Z');

    await expect(service.create(quarterlyCycle({ startDate: day, endDate: day }), creator))
      .resolves.toEqual(expect.objectContaining({ id: 'cycle-1' }));
  });

  it('keeps reversed workflow dates saveable as a draft', async () => {
    const dto = quarterlyCycle({
      goalSettingOpenAt: new Date('2027-01-03T09:00:00.000Z'),
      deadlineIndicatorSetting: new Date('2027-01-02T18:00:00.000Z'),
      deadlineIndicatorConfirm: new Date('2027-01-01T18:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-04-03T09:00:00.000Z'),
      deadlineSelfEval: new Date('2027-04-02T18:00:00.000Z'),
      deadlineManagerScore: new Date('2027-04-01T18:00:00.000Z'),
    });

    await expect(service.create(dto, creator))
      .resolves.toEqual(expect.objectContaining({ id: 'cycle-1' }));
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

  it('leaves a new workflow-v2 plan unassigned for the HR administrator review pool', async () => {
    await service.create(quarterlyCycle({ workflowVersion: 2 }), creator);

    const data = prisma.assessmentCycle.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('reviewer');
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
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft());

    await service.updateDraft('cycle-1', {
      expectedPlanVersion: 3,
      explicitExemptDeptIds: [explicitExemptDeptId],
    } as any, creator);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: { id: 'cycle-1', status: CycleStatus.draft, planVersion: 3 },
      data: expect.objectContaining({
        planVersion: { increment: 1 },
        explicitExemptDeptIds: [explicitExemptDeptId],
      }),
    });
  });

  it('selects an eligible HR owner when a system administrator creates without one', async () => {
    const eligibleHrOwnerId = '77777777-7777-4777-8777-777777777777';
    const systemAdministrator = {
      ...creator,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sysRole: SysRole.system_admin,
      hrCapabilities: ['cycle_plan_edit'],
    } as AuthUser;
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: eligibleHrOwnerId })
      .mockResolvedValueOnce({ id: reviewer.id });

    await service.create(quarterlyCycle(), systemAdministrator);

    expect(prisma.user.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        OR: [
          { sysRole: SysRole.hr },
          { sysRole: SysRole.hr_user, hrCapabilities: { has: 'cycle_plan_edit' } },
        ],
        deletedAt: null,
        status: { not: 'resigned' },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        creator: { connect: { id: systemAdministrator.id } },
        hrOwner: { connect: { id: eligibleHrOwnerId } },
      }),
    }));
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
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft({
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
    }));

    await service.updateDraft('cycle-1', { expectedPlanVersion: 3, ...update } as any, creator);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: { id: 'cycle-1', status: CycleStatus.draft, planVersion: 3 },
      data: expect.objectContaining({
        planVersion: { increment: 1 },
        reviewStatus: 'pending',
        reviewedAt: null,
        reviewComment: null,
      }),
    });
    expect(prisma.cyclePeriodSchedule.deleteMany).toHaveBeenCalledWith({ where: { cycleId: 'cycle-1' } });
    expect(prisma.cyclePeriodSchedule.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ cycleId: 'cycle-1' })]),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'cycle_scoring_plan_updated',
        oldValue: expect.objectContaining({ scoringFrequency: ScoringFrequency.monthly }),
        newValue: expect.objectContaining({ changedPeriodKeys: expect.any(Array) }),
      }),
    });
  });

  it('keeps approval metadata and schedules untouched for a semantic API no-op', async () => {
    const schedules = [{
      periodKey: '2027-01',
      periodType: 'month',
      sequence: 1,
      periodStart: new Date('2027-01-01T00:00:00.000Z'),
      periodEnd: new Date('2027-01-31T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-02-01T01:00:00.000Z'),
      selfEvalDueAt: new Date('2027-02-03T10:00:00.000Z'),
      managerDueAt: new Date('2027-02-08T10:00:00.000Z'),
      isException: true,
    }, {
      periodKey: '2027-02',
      periodType: 'month',
      sequence: 2,
      periodStart: new Date('2027-02-01T00:00:00.000Z'),
      periodEnd: new Date('2027-02-28T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-03-01T01:00:00.000Z'),
      selfEvalDueAt: new Date('2027-03-03T10:00:00.000Z'),
      managerDueAt: new Date('2027-03-08T10:00:00.000Z'),
      isException: true,
    }, {
      periodKey: '2027-03',
      periodType: 'month',
      sequence: 3,
      periodStart: new Date('2027-03-01T00:00:00.000Z'),
      periodEnd: new Date('2027-03-31T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-04-01T01:00:00.000Z'),
      selfEvalDueAt: new Date('2027-04-06T10:00:00.000Z'),
      managerDueAt: new Date('2027-04-09T10:00:00.000Z'),
      isException: true,
    }];
    const cycle = storedDraft({
      participantDeptIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      publishVisibleFields: { grade: true, total_score: true },
      periodSchedules: schedules,
    });
    prisma.assessmentCycle.findUnique.mockResolvedValue(cycle);

    const result = await service.updateDraft('cycle-1', plainToInstance(UpdateCycleDto, {
      expectedPlanVersion: 3,
      name: cycle.name,
      startDate: '2027-01-01',
      endDate: '2027-03-31',
      participantDeptIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      publishVisibleFields: { total_score: true, grade: true },
      gradeAMaxRatio: 0.20,
      periodSchedules: schedules.map((schedule) => ({
        periodKey: schedule.periodKey,
        selfEvalOpenAt: schedule.selfEvalOpenAt.toISOString(),
        selfEvalDueAt: schedule.selfEvalDueAt.toISOString(),
        managerDueAt: schedule.managerDueAt.toISOString(),
        isException: schedule.isException,
      })),
    }), creator);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: { id: 'cycle-1', status: CycleStatus.draft, planVersion: 3 },
      data: { planVersion: { increment: 0 } },
    });
    expect(prisma.cyclePeriodSchedule.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      planVersion: 3,
      reviewStatus: 'approved',
      reviewedAt: cycle.reviewedAt,
      periodSchedules: schedules,
      companyFinalApprover: { id: companyFinalApproverId, name: '李宏' },
      reviewFrequency: 'cycle',
    }));
  });

  it('rejects a stale draft update before replacing schedules', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft());

    await expect(service.updateDraft('cycle-1', {
      expectedPlanVersion: 2,
      name: '过期编辑',
    } as any, creator)).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.assessmentCycle.updateMany).not.toHaveBeenCalled();
    expect(prisma.cyclePeriodSchedule.deleteMany).not.toHaveBeenCalled();
  });

  it('lets an HR administrator claim and review an unassigned plan', async () => {
    const cycle = storedDraft({
      reviewerId: null,
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewComment: null,
    });
    prisma.assessmentCycle.findUnique
      .mockResolvedValueOnce(cycle)
      .mockResolvedValueOnce({ ...cycle, reviewerId: reviewer.id, planVersion: 4, reviewStatus: 'approved' });

    const result = await service.review('cycle-1', {
      action: 'approve',
      expectedPlanVersion: 3,
    }, reviewer);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cycle-1',
        status: CycleStatus.draft,
        planVersion: 3,
        reviewerId: null,
        reviewStatus: 'pending',
        reviewedAt: null,
      },
      data: expect.objectContaining({
        planVersion: { increment: 1 },
        reviewerId: reviewer.id,
        reviewStatus: 'approved',
      }),
    });
    expect(result).toEqual(expect.objectContaining({
      planVersion: 4,
      reviewerId: reviewer.id,
      reviewFrequency: 'cycle',
    }));
  });

  it('allows only the assigned business reviewer and returns the full cycle contract', async () => {
    const cycle = storedDraft({ reviewStatus: 'pending', reviewedAt: null, reviewComment: null });
    prisma.assessmentCycle.findUnique
      .mockResolvedValueOnce(cycle)
      .mockResolvedValueOnce({ ...cycle, planVersion: 4, reviewStatus: 'approved' });

    const result = await service.review('cycle-1', {
      action: 'approve',
      expectedPlanVersion: 3,
    }, reviewer);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cycle-1',
        status: CycleStatus.draft,
        planVersion: 3,
        reviewerId: cycle.reviewerId,
        reviewStatus: 'pending',
        reviewedAt: null,
      },
      data: expect.objectContaining({
        planVersion: { increment: 1 },
        reviewStatus: 'approved',
      }),
    });
    expect(result).toEqual(expect.objectContaining({
      planVersion: 4,
      periodSchedules: cycle.periodSchedules,
      companyFinalApprover: cycle.companyFinalApprover,
      reviewFrequency: 'cycle',
    }));
  });

  it('does not let a system administrator bypass the assigned cycle reviewer', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft({ reviewerId: null, reviewStatus: 'pending' }));
    const systemAdministrator = {
      ...creator,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sysRole: SysRole.system_admin,
    } as AuthUser;

    await expect(service.review('cycle-1', {
      action: 'approve',
      expectedPlanVersion: 3,
    }, systemAdministrator)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.assessmentCycle.updateMany).not.toHaveBeenCalled();
  });

  it('returns a clear conflict when the reviewed plan version is stale', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft({ reviewStatus: 'pending' }));

    await expect(service.review('cycle-1', {
      action: 'approve',
      expectedPlanVersion: 2,
    }, reviewer)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.assessmentCycle.updateMany).not.toHaveBeenCalled();
  });

  it('returns a conflict when launch wins the draft-update CAS', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft());
    prisma.assessmentCycle.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateDraft('cycle-1', {
      expectedPlanVersion: 3,
      name: '并发修改',
    } as any, creator)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.cyclePeriodSchedule.deleteMany).not.toHaveBeenCalled();
  });

  it('returns a conflict when another operation wins the review CAS', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft({ reviewStatus: 'pending', reviewedAt: null }));
    prisma.assessmentCycle.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.review('cycle-1', {
      action: 'approve',
      expectedPlanVersion: 3,
    }, reviewer)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
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
    prisma.user.findFirst.mockResolvedValueOnce({ id: companyFinalApproverId });

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

  it('derives monthly follow-up compatibility from monthly scoring for a new workflow-v2 cycle', async () => {
    await service.create(quarterlyCycle({
      workflowVersion: 2,
      scoringFrequency: ScoringFrequency.monthly,
      monthlyFollowUpRequired: false,
      periodSchedules: [{
        periodKey: '2027-01',
        selfEvalOpenAt: '2027-02-01T09:00:00+08:00',
        selfEvalDueAt: '2027-02-03T18:00:00+08:00',
        managerDueAt: '2027-02-08T18:00:00+08:00',
      }],
    } as any), creator);

    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scoringFrequency: ScoringFrequency.monthly,
        monthlyFollowUpRequired: true,
      }),
    }));
  });

  it('derives disabled monthly follow-up compatibility from cycle scoring for a new workflow-v2 cycle', async () => {
    await service.create(quarterlyCycle({
      workflowVersion: 2,
      scoringFrequency: ScoringFrequency.cycle,
      monthlyFollowUpRequired: true,
      periodSchedules: [{
        periodKey: 'cycle',
        selfEvalOpenAt: '2027-04-01T09:00:00+08:00',
        selfEvalDueAt: '2027-04-03T18:00:00+08:00',
        managerDueAt: '2027-04-08T18:00:00+08:00',
      }],
    } as any), creator);

    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scoringFrequency: ScoringFrequency.cycle,
        monthlyFollowUpRequired: false,
      }),
    }));
  });

  it('keeps independent monthly follow-up compatibility for a legacy workflow-v1 cycle', async () => {
    await service.create(quarterlyCycle({
      workflowVersion: 1,
      monthlyFollowUpRequired: true,
    }), creator);

    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workflowVersion: 1,
        monthlyFollowUpRequired: true,
      }),
    }));
  });

  it('repairs monthly follow-up compatibility when an unreviewed workflow-v2 draft is edited', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft({
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewComment: null,
      monthlyFollowUpRequired: false,
    }));

    await service.updateDraft('cycle-1', {
      expectedPlanVersion: 3,
      name: '2027年第一季度（修订）',
    } as any, creator);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: '2027年第一季度（修订）',
        monthlyFollowUpRequired: true,
      }),
    }));
  });

  it('preserves an approved historical workflow-v2 compatibility value during an unrelated edit', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft({
      scoringFrequency: ScoringFrequency.monthly,
      monthlyFollowUpRequired: false,
    }));

    await service.updateDraft('cycle-1', {
      expectedPlanVersion: 3,
      name: '2027年第一季度（更名）',
    } as any, creator);

    const data = prisma.assessmentCycle.updateMany.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ name: '2027年第一季度（更名）' }));
    expect(data).not.toHaveProperty('monthlyFollowUpRequired');
  });

  it('synchronizes monthly follow-up compatibility when an approved workflow-v2 scoring mode changes', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft({
      scoringFrequency: ScoringFrequency.monthly,
      monthlyFollowUpRequired: true,
    }));

    await service.updateDraft('cycle-1', {
      expectedPlanVersion: 3,
      scoringFrequency: ScoringFrequency.cycle,
    } as any, creator);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scoringFrequency: ScoringFrequency.cycle,
        monthlyFollowUpRequired: false,
        reviewStatus: 'pending',
      }),
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

  it('does not expose the frozen organization roster through general cycle details', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      status: 'indicator_setting',
      deadlineIndicatorSetting: null,
      deadlineIndicatorConfirm: null,
      launchPlan: { participants: [{ employeeId: 'other-employee', employeeName: '其他员工' }] },
      launchPlanHash: 'private-plan-hash',
    });
    prisma.assessmentTask.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.assessmentTask.groupBy.mockResolvedValue([]);
    prisma.assessmentTemplateSnapshot.count.mockResolvedValue(1);
    const employee = { ...creator, id: 'employee-1', sysRole: SysRole.employee } as AuthUser;

    const result = await service.findOne('cycle-1', employee);

    expect(result).not.toHaveProperty('launchPlan');
    expect(result).not.toHaveProperty('launchPlanHash');
  });

  it('returns the launched participant record from the frozen plan with actual task dispositions', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      openedAt: new Date('2026-08-30T02:51:22.695Z'),
      openedById: creator.id,
      openSource: 'manual',
      launchPlan: {
        participants: [
          {
            employeeId: 'employee-active', employeeName: '俞丹',
            deptId: 'hr-team', deptName: '人事组',
            managerId: 'manager-1', managerName: '姚瑶',
            participantDisposition: 'active', isExempt: false, exemptReason: null,
          },
          {
            employeeId: 'employee-exempt', employeeName: '方园',
            deptId: 'hr-team', deptName: '人事组',
            managerId: 'manager-1', managerName: '俞丹',
            participantDisposition: 'cycle_exempt', isExempt: true,
            exemptReason: '发起检查时的豁免原因',
          },
        ],
      },
    });
    prisma.assessmentTask.findMany.mockResolvedValue([
      {
        employeeId: 'employee-active', status: 'indicator_drafting', isExempt: false,
        participantDisposition: 'active', exemptReason: null,
      },
      {
        employeeId: 'employee-exempt', status: 'exempted', isExempt: true,
        participantDisposition: 'cycle_exempt', exemptReason: 'HR 按部门设置为本周期豁免',
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({ id: creator.id, name: '姚瑶' });

    const participantRecords = service as unknown as {
      findParticipantRecord: (cycleId: string) => Promise<unknown>;
    };
    await expect(Promise.resolve().then(() => participantRecords.findParticipantRecord('cycle-1'))).resolves.toEqual({
      cycleId: 'cycle-1',
      recordedAt: new Date('2026-08-30T02:51:22.695Z'),
      source: 'manual',
      operator: { id: creator.id, name: '姚瑶' },
      summary: { total: 2, active: 1, exempted: 1 },
      participants: [
        expect.objectContaining({
          employeeId: 'employee-active', employeeName: '俞丹',
          participantDisposition: 'active', status: 'indicator_drafting',
        }),
        expect.objectContaining({
          employeeId: 'employee-exempt', employeeName: '方园', deptName: '人事组',
          participantDisposition: 'cycle_exempt', status: 'exempted',
          exemptReason: 'HR 按部门设置为本周期豁免',
        }),
      ],
    });
    expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith({
      where: { cycleId: 'cycle-1' },
      select: {
        employeeId: true,
        status: true,
        isExempt: true,
        participantDisposition: true,
        exemptReason: true,
      },
    });
  });

  it('requires schedule cancellation before deadlines can be changed', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', status: 'scheduled', planVersion: 3 });

    await expect(service.updateDeadlines('cycle-1', {
      expectedPlanVersion: 3,
      deadlineIndicatorSetting: new Date('2026-12-28T00:00:00.000Z'),
    }, creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('取消预约') },
    });
  });

  it('uses a status CAS so concurrent scheduling cannot race a deadline update', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue(storedDraft({
      deadlineIndicatorSetting: new Date('2026-12-20T00:00:00.000Z'),
    }));
    prisma.assessmentCycle.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateDeadlines('cycle-1', {
      expectedPlanVersion: 3,
      deadlineIndicatorSetting: new Date('2026-12-21T00:00:00.000Z'),
    }, creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('刷新后重试') },
    });
    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cycle-1', status: 'draft', planVersion: 3 },
    }));
  });

  it('preserves approval and plan version for a semantic deadline no-op', async () => {
    const cycle = storedDraft({
      deadlineIndicatorSetting: new Date('2026-12-20T00:00:00.000Z'),
    });
    prisma.assessmentCycle.findUnique.mockResolvedValue(cycle);

    const result = await service.updateDeadlines('cycle-1', {
      expectedPlanVersion: 3,
      deadlineIndicatorSetting: new Date('2026-12-20T00:00:00.000Z'),
    }, creator);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: { id: 'cycle-1', status: 'draft', planVersion: 3 },
      data: { planVersion: { increment: 0 } },
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      planVersion: 3,
      reviewStatus: 'approved',
      periodSchedules: cycle.periodSchedules,
      companyFinalApprover: cycle.companyFinalApprover,
    }));
  });

  it('increments plan version and resets review metadata for a real draft deadline change', async () => {
    const cycle = storedDraft({
      deadlineIndicatorSetting: new Date('2026-12-20T00:00:00.000Z'),
    });
    const updated = {
      ...cycle,
      planVersion: 4,
      deadlineIndicatorSetting: new Date('2026-12-21T00:00:00.000Z'),
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewComment: null,
    };
    prisma.assessmentCycle.findUnique
      .mockResolvedValueOnce(cycle)
      .mockResolvedValueOnce(updated);

    const result = await service.updateDeadlines('cycle-1', {
      expectedPlanVersion: 3,
      deadlineIndicatorSetting: updated.deadlineIndicatorSetting,
    }, creator);

    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: { id: 'cycle-1', status: 'draft', planVersion: 3 },
      data: expect.objectContaining({
        deadlineIndicatorSetting: updated.deadlineIndicatorSetting,
        planVersion: { increment: 1 },
        reviewStatus: 'pending',
        reviewedAt: null,
        reviewComment: null,
      }),
    });
    expect(result).toEqual(expect.objectContaining({
      planVersion: 4,
      reviewStatus: 'pending',
      periodSchedules: cycle.periodSchedules,
      companyFinalApprover: cycle.companyFinalApprover,
      reviewFrequency: 'cycle',
    }));
  });
});
