import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { PrismaService } from '@/prisma/prisma.service';
import { LaunchService } from '@/cycles/launch.service';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let notificationsService: jest.Mocked<NotificationsService>;
  let prisma: any;
  let launchService: { launch: jest.Mock };

  beforeEach(async () => {
    const notificationsMock = {
      sendBatchReminders: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
    } as unknown as jest.Mocked<NotificationsService>;

    prisma = {
      systemConfig: { findUnique: jest.fn() },
      assessmentCycle: {
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      assessmentTask: {
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      assessmentPeriod: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      performanceArchive: { upsert: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>, _options?: unknown) => fn(prisma)),
    };
    launchService = { launch: jest.fn().mockResolvedValue({ activeTasks: 1 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: PrismaService, useValue: prisma },
        { provide: LaunchService, useValue: launchService },
        { provide: EmployeeEffectiveDateService, useValue: { refreshEffectiveProjections: jest.fn() } },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
    notificationsService = module.get(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runDeadlineReminders', () => {
    it('无进行中周期时不调用催办', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentCycle.findMany.mockResolvedValue([]);

      await service.runDeadlineReminders();

      expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith({
        where: { key: 'deadline_reminder_days' },
      });
      expect(notificationsService.sendBatchReminders).not.toHaveBeenCalled();
    });

    it('截止日临期时按节点调用 sendBatchReminders', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 2 });

      const today = new Date('2026-06-14');
      jest.useFakeTimers().setSystemTime(today);

      prisma.assessmentCycle.findMany.mockResolvedValue([
        {
          id: 'cycle-1',
          status: 'self_eval',
          deadlineIndicatorConfirm: new Date('2026-06-10'), // 已超期
          deadlineSelfEval: new Date('2026-06-15'), // 临期（≤ today+2）
          deadlineManagerScore: null,
          deadlineHrCalibration: null,
          deadlineApproval: null,
        },
      ]);

      await service.runDeadlineReminders();

      // employee 节点任一截止日临期/超期，合并为一次催办
      expect(notificationsService.sendBatchReminders).toHaveBeenCalledWith('cycle-1', 'employee');
      expect(notificationsService.sendBatchReminders).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('截止日尚远时不调用催办', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 3 });

      const today = new Date('2026-06-14');
      jest.useFakeTimers().setSystemTime(today);

      prisma.assessmentCycle.findMany.mockResolvedValue([
        {
          id: 'cycle-2',
          status: 'manager_score',
          deadlineIndicatorConfirm: null,
          deadlineSelfEval: null,
          deadlineManagerScore: new Date('2026-06-20'), // today+3 之后，不催办
          deadlineHrCalibration: null,
          deadlineApproval: null,
        },
      ]);

      await service.runDeadlineReminders();

      expect(notificationsService.sendBatchReminders).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('使用默认 3 天读取配置失败时', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);

      const today = new Date('2026-06-14');
      jest.useFakeTimers().setSystemTime(today);

      prisma.assessmentCycle.findMany.mockResolvedValue([
        {
          id: 'cycle-3',
          status: 'self_eval',
          deadlineIndicatorConfirm: null,
          deadlineSelfEval: new Date('2026-06-17'), // today+3，临期
          deadlineManagerScore: null,
          deadlineHrCalibration: null,
          deadlineApproval: null,
        },
      ]);

      await service.runDeadlineReminders();

      expect(notificationsService.sendBatchReminders).toHaveBeenCalledWith('cycle-3', 'employee');

      jest.useRealTimers();
    });

    it('reminds the employee and frozen manager on the first overdue day without advancing status', async () => {
      const now = new Date('2026-09-11T01:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentCycle.findMany.mockResolvedValue([]);
      prisma.assessmentPeriod.findMany.mockResolvedValue([{
        id: 'period-september',
        taskId: 'task-1',
        periodKey: '2026-09',
        selfEvalDueAt: new Date('2026-09-10T10:00:00.000Z'),
        employeeSubmittedAt: null,
        task: {
          cycleId: 'cycle-1',
          employeeId: 'employee-1',
          managerId: 'manager-1',
          cycle: { notificationMode: 'dingtalk' },
        },
      }]);

      await service.runDeadlineReminders();

      expect(notificationsService.create).toHaveBeenCalledTimes(2);
      expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'employee-1',
        type: 'monthly_self_eval_overdue',
        dedupeKey: 'monthly-self-eval:period-september:employee-1:overdue_1:2026-09-11',
      }));
      expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'manager-1',
        type: 'monthly_self_eval_overdue_manager_notice',
      }));
      expect(prisma.assessmentPeriod.updateMany).not.toHaveBeenCalled();
      expect(prisma.assessmentTask.updateMany).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('reminds the frozen manager after the employee submits without reopening the employee stage', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-10T01:00:00.000Z'));
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 3 });
      prisma.assessmentCycle.findMany.mockResolvedValue([]);
      prisma.assessmentPeriod.findMany.mockResolvedValue([{
        id: 'period-september',
        taskId: 'task-1',
        periodKey: '2026-09',
        status: 'manager_scoring',
        selfEvalDueAt: new Date('2026-09-05T10:00:00.000Z'),
        managerDueAt: new Date('2026-09-10T10:00:00.000Z'),
        employeeSubmittedAt: new Date('2026-09-05T01:00:00.000Z'),
        managerSubmittedAt: null,
        task: {
          cycleId: 'cycle-1',
          employeeId: 'employee-1',
          managerId: 'manager-1',
          cycle: { notificationMode: 'dingtalk' },
        },
      }]);

      await service.runDeadlineReminders();

      expect(notificationsService.create).toHaveBeenCalledTimes(1);
      expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'manager-1',
        type: 'monthly_manager_score_reminder',
        dedupeKey: 'monthly-manager-score:period-september:manager-1:due_today:2026-09-10',
        extraData: expect.objectContaining({
          periodId: 'period-september',
          action: 'manager_period_review',
        }),
      }));
      expect(prisma.assessmentPeriod.updateMany).not.toHaveBeenCalled();
      expect(prisma.assessmentTask.updateMany).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('does not send external reminders when the cycle notification mode is off', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-10T01:00:00.000Z'));
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.assessmentCycle.findMany.mockResolvedValue([]);
      prisma.assessmentPeriod.findMany.mockResolvedValue([{
        id: 'period-september',
        taskId: 'task-1',
        periodKey: '2026-09',
        selfEvalDueAt: new Date('2026-09-10T10:00:00.000Z'),
        employeeSubmittedAt: null,
        task: {
          cycleId: 'cycle-1', employeeId: 'employee-1', managerId: 'manager-1',
          cycle: { notificationMode: 'off' },
        },
      }]);

      await service.runDeadlineReminders();

      expect(notificationsService.create).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('does not duplicate legacy employee reminders for workflow v2 monthly cycles', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-10T01:00:00.000Z'));
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 3 });
      prisma.assessmentPeriod.findMany.mockResolvedValue([]);
      prisma.assessmentCycle.findMany.mockResolvedValue([{
        id: 'cycle-v2',
        status: 'self_eval',
        workflowVersion: 2,
        scoringFrequency: 'monthly',
        deadlineIndicatorConfirm: null,
        deadlineSelfEval: new Date('2026-09-10T10:00:00.000Z'),
        deadlineManagerScore: null,
        deadlineHrCalibration: null,
        deadlineApproval: null,
      }]);

      await service.runDeadlineReminders();

      expect(notificationsService.sendBatchReminders).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('runAutoCloseCycles', () => {
    it('无满足条件周期时不执行任务', async () => {
      prisma.assessmentCycle.findMany.mockResolvedValue([]);

      await service.runAutoCloseCycles();

      expect(prisma.assessmentTask.findMany).not.toHaveBeenCalled();
    });

    it('申诉截止日已过则归档任务并关闭周期', async () => {
      const cycleId = 'cycle-close-1';
      const taskId = 'task-1';
      const employeeId = 'emp-1';

      prisma.assessmentCycle.findMany.mockResolvedValue([
        { id: cycleId, status: 'published' },
      ]);

      prisma.assessmentTask.findMany.mockResolvedValue([
        {
          id: taskId,
          employeeId,
          cycleId,
          status: 'published',
          employee: { name: '张三' },
          dept: { name: '研发部' },
          gradeResult: {
            calculatedScore: { toNumber: () => 88 },
            rawGrade: 'B',
            calibratedGrade: 'B',
            coefficient: { toNumber: () => 1 },
          },
          indicatorInstances: [
            {
              name: '销售额',
              dimensionName: 'KPI',
              weight: { toNumber: () => 0.5 },
              indicatorType: 'kpi',
              targetValue: { toNumber: () => 100 },
              actualValue: { toNumber: () => 90 },
              selfScore: { toNumber: () => 80 },
              managerScore: { toNumber: () => 85 },
              finalScore: { toNumber: () => 85 },
            },
          ],
        },
      ]);

      await service.runAutoCloseCycles();

      expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['published', 'appeal'] },
          deadlineAppeal: { lt: expect.any(Date) },
        },
        select: { id: true, status: true },
      });

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith({
        where: {
          cycleId,
          status: { notIn: ['closed', 'exempted'] },
        },
        include: expect.any(Object),
      });

      expect(prisma.performanceArchive.upsert).toHaveBeenCalledWith({
        where: {
          employeeId_cycleId: { employeeId, cycleId },
        },
        create: expect.objectContaining({
          employeeId,
          cycleId,
          employeeName: '张三',
          deptName: '研发部',
          grade: 'B',
          totalScore: expect.anything(),
          coefficient: expect.anything(),
          summary: expect.any(Object),
          archivedAt: expect.any(Date),
        }),
        update: expect.any(Object),
      });

      expect(prisma.assessmentTask.update).toHaveBeenCalledWith({
        where: { id: taskId },
        data: { status: 'closed', closedAt: expect.any(Date) },
      });

      expect(prisma.assessmentCycle.update).toHaveBeenCalledWith({
        where: { id: cycleId },
        data: { status: 'closed', closedAt: expect.any(Date) },
      });
    });

    it('无等级任务跳过归档但仍关闭任务与周期', async () => {
      const cycleId = 'cycle-close-3';
      const taskId = 'task-no-grade';

      prisma.assessmentCycle.findMany.mockResolvedValue([
        { id: cycleId, status: 'published' },
      ]);

      prisma.assessmentTask.findMany.mockResolvedValue([
        {
          id: taskId,
          employeeId: 'emp-2',
          cycleId,
          status: 'published',
          employee: { name: '李四' },
          dept: { name: '销售部' },
          gradeResult: null,
          indicatorInstances: [],
        },
      ]);

      await service.runAutoCloseCycles();

      expect(prisma.performanceArchive.upsert).not.toHaveBeenCalled();
      expect(prisma.assessmentTask.update).toHaveBeenCalledWith({
        where: { id: taskId },
        data: { status: 'closed', closedAt: expect.any(Date) },
      });
      expect(prisma.assessmentCycle.update).toHaveBeenCalledWith({
        where: { id: cycleId },
        data: { status: 'closed', closedAt: expect.any(Date) },
      });
    });
  });

  describe('monthly self evaluation opening', () => {
    it('never advances an overdue employee period from the opening cron', async () => {
      jest.spyOn(service, 'runSelfEvalOpenings').mockResolvedValue();
      jest.spyOn(service, 'runPeriodSelfEvalOpenings').mockResolvedValue();

      await service.openSelfEvaluations();

      expect(prisma.assessmentPeriod.updateMany).not.toHaveBeenCalled();
      expect(prisma.assessmentTask.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('quarter opening orchestration', () => {
    it('opens every scheduled cycle whose goal-setting opening time has arrived', async () => {
      const now = new Date('2026-12-22T09:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      prisma.assessmentCycle.findMany.mockResolvedValue([{
        id: 'cycle-q1',
        scheduledById: '11111111-1111-4111-8111-111111111111',
      }]);

      await (service as unknown as { runScheduledCycleOpenings: () => Promise<void> })
        .runScheduledCycleOpenings();

      expect(launchService.launch).toHaveBeenCalledWith(
        'cycle-q1',
        expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }),
        { source: 'scheduled', now },
      );
      jest.useRealTimers();
    });

    it('opens self evaluation only for goal-confirmed tasks when its opening time arrives', async () => {
      const now = new Date('2027-04-01T00:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      prisma.assessmentCycle.findMany.mockResolvedValue([{ id: 'cycle-q1' }]);

      await (service as unknown as { runSelfEvalOpenings: () => Promise<void> })
        .runSelfEvalOpenings();

      expect(prisma.assessmentTask.updateMany).toHaveBeenCalledWith({
        where: { cycleId: 'cycle-q1', status: 'goal_confirmed' },
        data: { status: 'self_eval' },
      });
      expect(prisma.assessmentCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-q1' },
        data: { status: 'self_eval' },
      });
      jest.useRealTimers();
    });

    it('opens only due monthly reviews that already have a confirmed indicator version', async () => {
      const now = new Date('2027-02-01T01:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      prisma.assessmentPeriod.findMany.mockResolvedValue([{
        id: 'period-2027-01',
        taskId: 'task-1',
        periodKey: '2027-01',
        task: {
          cycleId: 'cycle-q1',
          employeeId: 'emp-1',
          cycle: { notificationMode: 'off' },
        },
      }]);
      prisma.assessmentPeriod.updateMany.mockResolvedValue({ count: 1 });

      await service.runPeriodSelfEvalOpenings();

      expect(prisma.assessmentPeriod.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          status: 'unopened',
          indicatorVersionId: { not: null },
          selfEvalOpenAt: { lte: now },
          task: { cycle: { workflowVersion: 2 } },
        }),
      }));
      expect(prisma.assessmentPeriod.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'period-2027-01',
          status: 'unopened',
          indicatorVersionId: { not: null },
        },
        data: { status: 'self_eval', openedAt: now },
      });
      expect(prisma.assessmentTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', status: 'goal_confirmed' },
        data: { status: 'self_eval' },
      });
      expect(notificationsService.create).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('notifies the assigned HR owner when an automatic opening becomes blocked', async () => {
      const now = new Date('2026-12-22T09:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      prisma.assessmentCycle.findMany.mockResolvedValue([{
        id: 'cycle-q1',
        scheduledById: 'scheduler-operator',
        hrOwnerId: 'hr-owner-1',
      }]);
      launchService.launch.mockRejectedValue(new Error('template drift'));
      prisma.assessmentCycle.updateMany.mockResolvedValue({ count: 1 });
      prisma.auditLog = { create: jest.fn() };

      await service.runScheduledCycleOpenings();

      expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'hr-owner-1',
        cycleId: 'cycle-q1',
        type: 'cycle_launch_blocked',
      }));
      jest.useRealTimers();
    });
  });
});
