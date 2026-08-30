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

  const tx = {
    assessmentPeriod: { updateMany: jest.fn(), update: jest.fn() },
    assessmentPeriodIndicatorReview: { upsert: jest.fn(), updateMany: jest.fn() },
    assessmentPeriodReviewRevision: { count: jest.fn(), create: jest.fn() },
    indicatorProgressUpdate: { create: jest.fn() },
    assessmentTask: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    flowRecord: { create: jest.fn() },
  };
  const prisma = {
    assessmentPeriod: { findUnique: jest.fn(), findMany: jest.fn() },
    assessmentPeriodReviewRevision: { findUnique: jest.fn() },
    indicatorInstance: { findMany: jest.fn() },
    $transaction: jest.fn(async (handler: (client: typeof tx) => unknown) => handler(tx)),
  };
  const notifications = { create: jest.fn() };
  const aggregation = { refreshTask: jest.fn() };
  const service: PeriodReviewsService = new (PeriodReviewsService as any)(
    prisma,
    notifications,
    aggregation,
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
        statusLabel: '员工复盘与自评',
      },
      permissions: { canEditEmployee: true, canEditManager: false },
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        name: '完成签约目标',
        scoringStandard: '完成率达到100%',
        problemReason: '',
        nextMonthPlan: '完成剩余客户签约',
        supportNeeded: '需要法务支持',
        latestProgress: { progress: 65, healthStatus: 'on_track' },
        alignedObjectives: [{ id: 'objective-1', title: '公司年度增长', level: 'company' }],
        history: [{ periodKey: '2026-12', progress: 60, managerScore: 78 }],
      }],
    });
  });

  it('saves optional per-goal reflection fields under an optimistic draft version', async () => {
    const result = await service.saveEmployeeDraft(period.id, {
      expectedVersion: 2,
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        progress: 80,
        healthStatus: 'on_track',
        selfScore: 88,
        problemReason: '',
        nextMonthPlan: '完成收尾',
        supportNeeded: '无需支持',
      }],
    }, employee);

    expect(tx.assessmentPeriod.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: period.id, draftVersion: 2, managerSubmittedAt: null }),
      data: { draftVersion: { increment: 1 } },
    }));
    expect(tx.assessmentPeriodIndicatorReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ nextMonthPlan: '完成收尾', supportNeeded: '无需支持' }),
    }));
    expect(result).toMatchObject({ periodId: period.id, draftVersion: 3 });
    expect(tx.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it('submits progress and self evaluation atomically with the optional fields', async () => {
    const result = await service.submitEmployeeReview(period.id, {
      expectedVersion: 2,
      idempotencyKey: '13131313-1313-4313-8313-131313131313',
      indicators: [{
        indicatorVersionItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        progress: 80,
        healthStatus: 'on_track',
        actualValueText: '已签约800万元',
        selfScore: 88,
        problemReason: '一个客户审批延期',
        nextMonthPlan: '完成尾款签署',
        supportNeeded: '',
      }],
    }, employee);

    expect(tx.indicatorProgressUpdate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        indicatorInstanceId: '12121212-1212-4212-8212-121212121212',
        periodId: period.id,
        periodReviewRevisionId: '14141414-1414-4414-8414-141414141414',
        progress: 80,
        content: expect.stringContaining('完成度 80%'),
      }),
    });
    expect(tx.assessmentPeriodReviewRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stage: 'employee',
        idempotencyKey: '13131313-1313-4313-8313-131313131313',
        snapshot: expect.objectContaining({ indicators: [expect.objectContaining({ nextMonthPlan: '完成尾款签署' })] }),
      }),
    });
    expect(tx.assessmentPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'manager_scoring', selfScoreTotal: 88 }),
    }));
    expect(result).toMatchObject({ periodId: period.id, status: 'manager_scoring', draftVersion: 3 });
    expect(notifications.create).not.toHaveBeenCalled();
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
});
