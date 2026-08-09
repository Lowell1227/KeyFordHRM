import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { paginated, Paginated } from '@/common/dto/pagination.dto';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { MESSAGE_PUSH_PROVIDER, MessagePushProvider } from './message-push.provider';

const notificationInboxInclude = {
  sender: { select: { name: true } },
} satisfies Prisma.NotificationLogInclude;

type NotificationWithSender = Prisma.NotificationLogGetPayload<{
  include: typeof notificationInboxInclude;
}>;

export interface NotificationInboxItem {
  id: string;
  userId: string;
  senderId: string | null;
  senderName: string | null;
  taskId: string | null;
  cycleId: string | null;
  type: string;
  title: string;
  content: string | null;
  channel: string;
  status: string;
  isRead: boolean;
  readAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface NotificationReadResult extends NotificationInboxItem {
  unreadCount: number;
}

export interface MarkAllNotificationsReadResult {
  marked: number;
  readAt: Date;
  unreadCount: number;
}

type NotificationInboxClient = Pick<Prisma.TransactionClient, 'notificationLog'>;

/** 催办节点类型 → task 处理人字段映射。 */
export type TaskReminderNodeType = 'employee' | 'manager' | 'deptHead' | 'approver';

interface CreateNotificationParams {
  userId: string;
  senderId?: string | null;
  taskId?: string | null;
  cycleId?: string | null;
  type: string;
  title: string;
  content: string;
}

interface TaskHandlerSnapshot {
  id: string;
  cycleId: string;
  employeeId: string;
  managerId: string | null;
  deptHeadId: string | null;
  approverId: string | null;
}

/** 通知服务：写日志、限频、调推送 provider；推送失败不阻断业务。 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_PUSH_PROVIDER)
    private readonly pushProvider: MessagePushProvider,
  ) {}

  async findInbox(userId: string, query: NotificationQueryDto): Promise<Paginated<NotificationInboxItem>> {
    const where: Prisma.NotificationLogWhereInput = { userId };
    if (query.unreadOnly) where.isRead = false;
    if (query.status) where.status = query.status;

    const [total, rows] = await Promise.all([
      this.prisma.notificationLog.count({ where }),
      this.prisma.notificationLog.findMany({
        where,
        include: notificationInboxInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
    ]);

    return paginated(
      rows.map((row) => this.toInboxItem(row)),
      total,
      query,
    );
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notificationLog.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  async markAsRead(id: string, userId: string): Promise<NotificationReadResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.findOwnedNotification(tx, id, userId);
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODE.NOT_FOUND,
          message: '通知不存在',
        });
      }

      let notification = existing;
      if (!existing.isRead) {
        await tx.notificationLog.updateMany({
          where: { id, userId, isRead: false },
          data: { isRead: true, readAt: new Date() },
        });

        const updated = await this.findOwnedNotification(tx, id, userId);
        if (!updated) {
          throw new NotFoundException({
            code: ERROR_CODE.NOT_FOUND,
            message: '通知不存在',
          });
        }
        notification = updated;
      }

      const unreadCount = await tx.notificationLog.count({
        where: { userId, isRead: false },
      });
      return { ...this.toInboxItem(notification), unreadCount };
    });
  }

  async markAllAsRead(userId: string): Promise<MarkAllNotificationsReadResult> {
    return this.prisma.$transaction(async (tx) => {
      const readAt = new Date();
      const result = await tx.notificationLog.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt },
      });
      const unreadCount = await tx.notificationLog.count({
        where: { userId, isRead: false },
      });
      return { marked: result.count, readAt, unreadCount };
    });
  }

  /**
   * 底层创建通知：先写 pending 日志，再调 provider.push；
   * 成功改 sent + sent_at + externalId，失败改 failed + error_msg。
   * 推送失败不抛异常，避免阻断业务。
   */
  async create(params: CreateNotificationParams): Promise<string | null> {
    const { userId, senderId = null, taskId = null, cycleId = null, type, title, content } = params;

    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { dingtalkId: true },
    });
    if (!user) {
      this.logger.warn(`通知创建失败：接收用户不存在 ${userId}`);
      return null;
    }

    const log = await this.prisma.notificationLog.create({
      data: {
        userId,
        senderId,
        taskId,
        cycleId,
        type,
        title,
        content,
        status: 'pending',
        channel: 'dingtalk',
        isRead: false,
        readAt: null,
      },
    });

    try {
      const result = await this.pushProvider.push({
        userId,
        dingtalkId: user.dingtalkId,
        title,
        content,
      });

      await this.prisma.notificationLog.updateMany({
        where: { id: log.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          channel: result.channel,
          extraData: result.externalId ? { externalId: result.externalId } : undefined,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`消息推送失败: ${message}`, error instanceof Error ? error.stack : undefined);
      await this.prisma.notificationLog.updateMany({
        where: { id: log.id },
        data: {
          status: 'failed',
          errorMsg: message,
        },
      });
    }

    return log.id;
  }

  private findOwnedNotification(client: NotificationInboxClient, id: string, userId: string) {
    return client.notificationLog.findFirst({
      where: { id, userId },
      include: notificationInboxInclude,
    });
  }

  private toInboxItem(row: NotificationWithSender): NotificationInboxItem {
    return {
      id: row.id,
      userId: row.userId,
      senderId: row.senderId,
      senderName: row.sender?.name ?? null,
      taskId: row.taskId,
      cycleId: row.cycleId,
      type: row.type,
      title: row.title,
      content: row.content,
      channel: row.channel,
      status: row.status,
      isRead: row.isRead,
      readAt: row.readAt,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    };
  }

  /**
   * 单条催办（D19 限频）。
   * 同一 senderId 当日已发 ≥1 条 type='task_reminder' 则抛 4029。
   */
  async sendTaskReminder(taskId: string, nodeType: TaskReminderNodeType, senderId: string) {
    await this.assertReminderRateLimit(senderId);

    const task = await this.findTaskOrThrow(taskId);
    const recipientId = this.resolveTaskHandler(task, nodeType);
    if (!recipientId) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '该任务当前节点无处理人',
      });
    }

    return this.create({
      userId: recipientId,
      senderId,
      taskId,
      cycleId: task.cycleId,
      type: 'task_reminder',
      title: '绩效任务催办',
      content: '您有一项绩效任务待处理，请及时处理。',
    });
  }

  /** 结果发布通知：发给被考核员工，不限频。 */
  async sendResultPublished(taskId: string) {
    const task = await this.findTaskOrThrow(taskId);
    return this.create({
      userId: task.employeeId,
      taskId,
      cycleId: task.cycleId,
      type: 'result_published',
      title: '绩效结果已发布',
      content: '您的绩效结果已发布，请查看。',
    });
  }

  /** 申诉通知：发给指定处理人（dept_head / hr），不限频。 */
  async sendAppealNotice(appealId: string, targetRole: 'dept_head' | 'hr') {
    const appeal = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { task: true },
    });
    if (!appeal) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '申诉不存在',
      });
    }

    const recipientId = targetRole === 'dept_head' ? appeal.deptResolverId : appeal.hrResolverId;
    if (!recipientId) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: `该申诉未分配${targetRole === 'dept_head' ? '部门负责人' : 'HR'}处理人`,
      });
    }

    return this.create({
      userId: recipientId,
      taskId: appeal.taskId,
      cycleId: appeal.cycleId,
      type: 'appeal_notice',
      title: '绩效申诉待处理',
      content: '您有一条绩效申诉待处理，请及时处理。',
    });
  }

  /**
   * 批量催办：给周期内当前处于该节点的任务处理人发通知。
   * 供定时任务调用，不受 D19 单条限频约束（senderId 为系统）。
   */
  async sendBatchReminders(cycleId: string, nodeType: TaskReminderNodeType) {
    const handlerField = this.nodeTypeToHandlerField(nodeType);
    const statuses = this.nodeTypeToTaskStatuses(nodeType);

    const tasks = await this.prisma.assessmentTask.findMany({
      where: { cycleId, status: { in: statuses } },
      select: {
        id: true,
        cycleId: true,
        employeeId: true,
        managerId: true,
        deptHeadId: true,
        approverId: true,
      },
    });

    const results: string[] = [];
    for (const task of tasks) {
      const recipientId = task[handlerField];
      if (!recipientId) continue;

      const id = await this.create({
        userId: recipientId,
        senderId: null,
        taskId: task.id,
        cycleId: task.cycleId,
        type: 'task_reminder',
        title: '绩效任务催办',
        content: '您有一项绩效任务待处理，请及时处理。',
      });
      if (id) results.push(id);
    }

    return results;
  }

  /** 校验单条催办限频：同一 sender 当日已发则拦截。 */
  private async assertReminderRateLimit(senderId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const count = await this.prisma.notificationLog.count({
      where: {
        senderId,
        type: 'task_reminder',
        createdAt: { gte: todayStart },
      },
    });

    if (count >= 1) {
      throw new ConflictException({
        code: ERROR_CODE.RATE_LIMITED,
        message: '今日已催办过，每人每天最多催办1次',
      });
    }
  }

  private async findTaskOrThrow(taskId: string): Promise<TaskHandlerSnapshot> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        cycleId: true,
        employeeId: true,
        managerId: true,
        deptHeadId: true,
        approverId: true,
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '任务不存在',
      });
    }
    return task;
  }

  private resolveTaskHandler(task: TaskHandlerSnapshot, nodeType: TaskReminderNodeType): string | null {
    const field = this.nodeTypeToHandlerField(nodeType);
    return task[field];
  }

  private nodeTypeToHandlerField(
    nodeType: TaskReminderNodeType,
  ): 'employeeId' | 'managerId' | 'deptHeadId' | 'approverId' {
    switch (nodeType) {
      case 'employee':
        return 'employeeId';
      case 'manager':
        return 'managerId';
      case 'deptHead':
        return 'deptHeadId';
      case 'approver':
        return 'approverId';
      default:
        throw new ConflictException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `不支持的节点类型: ${nodeType}`,
        });
    }
  }

  /** 节点类型 → 任务应处的状态。批量催办只给当前处于这些状态的任务处理人发通知。 */
  private nodeTypeToTaskStatuses(nodeType: TaskReminderNodeType): TaskStatus[] {
    switch (nodeType) {
      case 'employee':
        return ['indicator_drafting', 'indicator_confirming', 'self_eval'];
      case 'manager':
        return ['indicator_reviewing', 'manager_scoring'];
      case 'deptHead':
        return ['dept_review'];
      case 'approver':
        return ['approval'];
      default:
        throw new ConflictException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `不支持的节点类型: ${nodeType}`,
        });
    }
  }
}
