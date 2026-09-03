import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { PeriodReviewsService } from './period-reviews.service';

describe('PeriodReviewsService', () => {
  const employee: AuthUser = {
    id: '11111111-1111-4111-8111-111111111111',
    name: '方园',
    sysRole: SysRole.employee,
    deptId: '22222222-2222-4222-8222-222222222222',
    isAssessorOnly: false,
    canViewAll: false,
  };
  const outsider = { ...employee, id: '99999999-9999-4999-8999-999999999999' };
  const manager: AuthUser = {
    ...employee,
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    name: '王主管',
    sysRole: SysRole.manager,
  };
  const hrAdmin: AuthUser = {
    ...employee,
    id: '33333333-3333-4333-8333-333333333333',
    name: 'HR管理员',
    sysRole: SysRole.hr,
  };
  const capableHr: AuthUser = {
    ...employee,
    id: '44444444-4444-4444-8444-444444444444',
    name: '周期HR',
    sysRole: SysRole.hr_user,
    hrCapabilities: ['cycle_plan_edit'],
  };

  const tx = {
    assessmentPeriod: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    assessmentPeriodIndicatorReview: { upsert: jest.fn(), updateMany: jest.fn() },
    assessmentPeriodReviewRevision: { count: jest.fn(), create: jest.fn() },
    indicatorProgressUpdate: { create: jest.fn() },
    assessmentTask: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    flowRecord: { create: jest.fn() },
    gradeResult: { updateMany: jest.fn() },
  };
  const prisma = {
    assessmentPeriod: { findUnique: jest.fn(), findMany: jest.fn() },
    assessmentPeriodReviewRevision: { findUnique: jest.fn() },
    indicatorInstance: { findMany: jest.fn() },
    $transaction: jest.fn(async (handler: (client: typeof tx) => unknown) => handler(tx)),
  };
  const notifications = { create: jest.fn() };
  const aggregation = { refreshTask: jest.fn() };
  const flow = { reopenPeriodTx: jest.fn() };
  const service: PeriodReviewsService = new (PeriodReviewsService as any)(
    prisma,
    notifications,
    aggregation,
    flow,
  );

  const period = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    periodKey: '2027-01',
    periodType: 'month',
    sequence: 1,
    periodStart: new Date('2027-01-01T00:00:00.000Z'),
    periodEnd: new Date('2027-01-31T00:00:00.000Z'),
    selfEvalOpenAt: new Date('2027-02-01T01:00:00.000Z'),
    selfEvalDueAt: new Date('2027-02-03T10:00:00.000Z'),
    managerDueAt: new Date('2027-02-08T10:00:00.000Z'),
    managerId: manager.id,
    status: 'self_eval',
    draftVersion: 2,
    employeeSubmittedAt: null,
    managerSubmittedAt: null,
    selfScoreTotal: null,
    managerScoreTotal: null,
    task: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      cycleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      employeeId: employee.id,
      managerId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      deptId: employee.deptId,
      employee: { id: employee.id, name: '方园', employeeNo: 'FY001' },
      manager: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: '王主管' },
      dept: { id: employee.deptId, name: '销售部' },
      cycle: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: '2027 Q1', notificationMode: 'off' },
    },
    indicatorVersion: {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      items: [{
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        sourceInstanceId: '12121212-1212-4212-8212-121212121212',
        name: '完成签约目标',
        description: '完成重点客户签约',
        scoringStandard: '完成率达到100%',
        targetValue: null,
        targetValueText: '1000万元',
        unit: '万元',
        weight: new Prisma.Decimal(1),
        indicatorType: 'kpi',
        dimensionName: '业绩',
        dimensionWeight: new Prisma.Decimal(1),
        sortOrder: 0,
      }],
    },
    indicatorReviews: [{
      indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      progress: 70,
      healthStatus: 'on_track',
      actualValueText: '已签约700万元',
      employeeComment: '重点客户按计划推进',
      problemReason: '',
      nextMonthPlan: '完成剩余客户签约',
      supportNeeded: '需要法务支持',
      employeeAttachments: [],
      selfScore: new Prisma.Decimal(82),
      managerScore: null,
      managerComment: null,
    }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.assessmentPeriod.findUnique.mockResolvedValue(period);
    prisma.assessmentPeriod.findMany.mockResolvedValue([{
      id: 'previous-period',
      periodKey: '2026-12',
      indicatorReviews: [{
        indicatorVersionItemId: 'previous-item',
        actualValueText: '上月完成600万元',
        progress: 60,
        healthStatus: 'at_risk',
        selfScore: new Prisma.Decimal(75),
        managerScore: new Prisma.Decimal(78),
      }],
      indicatorVersion: { items: [{ id: 'previous-item', sourceInstanceId: '12121212-1212-4212-8212-121212121212' }] },
    }]);
    prisma.indicatorInstance.findMany.mockResolvedValue([{
      id: '12121212-1212-4212-8212-121212121212',
      objectiveAlignments: [{ objective: { id: 'objective-1', title: '公司年度增长', level: 'company' } }],
      progressUpdates: [{
        progress: 65,
        healthStatus: 'on_track',
        content: '已推进核心客户',
        attachments: [],
        createdAt: new Date('2027-01-20T08:00:00.000Z'),
      }],
    }]);
    prisma.assessmentPeriodReviewRevision.findUnique.mockResolvedValue(null);
    tx.assessmentPeriod.updateMany.mockResolvedValue({ count: 1 });
    tx.gradeResult.updateMany.mockResolvedValue({ count: 1 });
    tx.assessmentPeriodReviewRevision.count.mockResolvedValue(0);
    tx.assessmentPeriodReviewRevision.create.mockResolvedValue({
      id: '14141414-1414-4414-8414-141414141414',
    });
    aggregation.refreshTask.mockResolvedValue({ complete: false, score: null, targetStatus: null });
    tx.assessmentPeriod.update.mockResolvedValue({ ...period, draftVersion: 3 });
  });

  it('returns the page header, frozen goal reference, current draft, history, and alignments', async () => {
    const result = await service.getReview(period.id, employee);

    expect(result).toMatchObject({
      period: { id: period.id, periodKey: '2027-01', draftVersion: 2 },
      context: {
        cycleName: '2027 Q1',
        employeeName: '方园',
        deptName: '销售部',
        managerName: '王主管',
        statusLabel: '员工自评',
      },
      permissions: { canEditEmployee: true, canEditManager: false },
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        name: '完成签约目标',
        scoringStandard: '完成率达到100%',
        isScoreRequired: true,
        monthlyProgressSource: 'draft_or_result',
        problemReason: '',
        nextMonthPlan: '完成剩余客户签约',
        supportNeeded: '需要法务支持',
        latestProgress: { progress: 65, healthStatus: 'on_track' },
        alignedObjectives: [{ id: 'objective-1', title: '公司年度增长', level: 'company' }],
        history: [{ periodKey: '2026-12', progress: 60, managerScore: 78 }],
      }],
    });
  });

  it('prefills an untouched month from the latest active progress in the same Shanghai month', async () => {
    prisma.assessmentPeriod.findUnique.mockResolvedValue({
      ...period,
      indicatorReviews: [],
    });

    const result = await service.getReview(period.id, employee);

    expect(prisma.indicatorInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          progressUpdates: expect.objectContaining({
            where: expect.objectContaining({
              periodId: null,
              createdAt: expect.objectContaining({
                gte: new Date('2026-12-31T16:00:00.000Z'),
                lt: new Date('2027-01-31T16:00:00.000Z'),
              }),
            }),
          }),
        }),
      }),
    );
    expect(result.indicators[0]).toMatchObject({
      progress: 65,
      healthStatus: 'on_track',
      employeeComment: '已推进核心客户',
      monthlyProgressSource: 'active_progress',
      selfScore: null,
    });
  });

  it('leaves monthly progress blank when the employee made no same-month update', async () => {
    prisma.assessmentPeriod.findUnique.mockResolvedValue({
      ...period,
      indicatorReviews: [],
    });
    prisma.indicatorInstance.findMany.mockResolvedValue([{
      id: '12121212-1212-4212-8212-121212121212',
      objectiveAlignments: [],
      progressUpdates: [],
    }]);

    const result = await service.getReview(period.id, employee);

    expect(result.indicators[0]).toMatchObject({
      progress: null,
      healthStatus: null,
      employeeComment: null,
      monthlyProgressSource: 'none',
    });
  });

  it('saves the lightweight monthly fields under an optimistic draft version without overwriting legacy fields', async () => {
    const result = await service.saveEmployeeDraft(period.id, {
      expectedVersion: 2,
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        progress: 80,
        healthStatus: 'on_track',
        employeeComment: '本月完成重点客户签约',
        selfScore: 88,
      }],
    }, employee);

    expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: period.id, draftVersion: 2, managerSubmittedAt: null }),
      data: { draftVersion: { increment: 1 } },
    }));
    expect(tx.assessmentPeriodIndicatorReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: {
        progress: 80,
        healthStatus: 'on_track',
        employeeComment: '本月完成重点客户签约',
        selfScore: 88,
      },
    }));
    expect(result).toMatchObject({ periodId: period.id, draftVersion: 3 });
    expect(tx.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it('submits lightweight progress and self evaluation atomically', async () => {
    const result = await service.submitEmployeeReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '13131313-1313-4313-8313-131313131313',
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        progress: 80,
        healthStatus: 'on_track',
        employeeComment: '完成尾款签署',
        selfScore: 88,
      }],
    }, employee);

    expect(tx.indicatorProgressUpdate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        indicatorInstanceId: '12121212-1212-4212-8212-121212121212',
        periodId: period.id,
        periodReviewRevisionId: '14141414-1414-4414-8414-141414141414',
        progress: 80,
        content: '完成尾款签署',
        attachments: [],
      }),
    });
    expect(tx.assessmentPeriodReviewRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stage: 'employee',
        idempotencyKey: '13131313-1313-4313-8313-131313131313',
        snapshot: expect.objectContaining({ indicators: [expect.objectContaining({ employeeComment: '完成尾款签署' })] }),
      }),
    });
    expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'manager_scoring', selfScoreTotal: 88 }),
    }));
    expect(result).toMatchObject({ periodId: period.id, status: 'manager_scoring', draftVersion: 3 });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it.each([
    { progress: null, healthStatus: null, employeeComment: '仅填写本月结果描述' },
    { progress: 73, healthStatus: null, employeeComment: null },
    { progress: null, healthStatus: 'at_risk' as const, employeeComment: null },
  ])('keeps each partially completed monthly result in the goal history: %o', async (partial) => {
    await service.submitEmployeeReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '21212121-2121-4121-8121-212121212121',
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        selfScore: 88,
        ...partial,
      }],
    }, employee);

    expect(tx.indicatorProgressUpdate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        indicatorInstanceId: '12121212-1212-4212-8212-121212121212',
        periodId: period.id,
        progress: partial.progress,
        healthStatus: partial.healthStatus,
        content: partial.employeeComment ?? '',
      }),
    });
  });

  it('requires scores only for positive-weight indicators and accepts empty monthly progress', async () => {
    const zeroWeightItem = {
      ...period.indicatorVersion.items[0],
      id: 'abababab-abab-4bab-8bab-abababababab',
      sourceInstanceId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
      name: '观察项',
      weight: new Prisma.Decimal(0),
      sortOrder: 1,
    };
    prisma.assessmentPeriod.findUnique.mockResolvedValue({
      ...period,
      indicatorVersion: {
        ...period.indicatorVersion,
        items: [...period.indicatorVersion.items, zeroWeightItem],
      },
      indicatorReviews: [],
    });

    await expect(service.submitEmployeeReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '17171717-1717-4717-8717-171717171717',
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        progress: null,
        healthStatus: null,
        employeeComment: null,
        selfScore: 91,
      }, {
        indicatorVersionItemId: zeroWeightItem.id,
        progress: null,
        healthStatus: null,
        employeeComment: null,
        selfScore: null,
      }],
    }, employee)).resolves.toMatchObject({ status: 'manager_scoring' });

    expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ selfScoreTotal: 91 }),
    }));
    expect(tx.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it('rejects an employee submission missing a positive-weight self score', async () => {
    await expect(service.submitEmployeeReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '18181818-1818-4818-8818-181818181818',
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        progress: null,
        healthStatus: null,
        employeeComment: null,
        selfScore: null,
      }],
    }, employee)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unrelated employees and stale draft versions', async () => {
    await expect(service.getReview(period.id, outsider)).rejects.toBeInstanceOf(ForbiddenException);
    tx.assessmentPeriod.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.saveEmployeeDraft(period.id, {
      expectedVersion: 1,
      indicators: [],
    }, employee)).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets only the frozen direct manager save a manager score draft', async () => {
    prisma.assessmentPeriod.findUnique.mockResolvedValue({
      ...period,
      status: 'manager_scoring',
      employeeSubmittedAt: new Date('2027-02-02T08:00:00.000Z'),
    });

    const result = await (service as any).saveManagerDraft(period.id, {
      expectedVersion: 2,
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        managerScore: 90,
        managerComment: '交付质量良好',
      }],
    }, manager);

    expect(tx.assessmentPeriodIndicatorReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { managerScore: 90, managerComment: '交付质量良好' },
    }));
    expect(result).toMatchObject({ periodId: period.id, status: 'manager_scoring', draftVersion: 3 });
    await expect((service as any).saveManagerDraft(period.id, {
      expectedVersion: 2,
      indicators: [],
    }, outsider)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let the frozen manager save or submit before the employee submits', async () => {
    prisma.assessmentPeriod.findUnique.mockResolvedValue({
      ...period,
      status: 'manager_scoring',
      employeeSubmittedAt: null,
    });

    await expect((service as any).saveManagerDraft(period.id, {
      expectedVersion: 2,
      indicators: [],
    }, manager)).rejects.toBeInstanceOf(ConflictException);
    await expect((service as any).submitManagerReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '19191919-1919-4919-8919-191919191919',
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        managerScore: 90,
      }],
    }, manager)).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns an employee submission without deleting its formal revision', async () => {
    prisma.assessmentPeriod.findUnique.mockResolvedValue({
      ...period,
      status: 'manager_scoring',
      employeeSubmittedAt: new Date('2027-02-02T08:00:00.000Z'),
    });

    const result = await (service as any).returnManagerReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '15151515-1515-4515-8515-151515151515',
      reason: '请补充关键结果证明',
    }, manager);

    expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'self_eval', employeeSubmittedAt: null }),
    }));
    expect(result).toMatchObject({ status: 'self_eval', draftVersion: 3 });
  });

  it('submits complete manager scores, locks the period, and refreshes the parent task', async () => {
    prisma.assessmentPeriod.findUnique.mockResolvedValue({
      ...period,
      status: 'manager_scoring',
      employeeSubmittedAt: new Date('2027-02-02T08:00:00.000Z'),
    });

    const result = await (service as any).submitManagerReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '16161616-1616-4616-8616-161616161616',
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        managerScore: 90,
        managerComment: '',
      }],
    }, manager);

    expect(tx.assessmentPeriodReviewRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ stage: 'manager', idempotencyKey: '16161616-1616-4616-8616-161616161616' }),
    });
    expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', managerScoreTotal: 90, lockedAt: expect.any(Date) }),
    }));
    expect(aggregation.refreshTask).toHaveBeenCalledWith(period.taskId, tx, manager.id);
    expect(result).toMatchObject({ status: 'completed', draftVersion: 3 });
  });

  it('requires manager scores only for positive-weight indicators', async () => {
    const zeroWeightItem = {
      ...period.indicatorVersion.items[0],
      id: 'abababab-abab-4bab-8bab-abababababab',
      sourceInstanceId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
      name: '观察项',
      weight: new Prisma.Decimal(0),
      sortOrder: 1,
    };
    prisma.assessmentPeriod.findUnique.mockResolvedValue({
      ...period,
      status: 'manager_scoring',
      employeeSubmittedAt: new Date('2027-02-02T08:00:00.000Z'),
      indicatorVersion: {
        ...period.indicatorVersion,
        items: [...period.indicatorVersion.items, zeroWeightItem],
      },
    });

    await expect((service as any).submitManagerReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '20202020-2020-4020-8020-202020202020',
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        managerScore: 87,
      }, {
        indicatorVersionItemId: zeroWeightItem.id,
        managerScore: null,
      }],
    }, manager)).resolves.toMatchObject({ status: 'completed' });

    expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ managerScoreTotal: 87 }),
    }));
    expect(tx.assessmentPeriodIndicatorReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { managerScore: null, managerComment: null } }),
    );
  });

  describe('重新开放月度自评', () => {
    const lockedPeriod = {
      ...period,
      status: 'completed',
      draftVersion: 5,
      employeeSubmittedAt: new Date('2027-02-02T08:00:00.000Z'),
      managerSubmittedAt: new Date('2027-02-04T08:00:00.000Z'),
      lockedAt: new Date('2027-02-04T08:00:00.000Z'),
      selfScoreTotal: new Prisma.Decimal(88),
      managerScoreTotal: new Prisma.Decimal(90),
      task: {
        ...period.task,
        status: 'hr_calibration',
        publishedAt: null,
        selfEvalSubmittedAt: new Date('2027-02-02T08:00:00.000Z'),
        managerScoredAt: new Date('2027-02-04T08:00:00.000Z'),
        deptReviewedAt: new Date('2027-02-05T08:00:00.000Z'),
        hrCalibratedAt: null,
        approvedAt: null,
        cycle: { ...period.task.cycle, publishedAt: null },
        gradeResult: {
          isPublished: false,
          publishedAt: null,
          calculatedScore: new Prisma.Decimal(90),
          rawGrade: 'A',
          calibratedGrade: 'A',
        },
      },
    };

    beforeEach(() => {
      tx.assessmentPeriod.findUnique.mockResolvedValue(lockedPeriod);
      tx.assessmentPeriod.update.mockResolvedValue({ ...lockedPeriod, status: 'self_eval', draftVersion: 6 });
      flow.reopenPeriodTx.mockResolvedValue({ oldStatus: 'hr_calibration', newStatus: 'self_eval' });
    });

    it.each([capableHr, hrAdmin, { ...hrAdmin, id: '55555555-5555-4555-8555-555555555555', sysRole: SysRole.system_admin }])(
      '允许 $name 重新开放已锁定月份',
      async (viewer) => {
        await expect((service as any).reopenPeriodReview(period.id, {
          expectedVersion: 5,
          reason: '员工需要修正本月自评分',
        }, viewer)).resolves.toMatchObject({
          periodId: period.id,
          status: 'self_eval',
          draftVersion: 6,
        });
      },
    );

    it('拒绝无周期管理编辑权限的HR和普通员工', async () => {
      const reviewOnly = { ...capableHr, hrCapabilities: ['cycle_plan_review'] };
      await expect((service as any).reopenPeriodReview(period.id, {
        expectedVersion: 5,
        reason: '修正',
      }, reviewOnly)).rejects.toBeInstanceOf(ForbiddenException);
      await expect((service as any).reopenPeriodReview(period.id, {
        expectedVersion: 5,
        reason: '修正',
      }, employee)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('结果任一层已经公示时拒绝重新开放', async () => {
      tx.assessmentPeriod.findUnique.mockResolvedValue({
        ...lockedPeriod,
        task: {
          ...lockedPeriod.task,
          gradeResult: { ...lockedPeriod.task.gradeResult, isPublished: true },
        },
      });

      await expect((service as any).reopenPeriodReview(period.id, {
        expectedVersion: 5,
        reason: '修正',
      }, capableHr)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.assessmentPeriod.updateMany).not.toHaveBeenCalled();
    });

    it('只重置当前结果，保留员工内容和正式修订，并记录撤回原因', async () => {
      const result = await (service as any).reopenPeriodReview(period.id, {
        expectedVersion: 5,
        reason: '  员工需要修正本月自评分  ',
      }, capableHr);

      expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith({
        where: {
          id: period.id,
          draftVersion: 5,
          status: 'completed',
          managerSubmittedAt: { not: null },
          lockedAt: { not: null },
        },
        data: { draftVersion: { increment: 1 } },
      });
      expect(tx.assessmentPeriodIndicatorReview.updateMany).toHaveBeenCalledWith({
        where: { periodId: period.id },
        data: { managerScore: null, managerComment: null },
      });
      expect(tx.assessmentPeriod.update).toHaveBeenCalledWith({
        where: { id: period.id },
        data: {
          status: 'self_eval',
          employeeSubmittedAt: null,
          managerSubmittedAt: null,
          lockedAt: null,
          selfScoreTotal: null,
          managerScoreTotal: null,
        },
      });
      expect(flow.reopenPeriodTx).toHaveBeenCalledWith(tx, expect.objectContaining({
        actorId: capableHr.id,
        reason: '员工需要修正本月自评分',
        periodId: period.id,
        periodKey: '2027-01',
        taskUpdate: expect.objectContaining({
          selfEvalSubmittedAt: null,
          managerScoredAt: null,
          deptReviewedAt: null,
          hrCalibratedAt: null,
          approvedAt: null,
        }),
      }));
      expect(tx.gradeResult.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { taskId: period.taskId, isPublished: false },
        data: expect.objectContaining({
          calculatedScore: null,
          rawGrade: null,
          calibratedGrade: null,
          coefficient: null,
          isVeto: false,
        }),
      }));
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: capableHr.id,
          action: 'monthly_self_evaluation_reopened',
          entityId: period.id,
          oldValue: expect.objectContaining({ status: 'completed', selfScoreTotal: 88, managerScoreTotal: 90 }),
          newValue: expect.objectContaining({ status: 'self_eval', reason: '员工需要修正本月自评分' }),
        }),
      });
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
        dedupeKey: `period-reopened:${period.id}:6:${employee.id}`,
        userId: employee.id,
        title: '月度自评已重新开放',
      }));
      expect(result).toMatchObject({ status: 'self_eval', draftVersion: 6 });
      expect((tx.assessmentPeriodReviewRevision as any).deleteMany).toBeUndefined();
    });

    it('版本过期时不撤回流程或发送通知', async () => {
      tx.assessmentPeriod.updateMany.mockResolvedValue({ count: 0 });
      await expect((service as any).reopenPeriodReview(period.id, {
        expectedVersion: 4,
        reason: '修正',
      }, capableHr)).rejects.toBeInstanceOf(ConflictException);
      expect(flow.reopenPeriodTx).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });
});
