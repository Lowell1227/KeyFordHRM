import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService, TaskReminderNodeType } from './notifications.service';
import { MESSAGE_PUSH_PROVIDER, MessagePushProvider } from './message-push.provider';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';

/** 构造一个可被 jest.spyOn mock 的 PrismaService。 */
function makePrismaMock() {
  return {
    $transaction: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: { findUnique: jest.fn() },
    notificationLog: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    assessmentTask: { findUnique: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    appeal: { findUnique: jest.fn() },
  } as unknown as PrismaService;
}

function makePushProviderMock(): MessagePushProvider {
  return { push: jest.fn().mockResolvedValue({ channel: 'system' }) };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let pushProvider: MessagePushProvider;

  beforeEach(async () => {
    prisma = makePrismaMock();
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (callback: (tx: PrismaService) => unknown) => callback(prisma),
    );
    pushProvider = makePushProviderMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MESSAGE_PUSH_PROVIDER, useValue: pushProvider },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('应写 pending 日志，调 provider，成功后改为 sent 并记录 externalId', async () => {
      const user = { dingtalkId: 'dt-1' };
      const log = { id: 'log-1' };
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(user as any);
      jest.spyOn(prisma.notificationLog, 'create').mockResolvedValue(log as any);
      jest.spyOn(prisma.notificationLog, 'updateMany').mockResolvedValue({ count: 1 } as any);
      jest.spyOn(pushProvider, 'push').mockResolvedValue({ channel: 'dingtalk', externalId: 'ext-1' });

      const id = await service.create({
        userId: 'u-1',
        type: 'test',
        title: '标题',
        content: '内容',
      });

      expect(id).toBe('log-1');
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending', isRead: false, readAt: null }),
        }),
      );
      expect(pushProvider.push).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', dingtalkId: 'dt-1', title: '标题', content: '内容' }),
      );
      expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: {
          status: 'sent',
          sentAt: expect.any(Date),
          channel: 'dingtalk',
          extraData: { externalId: 'ext-1' },
        },
      });
      expect(prisma.notificationLog.update).not.toHaveBeenCalled();
    });

    it('provider 失败时不抛异常，改状态为 failed 并记 error_msg', async () => {
      const user = { dingtalkId: null };
      const log = { id: 'log-2' };
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(user as any);
      jest.spyOn(prisma.notificationLog, 'create').mockResolvedValue(log as any);
      jest.spyOn(prisma.notificationLog, 'updateMany').mockResolvedValue({ count: 1 } as any);
      jest.spyOn(pushProvider, 'push').mockRejectedValue(new Error('push broken'));

      const id = await service.create({
        userId: 'u-2',
        type: 'test',
        title: '标题',
        content: '内容',
      });

      expect(id).toBe('log-2');
      expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith({
        where: { id: 'log-2' },
        data: { status: 'failed', errorMsg: 'push broken' },
      });
      expect(prisma.notificationLog.update).not.toHaveBeenCalled();
    });

    it('接收用户不存在时返回 null', async () => {
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      const id = await service.create({
        userId: 'missing',
        type: 'test',
        title: '标题',
        content: '内容',
      });

      expect(id).toBeNull();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });
  });

  describe('authenticated inbox', () => {
    const viewerId = 'viewer-1';

    it('lists only the viewer notifications with stable recent ordering', async () => {
      const createdAt = new Date('2026-08-09T08:00:00.000Z');
      prisma.notificationLog.count = jest.fn().mockResolvedValue(1);
      prisma.notificationLog.findMany = jest.fn().mockResolvedValue([
        {
          id: 'notification-1',
          userId: viewerId,
          senderId: 'sender-1',
          taskId: 'task-1',
          cycleId: 'cycle-1',
          type: 'self_eval_submitted',
          title: 'Self evaluation submitted',
          content: 'Review now',
          channel: 'dingtalk',
          status: 'sent',
          isRead: false,
          readAt: null,
          sentAt: createdAt,
          createdAt,
          sender: { name: 'Employee' },
        },
      ]);

      const result = await (service as any).findInbox(viewerId, {
        page: 1,
        pageSize: 10,
        skip: 0,
        take: 10,
        unreadOnly: true,
      });

      expect(prisma.notificationLog.count).toHaveBeenCalledWith({
        where: { userId: viewerId, isRead: false },
      });
      expect(prisma.notificationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: viewerId, isRead: false },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 10,
        }),
      );
      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'notification-1',
          userId: viewerId,
          senderName: 'Employee',
          status: 'sent',
          isRead: false,
          readAt: null,
        }),
      ]);
    });

    it('counts only unread notifications belonging to the viewer', async () => {
      prisma.notificationLog.count = jest.fn().mockResolvedValue(3);

      await expect((service as any).getUnreadCount(viewerId)).resolves.toEqual({
        count: 3,
      });
      expect(prisma.notificationLog.count).toHaveBeenCalledWith({
        where: { userId: viewerId, isRead: false },
      });
    });

    it('marks one owned notification read without changing delivery status', async () => {
      const row = {
        id: 'notification-1',
        userId: viewerId,
        status: 'sent',
        isRead: false,
        readAt: null,
        sender: null,
      };
      prisma.notificationLog.findFirst = jest
        .fn()
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({
          ...row,
          isRead: true,
          readAt: new Date('2026-08-09T09:00:00.000Z'),
        });
      prisma.notificationLog.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.notificationLog.count = jest.fn().mockResolvedValue(0);

      const result = await (service as any).markAsRead('notification-1', viewerId);

      expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith({
        where: { id: 'notification-1', userId: viewerId, isRead: false },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(result).toMatchObject({ status: 'sent', isRead: true, unreadCount: 0 });
      expect(prisma.notificationLog.count).toHaveBeenCalledWith({
        where: { userId: viewerId, isRead: false },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('keeps an owned read notification idempotent and rejects a foreign id as not found', async () => {
      prisma.notificationLog.findFirst = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'notification-read',
          userId: viewerId,
          status: 'failed',
          isRead: true,
          readAt: new Date('2026-08-09T09:00:00.000Z'),
          sender: null,
        })
        .mockResolvedValueOnce(null);
      prisma.notificationLog.count = jest.fn().mockResolvedValue(0);

      const existing = await (service as any).markAsRead('notification-read', viewerId);
      expect(existing).toMatchObject({ status: 'failed', isRead: true, unreadCount: 0 });
      expect(prisma.notificationLog.updateMany).not.toHaveBeenCalled();
      await expect((service as any).markAsRead('foreign-notification', viewerId)).rejects.toThrow(NotFoundException);
    });

    it('marks all and only the viewer unread notifications', async () => {
      prisma.notificationLog.updateMany = jest.fn().mockResolvedValue({ count: 2 });
      prisma.notificationLog.count = jest.fn().mockResolvedValue(1);

      const result = await (service as any).markAllAsRead(viewerId);
      expect(result).toEqual({ marked: 2, readAt: expect.any(Date), unreadCount: 1 });
      expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith({
        where: { userId: viewerId, isRead: false },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(prisma.notificationLog.count).toHaveBeenCalledWith({
        where: { userId: viewerId, isRead: false },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendTaskReminder 限频', () => {
    const senderId = 'sender-1';
    const taskId = 'task-1';

    beforeEach(() => {
      jest.spyOn(prisma.assessmentTask, 'findUnique').mockResolvedValue({
        id: taskId,
        cycleId: 'cycle-1',
        employeeId: 'emp-1',
        managerId: 'mgr-1',
        deptHeadId: 'head-1',
        approverId: 'vp-1',
      } as any);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ dingtalkId: null } as any);
      jest.spyOn(prisma.notificationLog, 'create').mockResolvedValue({ id: 'log-x' } as any);
      jest.spyOn(prisma.notificationLog, 'update').mockResolvedValue({} as any);
    });

    it('同一任务、节点、收件人 24 小时内第二次催办应抛 4029', async () => {
      const findFirstMock = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ createdAt: new Date() });
      jest.spyOn(prisma.notificationLog, 'findFirst').mockImplementation(findFirstMock);

      // 第一次成功
      await service.sendTaskReminder(taskId, 'manager', senderId);
      // 第二次被限频
      await expect(service.sendTaskReminder(taskId, 'manager', senderId)).rejects.toMatchObject({
        response: {
          code: ERROR_CODE.RATE_LIMITED,
          message: '该环节 24 小时内已催办过',
        },
      });
      expect(findFirstMock).toHaveBeenCalledTimes(2);
      expect(findFirstMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            taskId,
            userId: 'mgr-1',
            type: 'task_reminder',
            extraData: { path: ['nodeType'], equals: 'manager' },
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
    });

    it('不同 sender 对同一任务节点和收件人仍受限频', async () => {
      jest.spyOn(prisma.notificationLog, 'findFirst').mockResolvedValue({ createdAt: new Date() } as any);

      await expect(service.sendTaskReminder(taskId, 'manager', 'other-sender')).rejects.toMatchObject({
        response: { code: ERROR_CODE.RATE_LIMITED },
      });
    });

    it('超过 24 小时应放行', async () => {
      jest.spyOn(prisma.notificationLog, 'findFirst').mockResolvedValue(null);

      const id = await service.sendTaskReminder(taskId, 'manager', senderId);
      expect(id).toBe('log-x');
      const gteArg = (prisma.notificationLog.findFirst as jest.Mock).mock.calls[0][0].where.createdAt.gte;
      expect(Date.now() - gteArg.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    });

    it('应正确解析各 nodeType 收件人', async () => {
      jest.spyOn(prisma.notificationLog, 'findFirst').mockResolvedValue(null);

      const cases: { nodeType: TaskReminderNodeType; userId: string }[] = [
        { nodeType: 'employee', userId: 'emp-1' },
        { nodeType: 'manager', userId: 'mgr-1' },
        { nodeType: 'deptHead', userId: 'head-1' },
        { nodeType: 'approver', userId: 'vp-1' },
      ];

      for (const c of cases) {
        await service.sendTaskReminder(taskId, c.nodeType, senderId);
        expect(prisma.notificationLog.create).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: c.userId,
              extraData: { nodeType: c.nodeType },
            }),
          }),
        );
      }
    });

    it('HR 节点始终催办周期指定的 HR 负责人', async () => {
      jest.spyOn(prisma.assessmentTask, 'findUnique').mockResolvedValue({
        id: taskId,
        cycleId: 'cycle-1',
        employeeId: 'emp-1',
        managerId: 'mgr-1',
        deptHeadId: 'head-1',
        approverId: 'vp-1',
        cycle: { hrOwnerId: 'hr-owner-1' },
      } as any);
      jest.spyOn(prisma.notificationLog, 'findFirst').mockResolvedValue(null);

      await service.sendTaskReminder(taskId, 'hr', senderId);

      expect(prisma.notificationLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ userId: 'hr-owner-1', extraData: { nodeType: 'hr' } }),
      }));
    });

    it('节点处理人为空时应抛 NOT_FOUND', async () => {
      jest.spyOn(prisma.assessmentTask, 'findUnique').mockResolvedValue({
        id: taskId,
        cycleId: 'cycle-1',
        employeeId: 'emp-1',
        managerId: null,
        deptHeadId: null,
        approverId: null,
      } as any);

      await expect(service.sendTaskReminder(taskId, 'manager', senderId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('sendBatchReminders', () => {
    it('批量 HR 催办只发送给周期指定的 HR 负责人', async () => {
      prisma.assessmentTask.findMany = jest.fn().mockResolvedValue([{
        id: 't-hr',
        cycleId: 'c1',
        status: 'hr_calibration',
        employeeId: 'e1',
        managerId: 'm1',
        deptHeadId: 'h1',
        approverId: 'a1',
        cycle: { hrOwnerId: 'hr-owner-1' },
      }] as any);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ dingtalkId: null } as any);
      jest.spyOn(prisma.notificationLog, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.notificationLog, 'create').mockResolvedValue({ id: 'log-hr' } as any);
      jest.spyOn(prisma.notificationLog, 'update').mockResolvedValue({} as any);

      await service.sendBatchReminders('c1', 'hr');

      expect(prisma.notificationLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ userId: 'hr-owner-1' }),
      }));
    });
    it('与人工催办共用限频，只给当前处于该节点的任务处理人发通知', async () => {
      prisma.assessmentTask.findMany = jest.fn().mockResolvedValue([
        { id: 't1', cycleId: 'c1', status: 'indicator_reviewing', employeeId: 'e1', managerId: 'm1', deptHeadId: null, approverId: null },
        { id: 't2', cycleId: 'c1', status: 'manager_scoring', employeeId: 'e2', managerId: 'm2', deptHeadId: null, approverId: null },
        { id: 't3', cycleId: 'c1', status: 'dept_review', employeeId: 'e3', managerId: null, deptHeadId: null, approverId: null },
      ] as any);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ dingtalkId: null } as any);
      jest.spyOn(prisma.notificationLog, 'create').mockResolvedValue({ id: 'log-batch' } as any);
      jest.spyOn(prisma.notificationLog, 'update').mockResolvedValue({} as any);

      const ids = await service.sendBatchReminders('c1', 'manager');

      expect(ids).toHaveLength(2);
      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cycleId: 'c1',
            status: { in: ['indicator_reviewing', 'manager_scoring'] },
          }),
        }),
      );
      expect(prisma.notificationLog.count).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).toHaveBeenCalledTimes(2);
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'm1', senderId: null, type: 'task_reminder' }),
        }),
      );
    });

    it('已过该节点的任务处理人不应收到催办', async () => {
      // Prisma 查询已按 status 过滤，mock 直接返回空结果，模拟 DB 未命中
      prisma.assessmentTask.findMany = jest.fn().mockResolvedValue([] as any);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ dingtalkId: null } as any);
      jest.spyOn(prisma.notificationLog, 'create').mockResolvedValue({ id: 'log-batch' } as any);
      jest.spyOn(prisma.notificationLog, 'update').mockResolvedValue({} as any);

      const ids = await service.sendBatchReminders('c1', 'manager');

      expect(ids).toHaveLength(0);
      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cycleId: 'c1',
            status: { in: ['indicator_reviewing', 'manager_scoring'] },
          }),
        }),
      );
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });
  });

  describe('sendResultPublished', () => {
    it('应发给任务员工', async () => {
      jest.spyOn(prisma.assessmentTask, 'findUnique').mockResolvedValue({
        id: 't1',
        cycleId: 'c1',
        employeeId: 'e1',
        managerId: 'm1',
        deptHeadId: null,
        approverId: null,
      } as any);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ dingtalkId: null } as any);
      jest.spyOn(prisma.notificationLog, 'create').mockResolvedValue({ id: 'log-res' } as any);
      jest.spyOn(prisma.notificationLog, 'update').mockResolvedValue({} as any);

      const id = await service.sendResultPublished('t1');
      expect(id).toBe('log-res');
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'e1', type: 'result_published' }),
        }),
      );
    });
  });

  describe('sendAppealNotice', () => {
    it('应发给 dept_head 处理人', async () => {
      jest.spyOn(prisma.appeal, 'findUnique').mockResolvedValue({
        id: 'a1',
        taskId: 't1',
        cycleId: 'c1',
        deptResolverId: 'head-1',
        hrResolverId: 'hr-1',
        task: { id: 't1' },
      } as any);
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ dingtalkId: null } as any);
      jest.spyOn(prisma.notificationLog, 'create').mockResolvedValue({ id: 'log-app' } as any);
      jest.spyOn(prisma.notificationLog, 'update').mockResolvedValue({} as any);

      const id = await service.sendAppealNotice('a1', 'dept_head');
      expect(id).toBe('log-app');
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'head-1', type: 'appeal_notice' }),
        }),
      );
    });

    it('未分配处理人时应抛 NOT_FOUND', async () => {
      jest.spyOn(prisma.appeal, 'findUnique').mockResolvedValue({
        id: 'a1',
        taskId: 't1',
        cycleId: 'c1',
        deptResolverId: null,
        hrResolverId: null,
        task: { id: 't1' },
      } as any);

      await expect(service.sendAppealNotice('a1', 'hr')).rejects.toThrow(NotFoundException);
    });
  });
});
