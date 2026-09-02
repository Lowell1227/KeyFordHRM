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
export type TaskReminderNodeType = 'employee' | 'manager' | 'deptHead' | 'hr' | 'approver';

interface CreateNotificationParams {
  userId: string;
  senderId?: string | null;
  taskId?: string | null;
  cycleId?: string | null;
  type: string;
  title: string;
  content: string;
  extraData?: Prisma.InputJsonValue;
}

interface TaskHandlerSnapshot {
  id: string;
  cycleId: string;
  employeeId: string;
  managerId: string | null;
  deptHeadId: string | null;
  approverId: string | null;
  hrId: string | null;
}

interface CycleReviewReminderParams {
  cycleId: string;
  cycleName: string;
  senderId: string;
  recipientIds: string[];
}

const REVIEW_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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
    const { userId, senderId = null, taskId = null, cycleId = null, type, title, content, extraData } = params;

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
        extraData,
      },
    });

    await this.deliver(log.id, params, user.dingtalkId);
    return log.id;
  }

  private async deliver(
    logId: string,
    params: Pick<CreateNotificationParams, 'userId' | 'cycleId' | 'type' | 'title' | 'content' | 'extraData'>,
    dingtalkId: string | null,
  ): Promise<void> {
    const { userId, cycleId = null, type, title, content, extraData } = params;
    try {
      const result = await this.pushProvider.push({
        userId,
        dingtalkId,
        cycleId,
        type,
        title,
        content,
      });

      await this.prisma.notificationLog.updateMany({
        where: { id: logId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          channel: result.channel,
          extraData: result.externalId
            ? { ...(extraData && typeof extraData === 'object' && !Array.isArray(extraData) ? extraData : {}), externalId: result.externalId }
            : undefined,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`消息推送失败: ${message}`, error instanceof Error ? error.stack : undefined);
      await this.prisma.notificationLog.updateMany({
        where: { id: logId },
        data: {
          status: 'failed',
          errorMsg: message,
        },
      });
    }
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
   * 同一任务、节点和收件人 24 小时内已发送则抛 4029。
   */
  async sendTaskReminder(taskId: string, nodeType: TaskReminderNodeType, senderId: string) {
    const task = await this.findTaskOrThrow(taskId);
    const recipientId = this.resolveTaskHandler(task, nodeType);
    if (!recipientId) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '该任务当前节点无处理人',
      });
    }

    return this.createRateLimitedTaskReminder({
      userId: recipientId,
      senderId,
      taskId,
      cycleId: task.cycleId,
      type: 'task_reminder',
      title: '绩效任务催办',
      content: '您有一项绩效任务待处理，请及时处理。',
      extraData: { nodeType },
    });
  }

  async getReminderCooldownUntil(
    taskId: string,
    nodeType: TaskReminderNodeType,
    recipientId: string,
  ): Promise<Date | null> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const latest = await this.prisma.notificationLog.findFirst({
      where: {
        taskId,
        userId: recipientId,
        type: 'task_reminder',
        extraData: { path: ['nodeType'], equals: nodeType },
        createdAt: { gte: cutoff },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return latest ? new Date(latest.createdAt.getTime() + 24 * 60 * 60 * 1000) : null;
  }

  async getCycleReviewReminderCooldownUntil(cycleId: string): Promise<Date | null> {
    const cutoff = new Date(Date.now() - REVIEW_REMINDER_COOLDOWN_MS);
    const latest = await this.prisma.notificationLog.findFirst({
      where: {
        cycleId,
        type: 'cycle_review_reminder',
        createdAt: { gte: cutoff },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return latest
      ? new Date(latest.createdAt.getTime() + REVIEW_REMINDER_COOLDOWN_MS)
      : null;
  }

  /** 审核催办只进入站内通知，不调用钉钉或其他外部推送。 */
  async sendCycleReviewReminder(params: CycleReviewReminderParams): Promise<{
    recipientCount: number;
    reminderAvailableAt: Date;
  }> {
    const recipientIds = [...new Set(params.recipientIds)];
    const now = new Date();
    const cutoff = new Date(now.getTime() - REVIEW_REMINDER_COOLDOWN_MS);
    const reminderAvailableAt = new Date(now.getTime() + REVIEW_REMINDER_COOLDOWN_MS);
    const lockKey = `cycle-review-reminder:${params.cycleId}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const existing = await tx.notificationLog.findFirst({
        where: {
          cycleId: params.cycleId,
          type: 'cycle_review_reminder',
          createdAt: { gte: cutoff },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        throw new ConflictException({
          code: ERROR_CODE.RATE_LIMITED,
          message: '本周期 24 小时内已催办过',
        });
      }

      await tx.notificationLog.createMany({
        data: recipientIds.map((userId) => ({
          userId,
          senderId: params.senderId,
          cycleId: params.cycleId,
          taskId: null,
          type: 'cycle_review_reminder',
          title: '考核周期待审核',
          content: `“${params.cycleName}”等待您审核，请及时处理。`,
          channel: 'system',
          status: 'sent',
          isRead: false,
          readAt: null,
          sentAt: now,
          extraData: { action: 'cycle_review' },
        })),
      });
      await tx.auditLog.create({
        data: {
          userId: params.senderId,
          action: 'cycle_review_reminded',
          entityType: 'assessment_cycle',
          entityId: params.cycleId,
          newValue: { recipientIds },
        },
      });
    });

    return { recipientCount: recipientIds.length, reminderAvailableAt };
  }

  /** 结果公示通知：发给被考核员工，不限频。 */
  async sendResultPublished(taskId: string) {
    const task = await this.findTaskOrThrow(taskId);
    return this.create({
      userId: task.employeeId,
      taskId,
      cycleId: task.cycleId,
      type: 'result_published',
      title: '绩效结果已公示',
      content: '您的绩效结果已公示，请查看。',
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
   * 供定时任务调用，与人工催办共用同一 24 小时限频。
   */
  async sendBatchReminders(cycleId: string, nodeType: TaskReminderNodeType) {
    const handlerField = nodeType === 'hr' ? null : this.nodeTypeToHandlerField(nodeType);
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
        cycle: { select: { hrOwnerId: true } },
      },
    });

    const results: string[] = [];
    for (const task of tasks) {
      const recipientId = nodeType === 'hr' ? task.cycle.hrOwnerId : task[handlerField!];
      if (!recipientId) continue;

      try {
        const id = await this.createRateLimitedTaskReminder({
          userId: recipientId,
          senderId: null,
          taskId: task.id,
          cycleId: task.cycleId,
          type: 'task_reminder',
          title: '绩效任务催办',
          content: '您有一项绩效任务待处理，请及时处理。',
          extraData: { nodeType },
        });
        if (id) results.push(id);
      } catch (error) {
        if (!(error instanceof ConflictException) || (error.getResponse() as any)?.code !== ERROR_CODE.RATE_LIMITED) {
          throw error;
        }
      }
    }

    return results;
  }

  /** 同一任务、节点和收件人 24 小时内只创建一条催办，与发送人无关。 */
  private async createRateLimitedTaskReminder(
    params: CreateNotificationParams & { taskId: string; extraData: { nodeType: TaskReminderNodeType } },
  ): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId, deletedAt: null },
      select: { dingtalkId: true },
    });
    if (!user) return null;

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const nodeType = params.extraData.nodeType;
    const lockKey = `task-reminder:${params.taskId}:${nodeType}:${params.userId}`;
    const log = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const existing = await tx.notificationLog.findFirst({
        where: {
          taskId: params.taskId,
          userId: params.userId,
          type: 'task_reminder',
          extraData: { path: ['nodeType'], equals: nodeType },
          createdAt: { gte: cutoff },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        throw new ConflictException({
          code: ERROR_CODE.RATE_LIMITED,
          message: '该环节 24 小时内已催办过',
        });
      }
      const log = await tx.notificationLog.create({
        data: {
          userId: params.userId,
          senderId: params.senderId ?? null,
          taskId: params.taskId,
          cycleId: params.cycleId ?? null,
          type: 'task_reminder',
          title: params.title,
          content: params.content,
          status: 'pending',
          channel: 'dingtalk',
          isRead: false,
          readAt: null,
          extraData: params.extraData,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: params.senderId ?? null,
          action: 'task_reminded',
          entityType: 'assessment_task',
          entityId: params.taskId,
          newValue: {
            nodeType,
            recipientId: params.userId,
          },
        },
      });
      return log;
    });

    await this.deliver(log.id, params, user.dingtalkId);
    return log.id;
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
        cycle: { select: { hrOwnerId: true } },
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '任务不存在',
      });
    }
    return { ...task, hrId: task.cycle?.hrOwnerId ?? null };
  }

  private resolveTaskHandler(task: TaskHandlerSnapshot, nodeType: TaskReminderNodeType): string | null {
    if (nodeType === 'hr') return task.hrId;
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
      case 'hr':
        return ['hr_calibration'];
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
