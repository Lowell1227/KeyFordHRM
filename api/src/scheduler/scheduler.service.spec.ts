import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service';
import { DingtalkSyncService } from '@/dingtalk/dingtalk-sync.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { PrismaService } from '@/prisma/prisma.service';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let dingtalkSyncService: jest.Mocked<DingtalkSyncService>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let prisma: any;

  beforeEach(async () => {
    const dingtalkSyncMock = {
      runSync: jest.fn(),
    } as unknown as jest.Mocked<DingtalkSyncService>;

    const notificationsMock = {
      sendBatchReminders: jest.fn().mockResolvedValue([]),
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
      performanceArchive: { upsert: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>, _options?: unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: DingtalkSyncService, useValue: dingtalkSyncMock },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
    dingtalkSyncService = module.get(DingtalkSyncService);
    notificationsService = module.get(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('syncDingtalkOrganization', () => {
    it('应触发钉钉组织同步', () => {
      service.syncDingtalkOrganization();
      expect(dingtalkSyncService.runSync).toHaveBeenCalled();
    });

    it('同步异常应被吞掉并记录日志', () => {
      dingtalkSyncService.runSync.mockImplementation(() => {
        throw new Error('sync error');
      });
      expect(() => service.syncDingtalkOrganization()).not.toThrow();
      expect(dingtalkSyncService.runSync).toHaveBeenCalled();
    });
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
});
