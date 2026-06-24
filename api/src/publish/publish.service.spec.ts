import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AssessmentCycle, AssessmentTask, Prisma, TaskStatus } from '@prisma/client';
import { PublishService, calcAppealDeadline } from './publish.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FlowService } from '@/tasks/flow.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';

function makeViewer(): AuthUser {
  return {
    id: 'hr-1',
    name: 'HR',
    sysRole: 'hr' as any,
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
  };
}

function makeCycle(overrides?: Partial<AssessmentCycle>): AssessmentCycle {
  return {
    id: 'cycle-1',
    name: '2026 Q1',
    type: 'quarterly' as any,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-03-31'),
    deadlineIndicatorSetting: null,
    deadlineIndicatorConfirm: null,
    deadlineSelfEval: null,
    deadlineManagerScore: null,
    deadlineHrCalibration: null,
    deadlineApproval: null,
    deadlinePublish: null,
    deadlineAppeal: null,
    status: 'approval' as any,
    publishVisibleFields: {},
    gradeAMaxRatio: new Prisma.Decimal(0.2),
    gradeBMaxRatio: new Prisma.Decimal(0.4),
    gradeCMaxRatio: new Prisma.Decimal(0.3),
    gradeDMaxRatio: new Prisma.Decimal(0.1),
    createdBy: null,
    publishedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AssessmentCycle;
}

function makeTask(
  status: TaskStatus,
  approvedAt?: Date | null,
  overrides?: Partial<AssessmentTask>,
  gradeResult?: { calibratedGrade?: string | null; rawGrade?: string | null },
): AssessmentTask {
  return {
    id: 'task-1',
    cycleId: 'cycle-1',
    snapshotId: 'snap-1',
    employeeId: 'emp-1',
    deptId: 'dept-1',
    managerId: 'mgr-1',
    deptHeadId: 'head-1',
    approverId: 'vp-1',
    status,
    isExempt: false,
    exemptReason: null,
    indicatorSetAt: null,
    indicatorConfirmedAt: null,
    selfEvalSubmittedAt: null,
    managerScoredAt: null,
    deptReviewedAt: null,
    hrCalibratedAt: null,
    approvedAt: null,
    publishedAt: null,
    employeeConfirmedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    gradeResult: {
      approvedAt,
      calibratedGrade: (gradeResult?.calibratedGrade ?? null) as any,
      rawGrade: (gradeResult?.rawGrade ?? null) as any,
    },
    ...overrides,
  } as AssessmentTask;
}

describe('calcAppealDeadline', () => {
  it('基于 publishedAt + appealWindowDays 天', () => {
    const publishedAt = new Date('2026-04-05T10:00:00Z');
    const cycle = makeCycle();

    const deadline = calcAppealDeadline(publishedAt, cycle, 30);

    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(4); // 5 月
    expect(deadline.getDate()).toBe(5);
  });

  it('使用配置天数（如 15 天）', () => {
    const publishedAt = new Date('2026-04-05T10:00:00Z');
    const cycle = makeCycle();

    const deadline = calcAppealDeadline(publishedAt, cycle, 15);

    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(3); // 4 月
    expect(deadline.getDate()).toBe(20);
  });

  it('已有 cycle.deadlineAppeal 更晚时取 max', () => {
    const publishedAt = new Date('2026-04-05T10:00:00Z');
    const cycle = makeCycle({ deadlineAppeal: new Date('2026-06-01') });

    const deadline = calcAppealDeadline(publishedAt, cycle, 30);

    expect(deadline.toDateString()).toBe(new Date('2026-06-01').toDateString());
  });
});

describe('PublishService', () => {
  let service: PublishService;
  let prisma: any;
  let flowService: Partial<FlowService>;
  let notificationsService: Partial<NotificationsService>;
  let tx: any;

  beforeEach(async () => {
    tx = {
      assessmentCycle: { update: jest.fn() },
      assessmentTask: { update: jest.fn(), count: jest.fn() },
      flowRecord: { create: jest.fn() },
      gradeResult: { updateMany: jest.fn() },
      performanceInterview: { upsert: jest.fn() },
      improvementPlan: { upsert: jest.fn() },
    };

    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      assessmentCycle: { findUnique: jest.fn() },
      assessmentTask: { findMany: jest.fn() },
      systemConfig: { findUnique: jest.fn() },
    };

    flowService = {
      transitionTx: jest.fn(),
    };

    notificationsService = {
      sendResultPublished: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishService,
        { provide: PrismaService, useValue: prisma },
        { provide: FlowService, useValue: flowService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<PublishService>(PublishService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('前置校验', () => {
    it('周期不存在抛 4004', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(null);

      await expect(service.publishCycle('cycle-x', { taskIds: ['task-1'] }, makeViewer())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('taskIds 为空或无效由 ValidationPipe 拦截（单测层面校验 DTO 结构）', () => {
      // DTO 已加 @ArrayNotEmpty + @IsUUID('4', { each: true })
      // 这里主要覆盖 service 不会收到空数组后误操作
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      return expect(
        service.publishCycle('cycle-1', { taskIds: [] as any }, makeViewer()),
      ).rejects.toThrow(BadRequestException);
    });

    it('勾选的任务不全是 approval 态或非本周期时抛 4001', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([makeTask('approval', new Date())]);

      await expect(
        service.publishCycle('cycle-1', { taskIds: ['task-1', 'task-2'] }, makeViewer()),
      ).rejects.toThrow(ConflictException);

      try {
        await service.publishCycle('cycle-1', { taskIds: ['task-1', 'task-2'] }, makeViewer());
      } catch (err) {
        expect((err as ConflictException).getResponse()).toMatchObject({ code: ERROR_CODE.CONFLICT });
      }
    });

    it('勾选中存在未审批任务时抛 4009 并列出任务', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask('approval', new Date()),
        makeTask('approval', null, { id: 'task-2' }),
      ]);

      await expect(
        service.publishCycle('cycle-1', { taskIds: ['task-1', 'task-2'] }, makeViewer()),
      ).rejects.toThrow(ConflictException);

      try {
        await service.publishCycle('cycle-1', { taskIds: ['task-1', 'task-2'] }, makeViewer());
      } catch (err) {
        const resp = (err as ConflictException).getResponse() as any;
        expect(resp.code).toBe(ERROR_CODE.CONFLICT);
        expect(resp.message).toContain('task-2');
      }
    });
  });

  describe('公示发布事务', () => {
    it('只公示勾选的 taskIds，未勾选的仍留在 approval，cycle.status 不推进', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask('approval', new Date()),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: 'approval',
        newStatus: 'published',
        nodeType: 'publish',
      });
      tx.assessmentCycle.update.mockResolvedValue(makeCycle());
      tx.assessmentTask.update.mockResolvedValue({});
      tx.assessmentTask.count.mockResolvedValue(1); // 还有 task-2 未公示
      tx.gradeResult.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.publishCycle(
        'cycle-1',
        { taskIds: ['task-1'] },
        makeViewer(),
      );

      expect(result.published).toBe(1);
      const updateData = tx.assessmentCycle.update.mock.calls[0][0].data;
      expect(updateData).toHaveProperty('publishedAt');
      expect(updateData).toHaveProperty('deadlineAppeal');
      expect(updateData.status).toBeUndefined();
    });

    it('本周期已无 approval 任务时 cycle.status 推进为 published', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 30 });
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask('approval', new Date()),
        makeTask('approval', new Date(), { id: 'task-2' }),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: 'approval',
        newStatus: 'published',
        nodeType: 'publish',
      });
      tx.assessmentCycle.update.mockResolvedValue(makeCycle());
      tx.assessmentTask.update.mockResolvedValue({});
      tx.assessmentTask.count.mockResolvedValue(0);
      tx.gradeResult.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.publishCycle(
        'cycle-1',
        { taskIds: ['task-1', 'task-2'] },
        makeViewer(),
      );

      expect(result.published).toBe(2);
      expect(tx.assessmentCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cycle-1' },
          data: expect.objectContaining({ status: 'published' }),
        }),
      );
    });

    it('配置 appeal_window_days 为 15 时 deadlineAppeal 按 15 天计算', async () => {
      const cycle = makeCycle();
      prisma.assessmentCycle.findUnique.mockResolvedValue(cycle);
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 15 });
      prisma.assessmentTask.findMany.mockResolvedValue([makeTask('approval', new Date())]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: 'approval',
        newStatus: 'published',
        nodeType: 'publish',
      });
      tx.assessmentCycle.update.mockResolvedValue(cycle);
      tx.assessmentTask.update.mockResolvedValue({});
      tx.assessmentTask.count.mockResolvedValue(0);
      tx.gradeResult.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.publishCycle(
        'cycle-1',
        { taskIds: ['task-1'] },
        makeViewer(),
      );

      const expected = new Date(result.publishedAt);
      expected.setDate(expected.getDate() + 15);
      expected.setHours(0, 0, 0, 0);
      expect(result.deadlineAppeal.getTime()).toBe(expected.getTime());
    });

    it('sendDingtalkNotification=true 时给员工发结果发布通知', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentTask.findMany.mockResolvedValue([makeTask('approval', new Date())]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: 'approval',
        newStatus: 'published',
        nodeType: 'publish',
      });
      tx.assessmentTask.count.mockResolvedValue(0);
      (notificationsService.sendResultPublished as jest.Mock).mockResolvedValue('log-1');

      await service.publishCycle(
        'cycle-1',
        { taskIds: ['task-1'], sendDingtalkNotification: true },
        makeViewer(),
      );

      expect(notificationsService.sendResultPublished).toHaveBeenCalledWith('task-1');
    });

    it('sendDingtalkNotification=false/未传 时不发通知', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentTask.findMany.mockResolvedValue([makeTask('approval', new Date())]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: 'approval',
        newStatus: 'published',
        nodeType: 'publish',
      });
      tx.assessmentTask.count.mockResolvedValue(0);

      await service.publishCycle('cycle-1', { taskIds: ['task-1'] }, makeViewer());

      expect(notificationsService.sendResultPublished).not.toHaveBeenCalled();
    });

    it('最终等级为 D 时自动创建 draft 绩效改进计划', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask('approval', new Date(), { id: 'task-1' }, { calibratedGrade: 'D', rawGrade: 'D' }),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: 'approval',
        newStatus: 'published',
        nodeType: 'publish',
      });
      tx.assessmentTask.count.mockResolvedValue(0);

      await service.publishCycle('cycle-1', { taskIds: ['task-1'] }, makeViewer());

      expect(tx.improvementPlan.upsert).toHaveBeenCalledWith({
        where: { employeeId_cycleId: { employeeId: 'emp-1', cycleId: 'cycle-1' } },
        create: {
          employeeId: 'emp-1',
          cycleId: 'cycle-1',
          taskId: 'task-1',
          status: 'draft',
        },
        update: {},
      });
    });

    it('最终等级非 D 时不创建绩效改进计划', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask('approval', new Date(), { id: 'task-1' }, { calibratedGrade: 'C', rawGrade: 'C' }),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: 'approval',
        newStatus: 'published',
        nodeType: 'publish',
      });
      tx.assessmentTask.count.mockResolvedValue(0);

      await service.publishCycle('cycle-1', { taskIds: ['task-1'] }, makeViewer());

      expect(tx.improvementPlan.upsert).not.toHaveBeenCalled();
    });
  });
});
