import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AssessmentCycle, CycleStatus, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService, TaskReminderNodeType } from '@/notifications/notifications.service';
import { LaunchService } from '@/cycles/launch.service';
import { AuthUser } from '@/common/types/auth.types';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';
import {
  monthlyEmployeeReminderKind,
  monthlyReminderKind,
  shanghaiDateKey,
} from '@/period-reviews/monthly-reminder-policy';

/** 进行中的周期状态（draft/closed 除外）。 */
const ACTIVE_CYCLE_STATUSES: CycleStatus[] = [
  'indicator_setting',
  'self_eval',
  'manager_score',
  'hr_calibration',
  'approval',
  'published',
  'appeal',
];

/** 需要催办的节点配置。 */
interface ReminderNodeConfig {
  /** 催办节点类型（传给 NotificationsService）。 */
  nodeType: TaskReminderNodeType;
  /** 该节点关注的周期截止日字段（任一临期/超期即触发一次催办）。 */
  deadlineFields: Array<
    keyof Pick<
      AssessmentCycle,
      | 'deadlineIndicatorConfirm'
      | 'deadlineSelfEval'
      | 'deadlineManagerScore'
      | 'deadlineHrCalibration'
      | 'deadlineApproval'
    >
  >;
}

const REMINDER_NODES: ReminderNodeConfig[] = [
  { nodeType: 'employee', deadlineFields: ['deadlineIndicatorConfirm', 'deadlineSelfEval'] },
  { nodeType: 'manager', deadlineFields: ['deadlineManagerScore'] },
  { nodeType: 'deptHead', deadlineFields: ['deadlineManagerScore'] },
  { nodeType: 'approver', deadlineFields: ['deadlineApproval'] },
];

/** 归档时排除的任务状态。 */
const CLOSED_TASK_STATUSES: TaskStatus[] = ['closed', 'exempted'];

