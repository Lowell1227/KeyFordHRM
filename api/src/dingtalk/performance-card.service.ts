import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BotEligibilityService,
  BotSender,
} from '../ai-progress/bot-eligibility.service';
import { TaskDetail, TasksService } from '../tasks/tasks.service';
import { TaskQueryDto } from '../tasks/dto/task-query.dto';
import { AuthUser } from '../common/types/auth.types';
import { PeriodReviewDetail } from '../period-reviews/period-review.types';
import {
  canEmployeeViewResult,
  isResultPublished,
} from '../tasks/result-publication';
import { PeriodReviewsService } from '../period-reviews/period-reviews.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImprovementWorkflowService } from '../improvement-plans/improvement-workflow.service';

export interface PerformanceCard {
  kind: 'todo' | 'goal' | 'evaluation' | 'result';
  subjectKey: string;
  params: Record<string, string>;
}
export type PerformanceCardReply =
  | { kind: 'reply'; text: string }
  | { kind: 'cards'; cards: PerformanceCard[]; text?: string };

@Injectable()
export class PerformanceCardService {
  constructor(
    private readonly eligibility: BotEligibilityService,
    private readonly tasks: TasksService,
    private readonly periods: PeriodReviewsService,
    private readonly prisma: PrismaService,
    private readonly improvements: ImprovementWorkflowService,
    private readonly config: ConfigService,
  ) {}

  async query(
    text: string,
    sender: BotSender,
  ): Promise<PerformanceCardReply | null> {
    const intent = (
      {
        我的绩效: 'todo',
        我的待办: 'todo',
        绩效待办: 'todo',
        我的目标: 'goal',
        查看目标: 'goal',
        制定目标: 'goal',
        我的自评: 'evaluation',
        填写自评: 'evaluation',
        绩效评价: 'evaluation',
        我的结果: 'result',
        查看结果: 'result',
        帮助: 'help',
      } as const
    )[text.trim().replace(/[。！？!?]+$/, '')];
    if (!intent) return null;
    const identity = await this.eligibility.resolveIdentity(sender);
    if (identity.kind === 'reply') return identity;
    if (intent === 'help')
      return {
        kind: 'reply',
        text: '发送“我的待办”“我的目标”“我的自评”“我的结果”查看本人事项；直接发送真实工作进展可生成待保存卡片，核对后再保存。',
      };
    this.url('/tasks'); // Validate configured origin before any projection.
    const viewer = identity.viewer;
    if (intent === 'todo') return this.todos(viewer);

    const page = await this.tasks.findMine(
      Object.assign(new TaskQueryDto(), { pageSize: 100 }),
      viewer,
    );
    const cards: PerformanceCard[] = [];
    for (const item of page.items) {
      if (item.employeeId !== viewer.id || item.isExempt) continue;
      const task = await this.load(item.id, viewer);
      // Personal intent stays personal even when the viewer has global HR access.
      if (!task || task.employeeId !== viewer.id || task.isExempt) continue;
      if (intent === 'goal') cards.push(this.goal(task));
      if (intent === 'result') {
        const card = this.result(task);
        if (card) cards.push(card);
      }
      if (intent === 'evaluation') {
        if (task.workflowVersion === 2 && task.periods.length) {
          for (const period of task.periods) {
            if (period.status === 'unopened') continue;
            const review = await this.review(task, period.id, viewer);
            if (review) cards.push(this.evaluation(task, review, 'employee'));
          }
        } else if (
          task.workflowVersion !== 2 &&
          ![
            'pending',
            'indicator_drafting',
            'indicator_setting',
            'indicator_reviewing',
            'indicator_confirming',
            'indicator_dept_reviewing',
            'indicator_approving',
            'goal_confirmed',
          ].includes(task.status)
        ) {
          cards.push(this.legacyEvaluation(task, viewer));
        }
      }
      if (cards.length > 5) break;
    }
    if (!cards.length)
      return {
        kind: 'reply',
        text:
          page.total > 100
            ? `本次查询未找到可展示的事项，请在 HRM 查看全部周期：${this.url('/tasks')}`
            : {
                goal: '目前没有本人的考核目标任务。',
                evaluation: '目前没有已开放的本人自评期间。',
                result: '目前没有可查看的已审批结果或重评事项。',
              }[intent],
      };
    return this.limit(cards, page.total > 100);
  }