/**
 * 定时任务编排服务。
 *
 * 核心 cron 包括截止日催办、自动关周期和周期节点开放。
 *
 * 所有 cron 均包 try/catch，单次失败只记日志不影响下次调度。
 * 核心逻辑抽成 public 方法，便于单测与手动触发。
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly launchService: LaunchService,
    private readonly employeeEffectiveDates: EmployeeEffectiveDateService,
  ) {}

  /** 每天 00:10 把已审核、当天生效的任职记录投影到员工当前状态。 */
  @Cron('10 0 * * *', { timeZone: 'Asia/Shanghai' })
  async refreshEmployeeEffectiveDates(): Promise<void> {
    try {
      const result = await this.employeeEffectiveDates.refreshEffectiveProjections(new Date());
      this.logger.log(`员工任职生效刷新完成：${result.updated}/${result.checked}`);
    } catch (err) {
      this.logger.error('员工任职生效刷新异常', err);
    }
  }

  /** 每 5 分钟检查预约发起的考核周期。 */
  @Cron('*/5 * * * *')
  async openScheduledCycles(): Promise<void> {
    try {
      await this.runScheduledCycleOpenings();
    } catch (err) {
      this.logger.error('预约发起考核周期定时任务异常', err);
    }
  }

  /** 每 5 分钟检查自评开放时间。 */
  @Cron('*/5 * * * *')
  async openSelfEvaluations(): Promise<void> {
    try {
      await this.runSelfEvalOpenings();
      await this.runPeriodSelfEvalOpenings();
    } catch (err) {
      this.logger.error('开放绩效自评定时任务异常', err);
    }
  }

  /** 09:00 截止日催办。 */
  @Cron('0 9 * * *')
  async sendDeadlineReminders(): Promise<void> {
    try {
      await this.runDeadlineReminders();
      this.logger.log('截止日催办定时任务完成');
    } catch (err) {
      this.logger.error('截止日催办定时任务异常', err);
    }
  }

  /** 03:00 自动关周期。 */
  @Cron('0 3 * * *')
  async autoCloseCycles(): Promise<void> {
    try {
      await this.runAutoCloseCycles();
      this.logger.log('自动关周期定时任务完成');
    } catch (err) {
      this.logger.error('自动关周期定时任务异常', err);
    }
  }

  // ---------------------------------------------------------------------------
  // 可测试 / 可手动触发的核心逻辑
  // ---------------------------------------------------------------------------

  /**
   * 截止日催办核心逻辑。
   * 对进行中周期，检查各节点截止日是否已超期或临期，
   * 若是则按节点类型批量催办（系统调用，不受 D19 单人限频）。
   * 同一 nodeType 的多个截止日合并为一次 sendBatchReminders，避免重复通知。
   */
  async runDeadlineReminders(): Promise<void> {
    const reminderDays = await this.loadDeadlineReminderDays();
    const now = new Date();
    await this.runMonthlyPeriodReminders(now);

    const cycles = await this.prisma.assessmentCycle.findMany({
      where: { status: { in: ACTIVE_CYCLE_STATUSES } },
      select: {
        id: true,
        status: true,
        deadlineIndicatorConfirm: true,
        deadlineSelfEval: true,
        deadlineManagerScore: true,
        deadlineHrCalibration: true,
        deadlineApproval: true,
        workflowVersion: true,
        scoringFrequency: true,
      },
    });

    for (const cycle of cycles) {
      for (const node of REMINDER_NODES) {
        if (
          cycle.workflowVersion === 2
          && cycle.scoringFrequency === 'monthly'
          && ['employee', 'manager', 'deptHead'].includes(node.nodeType)
        ) {
          continue;
        }
        const shouldRemind = node.deadlineFields.some((field) => {
          const deadline = cycle[field];
          return deadline ? this.isOverdueOrNear(deadline, reminderDays, now) : false;
        });

        if (!shouldRemind) continue;

        try {
          await this.notificationsService.sendBatchReminders(cycle.id, node.nodeType);
          this.logger.log(`周期 ${cycle.id} ${node.nodeType} 节点催办已发送`);
        } catch (err) {
          this.logger.error(`周期 ${cycle.id} ${node.nodeType} 节点催办失败`, err);
        }
      }
    }
  }

  /**
   * 自动关周期核心逻辑。
   * 申诉截止日已过且处于 published/appeal 的周期：
   * - 未结任务写入 performance_archives 快照（upsert 幂等）
   * - 任务状态改为 closed
   * - 周期改为 closed 并记录 closed_at
   */
  async runAutoCloseCycles(): Promise<void> {
    const today = this.startOfDay(new Date());

    const cycles = await this.prisma.assessmentCycle.findMany({
      where: {
        status: { in: ['published', 'appeal'] },
        deadlineAppeal: { lt: today },
      },
      select: { id: true, status: true },
    });

    if (cycles.length === 0) return;

    for (const cycle of cycles) {
      try {
        await this.closeCycle(cycle);
        this.logger.log(`周期 ${cycle.id} 已自动关闭并归档`);
      } catch (err) {
        this.logger.error(`周期 ${cycle.id} 自动关闭失败`, err);
      }
    }
  }

  async runScheduledCycleOpenings(): Promise<void> {
    const now = new Date();
    const cycles = await this.prisma.assessmentCycle.findMany({
      where: {
        status: 'scheduled',
        goalSettingOpenAt: { lte: now },
      },
      select: { id: true, scheduledById: true, hrOwnerId: true },
    });

    for (const cycle of cycles) {
      const operator = {
        id: cycle.scheduledById ?? '00000000-0000-4000-8000-000000000000',
        name: '系统定时任务',
        sysRole: 'system_admin',
        deptId: null,
        isAssessorOnly: true,
        canViewAll: true,
      } as AuthUser;
      try {
        await this.launchService.launch(cycle.id, operator, { source: 'scheduled', now });
        this.logger.log(`周期 ${cycle.id} 已按预约发起`);
      } catch (error) {
        const blocked = await this.prisma.$transaction(async (tx) => {
          const result = await tx.assessmentCycle.updateMany({
            where: { id: cycle.id, status: 'scheduled', openedAt: null },
            data: {
              status: 'launch_blocked',
              launchBlockedAt: now,
              launchBlockedReason: this.errorMessage(error),
            },
          });
          if (result.count === 1) {
            await tx.auditLog.create({
              data: {
                userId: cycle.scheduledById,
                action: 'cycle_goal_setting_open_failed',
                entityType: 'assessment_cycle',
                entityId: cycle.id,
                newValue: { reason: this.errorMessage(error), blockedAt: now.toISOString() },
              },
            });
          }
          return result;
        });
        if (blocked.count === 1 && cycle.hrOwnerId) {
          await this.notificationsService.create({
            userId: cycle.hrOwnerId,
            cycleId: cycle.id,
            type: 'cycle_launch_blocked',
            title: '季度目标发起受阻',
            content: `预约发起未完成：${this.errorMessage(error)}。请重新执行发起检查。`,
          });
        }
        this.logger.error(`周期 ${cycle.id} 预约发起受阻`, error);
      }
    }
  }

  async runSelfEvalOpenings(): Promise<void> {
    const now = new Date();
    const cycles = await this.prisma.assessmentCycle.findMany({
      where: {
        status: 'indicator_setting',
        selfEvalOpenAt: { lte: now },
        workflowVersion: 1,
      },
      select: { id: true },
    });

    for (const cycle of cycles) {
      await this.prisma.$transaction(async (tx) => {
        await tx.assessmentTask.updateMany({
          where: { cycleId: cycle.id, status: 'goal_confirmed' },
          data: { status: 'self_eval' },
        });
        await tx.assessmentCycle.update({
          where: { id: cycle.id },
          data: { status: 'self_eval' },
        });
      });
    }
  }

  /** 按月评分周期逐期开放员工月度自评，不沿用旧周期的一次性开放。 */
  async runPeriodSelfEvalOpenings(): Promise<void> {
    const now = new Date();
    const periods = await this.prisma.assessmentPeriod.findMany({
      where: {
        status: 'unopened',
        indicatorVersionId: { not: null },
        selfEvalOpenAt: { lte: now },
        task: { cycle: { workflowVersion: 2 } },
      },
      select: {
        id: true,
        taskId: true,
        periodKey: true,
        task: {
          select: {
            cycleId: true,
            employeeId: true,
            cycle: { select: { notificationMode: true } },
          },
        },
      },
      orderBy: [{ selfEvalOpenAt: 'asc' }, { id: 'asc' }],
    });

    for (const period of periods) {
      const claimed = await this.prisma.assessmentPeriod.updateMany({
        where: {
          id: period.id,
          status: 'unopened',
          indicatorVersionId: { not: null },
        },
        data: { status: 'self_eval', openedAt: now },
      });
      if (claimed.count !== 1) continue;

      await this.prisma.assessmentTask.updateMany({
        where: { id: period.taskId, status: 'goal_confirmed' },
        data: { status: 'self_eval' },
      });
      if (period.task.cycle.notificationMode !== 'off') {
        await this.notificationsService.create({
          userId: period.task.employeeId,
          cycleId: period.task.cycleId,
          taskId: period.taskId,
          type: 'monthly_employee_review_opened',
          title: '本月月度自评已开放',
          content: `${period.periodKey}月度自评已开放，请按计划完成填写。`,
          extraData: {
            taskId: period.taskId,
            periodId: period.id,
            periodKey: period.periodKey,
            action: 'employee_period_review',
          },
        });
      }
    }
  }

  private async runMonthlyPeriodReminders(now: Date): Promise<void> {
    const periods = await this.prisma.assessmentPeriod.findMany({
      where: {
        task: { cycle: { workflowVersion: 2, scoringFrequency: 'monthly' } },
        OR: [
          { status: 'self_eval', employeeSubmittedAt: null },
          {
            status: 'manager_scoring',
            employeeSubmittedAt: { not: null },
            managerSubmittedAt: null,
            managerId: { not: null },
          },
        ],
      },
      select: {
        id: true,
        taskId: true,
        periodKey: true,
        status: true,
        selfEvalDueAt: true,
        managerDueAt: true,
        employeeSubmittedAt: true,
        managerSubmittedAt: true,
        task: {
          select: {
            cycleId: true,
            employeeId: true,
            managerId: true,
            cycle: { select: { notificationMode: true } },
          },
        },
      },
      orderBy: [{ selfEvalDueAt: 'asc' }, { id: 'asc' }],
    });
    const dateKey = shanghaiDateKey(now);
    for (const period of periods) {
      if (period.task.cycle.notificationMode === 'off') continue;
      if (period.status === 'manager_scoring') {
        if (!period.task.managerId) continue;
        const managerKind = monthlyReminderKind(now, period.managerDueAt, period.managerSubmittedAt);
        if (!managerKind) continue;
        const managerOverdue = managerKind === 'overdue_1' || managerKind === 'overdue_every_3';
        await this.notificationsService.create({
          dedupeKey: `monthly-manager-score:${period.id}:${period.task.managerId}:${managerKind}:${dateKey}`,
          userId: period.task.managerId,
          cycleId: period.task.cycleId,
          taskId: period.taskId,
          type: managerOverdue ? 'monthly_manager_score_overdue' : 'monthly_manager_score_reminder',
          title: managerOverdue ? `${period.periodKey}主管月度评分已逾期` : `${period.periodKey}主管月度评分待完成`,
          content: managerOverdue ? '主管月度评分已超过截止时间，请尽快完成。' : '员工已提交月度自评，请按计划完成主管月度评分。',
          extraData: {
            taskId: period.taskId,
            periodId: period.id,
            periodKey: period.periodKey,
            action: 'manager_period_review',
          },
        });
        continue;
      }
      const kind = monthlyEmployeeReminderKind(
        now,
        period.selfEvalDueAt,
        period.employeeSubmittedAt,
      );
      if (!kind) continue;
      const overdue = kind === 'overdue_1' || kind === 'overdue_every_3';
      await this.notificationsService.create({
        dedupeKey: `monthly-self-eval:${period.id}:${period.task.employeeId}:${kind}:${dateKey}`,
        userId: period.task.employeeId,
        cycleId: period.task.cycleId,
        taskId: period.taskId,
        type: overdue ? 'monthly_self_eval_overdue' : 'monthly_self_eval_reminder',
        title: overdue ? `${period.periodKey}月度自评已逾期` : `${period.periodKey}月度自评待完成`,
        content: overdue ? '月度自评已超过截止时间，请尽快完成。' : '请按计划完成本月月度自评。',
        extraData: {
          taskId: period.taskId,
          periodId: period.id,
          periodKey: period.periodKey,
          action: 'employee_period_review',
        },
      });
      if (overdue && period.task.managerId) {
        await this.notificationsService.create({
          dedupeKey: `monthly-self-eval:${period.id}:${period.task.managerId}:${kind}:${dateKey}`,
          userId: period.task.managerId,
          cycleId: period.task.cycleId,
          taskId: period.taskId,
          type: 'monthly_self_eval_overdue_manager_notice',
          title: `${period.periodKey}员工月度自评已逾期`,
          content: '该员工尚未提交月度自评，系统仅提醒，不会自动推进主管评分。',
          extraData: {
            taskId: period.taskId,
            periodId: period.id,
            periodKey: period.periodKey,
            action: 'manager_period_review',
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  private async closeCycle(
    cycle: Pick<AssessmentCycle, 'id'>,
  ): Promise<void> {
    const closedAt = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        const tasks = await tx.assessmentTask.findMany({
          where: {
            cycleId: cycle.id,
            status: { notIn: CLOSED_TASK_STATUSES },
          },
          include: {
            employee: { select: { name: true } },
            dept: { select: { name: true } },
            gradeResult: {
              select: {
                calculatedScore: true,
                rawGrade: true,
                calibratedGrade: true,
                coefficient: true,
              },
            },
            indicatorInstances: {
              select: {
                name: true,
                dimensionName: true,
                weight: true,
                indicatorType: true,
                targetValue: true,
                targetValueText: true,
                actualValue: true,
                selfScore: true,
                managerScore: true,
                finalScore: true,
              },
            },
          },
        });

        for (const task of tasks) {
          const grade = task.gradeResult?.calibratedGrade ?? task.gradeResult?.rawGrade ?? null;
          if (!grade) {
            this.logger.warn(
              `周期 ${cycle.id} 任务 ${task.id} 无等级，跳过 performance_archives 归档`,
            );
          } else {
            await tx.performanceArchive.upsert({
              where: {
                employeeId_cycleId: {
                  employeeId: task.employeeId,
                  cycleId: cycle.id,
                },
              },
              create: {
                employeeId: task.employeeId,
                cycleId: cycle.id,
                employeeName: task.employee?.name ?? '',
                deptName: task.dept?.name ?? null,
                grade,
                totalScore: task.gradeResult?.calculatedScore ?? new Prisma.Decimal(0),
                coefficient: task.gradeResult?.coefficient ?? null,
                summary: this.buildArchiveSummary(task),
                archivedAt: closedAt,
              },
              update: {
                employeeName: task.employee?.name ?? '',
                deptName: task.dept?.name ?? null,
                grade,
                totalScore: task.gradeResult?.calculatedScore ?? new Prisma.Decimal(0),
                coefficient: task.gradeResult?.coefficient ?? null,
                summary: this.buildArchiveSummary(task),
                archivedAt: closedAt,
              },
            });
          }

          await tx.assessmentTask.update({
            where: { id: task.id },
            data: { status: 'closed', closedAt },
          });
        }

        await tx.assessmentCycle.update({
          where: { id: cycle.id },
          data: { status: 'closed', closedAt },
        });
      },
      { timeout: 60000, maxWait: 10000 },
    );
  }

  private buildArchiveSummary(
    task: {
      indicatorInstances: Array<{
        name: string;
        dimensionName: string | null;
        weight: Prisma.Decimal;
        indicatorType: string;
        targetValue: Prisma.Decimal | null;
        targetValueText: string | null;
        actualValue: Prisma.Decimal | null;
        selfScore: Prisma.Decimal | null;
        managerScore: Prisma.Decimal | null;
        finalScore: Prisma.Decimal | null;
      }>;
    } & {
      gradeResult: {
        calculatedScore: Prisma.Decimal | null;
        rawGrade: string | null;
        calibratedGrade: string | null;
        coefficient: Prisma.Decimal | null;
      } | null;
    },
  ): Prisma.InputJsonValue {
    return {
      indicators: task.indicatorInstances.map((ind) => ({
        name: ind.name,
        dimensionName: ind.dimensionName,
        weight: ind.weight.toNumber(),
        indicatorType: ind.indicatorType,
        targetValue: ind.targetValue?.toNumber() ?? null,
        targetValueText: ind.targetValueText,
        actualValue: ind.actualValue?.toNumber() ?? null,
        selfScore: ind.selfScore?.toNumber() ?? null,
        managerScore: ind.managerScore?.toNumber() ?? null,
        finalScore: ind.finalScore?.toNumber() ?? null,
      })),
      calculatedScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: task.gradeResult?.rawGrade ?? null,
      calibratedGrade: task.gradeResult?.calibratedGrade ?? null,
      coefficient: task.gradeResult?.coefficient?.toNumber() ?? null,
    } as Prisma.InputJsonValue;
  }

  private async loadDeadlineReminderDays(): Promise<number> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'deadline_reminder_days' },
    });

    if (!config) return 3;

    const value = config.value as number | { value?: number } | undefined;
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && typeof value.value === 'number') {
      return value.value;
    }
    return 3;
  }

  private isOverdueOrNear(deadline: Date, reminderDays: number, now: Date): boolean {
    const threshold = this.startOfDay(now);
    threshold.setDate(threshold.getDate() + reminderDays);
    return this.startOfDay(deadline).getTime() <= threshold.getTime();
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private errorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'getResponse' in error) {
      const response = (error as { getResponse: () => unknown }).getResponse();
      if (response && typeof response === 'object' && 'message' in response) {
        return String(response.message);
      }
      return String(response);
    }
    return error instanceof Error ? error.message : '发起检查失败';
  }
}