  private async load(id: string, viewer: AuthUser) {
    try {
      return await this.tasks.findOne(id, viewer);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      )
        return null;
      throw error;
    }
  }

  private async review(
    task: Pick<TaskDetail, 'id'>,
    periodId: string,
    viewer: AuthUser,
  ) {
    try {
      const review = await this.periods.getReview(periodId, viewer);
      return review.period.id === periodId && review.period.taskId === task.id
        ? review
        : null;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      )
        return null;
      throw error;
    }
  }

  private async todos(viewer: AuthUser): Promise<PerformanceCardReply> {
    // Candidate IDs are not authorization. Every row is re-read through the existing service.
    const candidates = await this.prisma.assessmentTask.findMany({
      where: {
        isExempt: false,
        OR: [
          { employeeId: viewer.id },
          { managerId: viewer.id },
          { deptHeadId: viewer.id },
          { approverId: viewer.id },
          { cycle: { hrOwnerId: viewer.id } },
          { periods: { some: { managerId: viewer.id } } },
          { status: 'hr_calibration' },
        ],
      },
      select: {
        id: true,
        periods: {
          where: {
            managerId: viewer.id,
            status: { in: ['self_eval', 'manager_scoring'] },
          },
          select: { id: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 101,
    });
    const cards: PerformanceCard[] = [];
    for (const candidate of candidates.slice(0, 100)) {
      const task = await this.load(candidate.id, viewer);
      if (!task) {
        // A period-only manager may read their assigned review, not the full task or other periods.
        for (const period of candidate.periods ?? []) {
          const review = await this.review(candidate, period.id, viewer);
          if (review?.permissions.canEditManager)
            cards.push(
              this.evaluation(
                {
                  id: candidate.id,
                  cycleName: review.context.cycleName,
                  employeeName: review.context.employeeName,
                },
                review,
                'manager',
              ),
            );
        }
        if (cards.length > 5) break;
        continue;
      }
      if (task.isExempt) continue;
      let periodAction = false;
      if (task.workflowVersion === 2) {
        for (const period of task.periods) {
          if (!['self_eval', 'manager_scoring'].includes(period.status))
            continue;
          // The period's frozen manager can differ from the task manager; permissions come from getReview.
          const review = await this.review(task, period.id, viewer);
          if (!review) continue;
          const role = review.permissions.canEditEmployee
            ? 'employee'
            : review.permissions.canEditManager
              ? 'manager'
              : null;
          if (role) {
            cards.push(this.evaluation(task, review, role));
            periodAction = true;
          }
        }
      }
      if (
        !periodAction &&
        task.workflowContext.currentHandler?.id === viewer.id
      ) {
        if (
          [
            'indicator_drafting',
            'indicator_setting',
            'indicator_reviewing',
            'indicator_confirming',
            'indicator_dept_reviewing',
            'indicator_approving',
          ].includes(task.status)
        ) {
          cards.push(
            task.employeeId === viewer.id
              ? this.goal(task)
              : this.todo(task, '审核绩效目标', 'goal-setting'),
          );
        } else if (
          task.status === 'manager_scoring' &&
          task.managerId === viewer.id &&
          task.managerStageState === 'pending'
        ) {
          cards.push(
            task.workflowVersion === 2 && task.periods.length
              ? this.card('evaluation', `task:${task.id}:final-grade`, {
                  cycleLabel: task.cycleName,
                  periodLabel: '整周期',
                  reviewRoleLabel: '绩效直属上级',
                  stateLabel: '待周期评定',
                  summary: `请核对${task.employeeName}的周期结果并提交评定。`,
                  dueLabel: this.date(task.workflowContext.currentDeadline),
                  primaryText: '提交周期评定',
                  primaryUrl: this.url(
                    `/tasks/${encodeURIComponent(task.id)}/final-grade`,
                  ),
                  submittedLabel: '',
                })
              : this.legacyEvaluation(task, viewer),
          );
        } else if (
          task.status === 'self_eval' &&
          (task.workflowVersion !== 2 || !task.periods.length)
        ) {
          cards.push(this.legacyEvaluation(task, viewer));
        } else if (
          task.status === 'approval' &&
          task.approvedAt &&
          task.employeeId === viewer.id
        ) {
          const result = this.result(task);
          if (result) cards.push(result);
        } else if (
          ['dept_review', 'hr_calibration', 'approval', 'appealing'].includes(
            task.status,
          )
        ) {
          const action = {
            dept_review: '复核绩效结果',
            hr_calibration: '办理绩效校准',
            approval: '审批绩效结果',
            appealing: '查看处理事项',
          }[task.status]!;
          const card = this.todo(task, action, 'result');
          if (task.status === 'approval' || task.status === 'hr_calibration') {
            card.params.primaryUrl = this.url(
              `/${task.status === 'approval' ? 'approval' : 'calibration'}?${new URLSearchParams({ cycleId: task.cycleId })}`,
            );
          }
          if (task.status === 'dept_review')
            card.params.primaryUrl += '&returnTo=%2Fdepartment-review';
          cards.push(card);
        }
      }
      if (cards.length > 5) break;
    }
    const plans = await this.improvements.myPending(viewer);
    for (const plan of plans) {
      if (plan.currentOwnerId !== viewer.id || !plan.allowedActions.length)
        continue;
      cards.push(
        this.card('todo', `improvement:${plan.id}`, {
          title: '绩效改进计划',
          subjectName: plan.employeeName,
          cycleLabel: plan.cycleName ?? '',
          periodLabel: '',
          stateLabel: '待本人办理',
          summary: '请进入改进计划，按当前环节办理。',
          dueLabel: this.date(plan.targetDate),
          primaryText: '处理改进计划',
          primaryUrl: this.url('/improvement-plans'),
          secondaryText: '',
          secondaryUrl: '',
        }),
      );
    }
    if (!cards.length)
      cards.push(
        this.card('todo', 'none', {
          title: '我的绩效待办',
          subjectName: viewer.name,
          cycleLabel: '',
          periodLabel: '',
          stateLabel: candidates.length > 100 ? '查看全部待办' : '暂无待办',
          summary:
            candidates.length > 100
              ? '本次查询范围内没有待办，请进入 HRM 查看全部事项。'
              : '当前没有需要你办理的绩效事项。',
          dueLabel: '',
          primaryText: '查看我的绩效',
          primaryUrl: this.url('/tasks'),
          secondaryText: '',
          secondaryUrl: '',
        }),
      );
    return this.limit(cards, candidates.length > 100);
  }

  private goal(task: TaskDetail): PerformanceCard {
    const latest = task.flowRecords.find((record) =>
      ['indicator_setting', 'indicator_confirm', 'indicator_dept_review', 'indicator_approval'].includes(record.nodeType),
    );
    const returned =
      task.status === 'indicator_drafting' && latest?.action === 'reject';
    const editing = task.status === 'indicator_drafting';
    const confirming = task.status === 'indicator_confirming';
    const reviewing = ['indicator_setting', 'indicator_reviewing', 'indicator_dept_reviewing', 'indicator_approving'].includes(
      task.status,
    );
    return this.card('goal', `task:${task.id}`, {
      cycleLabel: task.cycleName,
      stateLabel: returned
        ? '目标需修改'
        : confirming
          ? '待本人确认目标'
          : editing
            ? '待制定目标'
            : reviewing
              ? (task.status === 'indicator_dept_reviewing' ? '待部门负责人审核目标' : task.status === 'indicator_approving' ? '待分管领导审核目标' : '等待上级审核')
              : '查看本期目标',
      goalCount: String(task.indicatorInstances.length),
      summary: editing
        ? '请完善本期考核目标并提交审核。'
        : confirming
          ? '请核对上级审核后的目标。'
          : reviewing
            ? '目标仍在审核中，通过全部审核后生效。'
            : '请进入本期任务查看正式目标及当前状态。',
      feedbackSummary: returned ? this.short(latest?.comment) : '',
      primaryText: returned
        ? '根据反馈修改'
        : editing
          ? '制定目标'
          : confirming
            ? '查看并确认目标'
            : reviewing
              ? '查看已提交目标'
              : '查看目标',
      primaryUrl: this.taskUrl(
        task.id,
        confirming ? 'goal-confirmation' : 'goal-setting',
      ),
      updatedLabel: this.date(task.updatedAt),
    });
  }

  private evaluation(
    task: Pick<TaskDetail, 'id' | 'cycleName' | 'employeeName'>,
    review: PeriodReviewDetail,
    role: 'employee' | 'manager',
  ) {
    const period = review.period;
    const editable =
      role === 'employee'
        ? review.permissions.canEditEmployee
        : review.permissions.canEditManager;
    return this.card(
      'evaluation',
      `task:${task.id}:period:${period.id}:${role}`,
      {
        cycleLabel: task.cycleName,
        periodLabel:
          period.periodType === 'cycle' ? '整周期' : period.periodKey,
        reviewRoleLabel:
          role === 'employee'
            ? '员工本人自评'
            : `${task.employeeName} · 绩效直属上级评价`,
        stateLabel: editable ? '待本人填写' : review.context.statusLabel,
        summary: editable
          ? '请核对本期工作进展，在原页面完成评价并提交。'
          : '本期内容按当前办理状态展示，进入页面查看最新进度。',
        dueLabel: this.date(
          role === 'employee' ? period.selfEvalDueAt : period.managerDueAt,
        ),
        primaryText: editable
          ? role === 'manager'
            ? '填写本期评价'
            : period.periodType === 'cycle'
              ? '填写周期自评'
              : '填写本月自评'
          : '查看本期自评',
        primaryUrl: this.url(
          `/tasks/${encodeURIComponent(task.id)}/periods/${encodeURIComponent(period.id)}`,
        ),
        submittedLabel: this.date(
          role === 'employee'
            ? period.employeeSubmittedAt
            : period.managerSubmittedAt,
        ),
      },
    );
  }

  private legacyEvaluation(task: TaskDetail, viewer: AuthUser) {
    const employee = task.employeeId === viewer.id;
    const editable =
      task.workflowContext.currentHandler?.id === viewer.id &&
      task.status === (employee ? 'self_eval' : 'manager_scoring');
    return this.card('evaluation', `task:${task.id}:legacy`, {
      cycleLabel: task.cycleName,
      periodLabel: '整周期',
      reviewRoleLabel: employee ? '员工本人自评' : '绩效直属上级评价',
      stateLabel: task.workflowContext.statusLabel,
      summary: '请进入本期任务，按当前状态查看或办理。',
      dueLabel: this.date(task.workflowContext.currentDeadline),
      primaryText: editable
        ? employee
          ? '填写周期自评'
          : '填写本期评价'
        : '查看本期自评',
      primaryUrl: employee
        ? this.taskUrl(task.id, 'self-eval')
        : this.url(
            `/tasks?${new URLSearchParams({
              scope: 'team',
              stage: 'manager-eval',
              cycleId: task.cycleId,
              taskId: task.id,
            })}`,
          ),
      submittedLabel: '',
    });
  }

  private result(task: TaskDetail): PerformanceCard | null {
    const objection = task.flowRecords.some(
      (record) =>
        record.nodeType === 'employee_confirm' &&
        record.action === 'reject' &&
        record.extraData &&
        typeof record.extraData === 'object' &&
        !Array.isArray(record.extraData) &&
        record.extraData.type === 'employee_result_objection',
    );
    const published = isResultPublished(task);
    const approved = canEmployeeViewResult(task);
    if (
      !approved &&
      !(
        objection &&
        [
          'manager_scoring',
          'dept_review',
          'hr_calibration',
          'approval',
        ].includes(task.status)
      )
    )
      return null;
    const confirmed =
      !!(task.employeeConfirmedAt || task.gradeResult?.employeeConfirmedAt) ||
      task.status === 'confirmed';
    return this.card('result', `task:${task.id}`, {
      cycleLabel: task.cycleName,
      stateLabel: published
        ? '结果已公示'
        : !approved
          ? '结果重新评定中'
          : confirmed
            ? '已确认，待公示'
            : '待本人确认结果',
      summary: published
        ? '本周期结果已公示，请进入详情查看。'
        : !approved
          ? '结果已退回绩效直属上级重新评定，请查看最新办理进度。'
          : confirmed
            ? '结果已确认，等待 HR 公示。'
            : objection
              ? '重新评定的结果已完成审批，请再次核对。'
              : '本周期结果已完成审批，请核对并确认；确认后进入 HR 公示。',
      primaryText: !approved
        ? '查看重评进度'
        : published || confirmed
          ? '查看结果'
          : '查看并确认结果',
      primaryUrl: this.taskUrl(task.id, 'result'),
      updatedLabel: this.date(task.updatedAt),
    });
  }

  private todo(task: TaskDetail, primaryText: string, stage: string) {
    return this.card('todo', `task:${task.id}`, {
      title: '我的绩效待办',
      subjectName: task.employeeName,
      cycleLabel: task.cycleName,
      periodLabel: '',
      stateLabel: task.workflowContext.statusLabel,
      summary: '此事项当前由你办理，请进入原页面查看最新状态和操作。',
      dueLabel: this.date(task.workflowContext.currentDeadline),
      primaryText,
      primaryUrl: this.taskUrl(task.id, stage),
      secondaryText: '',
      secondaryUrl: '',
    });
  }

  private limit(
    cards: PerformanceCard[],
    truncated: boolean,
  ): PerformanceCardReply {
    return {
      kind: 'cards',
      cards: cards.slice(0, 5),
      ...(truncated || cards.length > 5
        ? {
            text: `本次最多展示5条，请进入 HRM 查看全部事项：${this.url('/tasks')}`,
          }
        : {}),
    };
  }
  private card(
    kind: PerformanceCard['kind'],
    subjectKey: string,
    params: Record<string, string>,
  ): PerformanceCard {
    return { kind, subjectKey, params };
  }
  private taskUrl(id: string, stage: string, periodId?: string) {
    const query = new URLSearchParams({ stage });
    if (periodId) query.set('periodId', periodId);
    return this.url(`/tasks/${encodeURIComponent(id)}?${query}`);
  }
  private url(path: string) {
    const origin = new URL(
      this.config.get<string>('DINGTALK_BOT_HRM_URL') ?? '',
    );
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new ServiceUnavailableException('绩效入口尚未配置，请联系管理员');
    return `${origin.origin}${path}`;
  }
  private short(value: string | null | undefined) {
    return (value ?? '').slice(0, 400);
  }
  private date(value: Date | string | null | undefined) {
    return value
      ? new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(value))
      : '';
  }
}
