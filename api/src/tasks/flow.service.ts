import { ConflictException, Injectable } from '@nestjs/common';
import { AssessmentTask, CycleStatus, FlowAction, FlowNodeType, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';

/** 流程转换定义。 */
export interface FlowTransition {
  from: TaskStatus;
  action: FlowAction;
  to: TaskStatus;
  nodeType: FlowNodeType;
}

/**
 * 状态转换表（后端文档 4.2 FLOW_TRANSITIONS）。
 *
 * manager_scoring → dept_review / hr_calibration 两条分支由调用方根据
 * managerId === deptHeadId 判断后传入目标状态。
 */
export const FLOW_TRANSITIONS: FlowTransition[] = [
  { from: 'indicator_drafting', action: 'submit', to: 'indicator_reviewing', nodeType: 'indicator_setting' },
  { from: 'indicator_reviewing', action: 'submit', to: 'indicator_confirming', nodeType: 'indicator_setting' },
  { from: 'indicator_reviewing', action: 'reject', to: 'indicator_drafting', nodeType: 'indicator_setting' },

  // 主管制定/调整指标后提交，等待员工确认
  { from: 'indicator_setting', action: 'submit', to: 'indicator_confirming', nodeType: 'indicator_setting' },
  { from: 'indicator_setting', action: 'submit', to: 'indicator_reviewing', nodeType: 'indicator_setting' },

  // 员工确认指标
  { from: 'indicator_setting', action: 'submit', to: 'goal_confirmed', nodeType: 'indicator_confirm' },
  { from: 'indicator_confirming', action: 'submit', to: 'goal_confirmed', nodeType: 'indicator_confirm' },
  // 自评开放时间已到时，迟交的目标确认可直接进入自评
  { from: 'indicator_setting', action: 'submit', to: 'self_eval', nodeType: 'indicator_confirm' },
  { from: 'indicator_confirming', action: 'submit', to: 'self_eval', nodeType: 'indicator_confirm' },
  // 员工退回指标，回到主管调整
  { from: 'indicator_setting', action: 'reject', to: 'indicator_setting', nodeType: 'indicator_confirm' },
  { from: 'indicator_confirming', action: 'reject', to: 'indicator_reviewing', nodeType: 'indicator_confirm' },

  // 员工提交自评
  { from: 'self_eval', action: 'submit', to: 'manager_scoring', nodeType: 'self_eval' },
  { from: 'self_eval', action: 'submit', to: 'hr_calibration', nodeType: 'self_eval' },

  // 主管评分后提交：分管部门负责人时直接到绩效校准，否则到部门负责人复核
  { from: 'manager_scoring', action: 'submit', to: 'dept_review', nodeType: 'manager_score' },
  { from: 'manager_scoring', action: 'submit', to: 'hr_calibration', nodeType: 'manager_score' },

  // 部门负责人复核
  { from: 'dept_review', action: 'approve', to: 'hr_calibration', nodeType: 'dept_review' },
  { from: 'dept_review', action: 'reject', to: 'manager_scoring', nodeType: 'dept_review' },

  // 绩效校准后提交结果审批（#10 范围）
  { from: 'hr_calibration', action: 'submit', to: 'approval', nodeType: 'hr_calibration' },
  // HR 校准驳回：退回直属上级重新评定（整周期结果评定）
  { from: 'hr_calibration', action: 'reject', to: 'manager_scoring', nodeType: 'hr_calibration' },

  // 审批通过 → 公示发布（#11 范围）
  { from: 'approval', action: 'approve', to: 'published', nodeType: 'publish' },
  // 审批人退回绩效校准（#11 范围）
  { from: 'approval', action: 'reject', to: 'hr_calibration', nodeType: 'approval' },

  // 员工确认结果
  { from: 'published', action: 'approve', to: 'confirmed', nodeType: 'employee_confirm' },
  // 员工申诉（#12 范围）
  { from: 'published', action: 'reject', to: 'appealing', nodeType: 'appeal' },

  // 申诉完结（#12 范围）
  { from: 'appealing', action: 'approve', to: 'closed', nodeType: 'appeal' },
];

/** 转换请求参数。 */
export interface TransitionInput {
  /** 源状态。 */
  task: Pick<AssessmentTask, 'id' | 'status' | 'cycleId' | 'employeeId' | 'managerId' | 'deptHeadId' | 'approverId'>;
  /** 当前操作动作。 */
  action: FlowAction;
  /** 期望的目标状态。 */
  targetStatus: TaskStatus;
  /** 操作人 id。 */
  actorId: string;
  /** 操作备注。 */
  comment?: string;
  /** 额外数据，写入 FlowRecord.extraData。 */
  extraData?: Prisma.InputJsonValue;
  /** 状态变更时同时更新的 task 字段（由调用方负责业务字段）。 */
  taskUpdate?: Prisma.AssessmentTaskUpdateInput;
}

export interface ReopenPeriodFlowInput {
  task: Pick<AssessmentTask, 'id' | 'status' | 'cycleId' | 'employeeId' | 'managerId' | 'deptHeadId' | 'approverId'>;
  actorId: string;
  reason: string;
  periodId: string;
  periodKey: string;
  taskUpdate: Prisma.AssessmentTaskUpdateInput;
}

/**
 * 流程服务。
 *
 * 所有任务状态变更必须经 transition()，非法转换统一抛 4009。
 * 同时写 FlowRecord 留痕。
 */
@Injectable()
export class FlowService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 周期阶段跟随任务状态自动推进/回退。
   *
   * 只处理进行中的周期（self_eval/manager_score/hr_calibration/approval），
   * 公示及之后由 publish/scheduler 自己管理，draft/indicator_setting 阶段不介入。
   *
   * 规则（按优先级取第一个命中）：
   * - 有任务处于 dept_review / hr_calibration → 周期 hr_calibration
   * - 否则有任务处于 approval → 周期 approval
   * - 否则有任务处于 manager_scoring → 周期 manager_score
   * - 否则保持不变
   */
  async syncCycleStage(
    tx: Prisma.TransactionClient,
    cycleId: string,
  ): Promise<void> {
    const cycle = await tx.assessmentCycle.findUnique({
      where: { id: cycleId },
      select: { status: true },
    });
    const guard: CycleStatus[] = ['self_eval', 'manager_score', 'hr_calibration', 'approval'];
    if (!cycle || !guard.includes(cycle.status)) return;

    const agg = await tx.assessmentTask.groupBy({
      by: ['status'],
      where: { cycleId, isExempt: false },
      _count: { _all: true },
    });
    const has = (...statuses: TaskStatus[]) => agg.some((g) => statuses.includes(g.status));

    let target: CycleStatus | null = null;
    if (has('dept_review', 'hr_calibration')) target = 'hr_calibration';
    else if (has('approval')) target = 'approval';
    else if (has('manager_scoring')) target = 'manager_score';

    if (target && target !== cycle.status) {
      await tx.assessmentCycle.update({ where: { id: cycleId }, data: { status: target } });
    }
  }


  /**
   * 执行状态转换。
   *
   * 1. 在 FLOW_TRANSITIONS 中查找 (from, action, to) 匹配项；未找到抛 4009。
   * 2. 在事务内更新 AssessmentTask.status 与调用方传入的 taskUpdate。
   * 3. 创建 FlowRecord。
   * 4. 返回更新后的任务状态。
   */
  async transition(input: TransitionInput): Promise<{ oldStatus: TaskStatus; newStatus: TaskStatus; nodeType: FlowNodeType }> {
    const { task, action, targetStatus, actorId, comment, extraData, taskUpdate } = input;

    const transition = FLOW_TRANSITIONS.find(
      (t) => t.from === task.status && t.action === action && t.to === targetStatus,
    );

    if (!transition) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: `当前状态 ${task.status} 不允许执行 ${action} 到 ${targetStatus}`,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.assessmentTask.update({
        where: { id: task.id },
        data: {
          status: targetStatus,
          ...taskUpdate,
        },
      });

      await tx.flowRecord.create({
        data: {
          taskId: task.id,
          cycleId: task.cycleId,
          nodeType: transition.nodeType,
          actorId,
          action,
          comment,
          extraData,
        },
      });

      await this.syncCycleStage(tx, task.cycleId);

      return updatedTask;
    });

    return { oldStatus: task.status, newStatus: updated.status, nodeType: transition.nodeType };
  }

  /**
   * 在事务客户端内执行状态转换（供 TasksService 内部复用）。
   */
  async transitionTx(
    tx: Prisma.TransactionClient,
    input: Omit<TransitionInput, 'taskUpdate'> & { taskUpdate?: Prisma.AssessmentTaskUpdateInput },
  ): Promise<{ oldStatus: TaskStatus; newStatus: TaskStatus; nodeType: FlowNodeType }> {
    const { task, action, targetStatus, actorId, comment, extraData, taskUpdate } = input;

    const transition = FLOW_TRANSITIONS.find(
      (t) => t.from === task.status && t.action === action && t.to === targetStatus,
    );

    if (!transition) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: `当前状态 ${task.status} 不允许执行 ${action} 到 ${targetStatus}`,
      });
    }

    const updatedTask = await tx.assessmentTask.update({
      where: { id: task.id },
      data: {
        status: targetStatus,
        ...taskUpdate,
      },
    });

    await tx.flowRecord.create({
      data: {
        taskId: task.id,
        cycleId: task.cycleId,
        nodeType: transition.nodeType,
        actorId,
        action,
        comment,
        extraData,
      },
    });

    await this.syncCycleStage(tx, task.cycleId);

    return { oldStatus: task.status, newStatus: updatedTask.status, nodeType: transition.nodeType };
  }

  /**
   * HR 在结果公示前重新开放一个已锁定月份。
   *
   * 这是月份级纠错动作，不属于常规前进转换；保留既有流程记录，追加 withdraw 留痕，
   * 并将任务当前节点统一恢复为月度自评。
   */
  async reopenPeriodTx(
    tx: Prisma.TransactionClient,
    input: ReopenPeriodFlowInput,
  ): Promise<{ oldStatus: TaskStatus; newStatus: TaskStatus }> {
    const allowed: TaskStatus[] = [
      TaskStatus.manager_scoring,
      TaskStatus.dept_review,
      TaskStatus.hr_calibration,
      TaskStatus.approval,
      TaskStatus.self_eval,
    ];
    if (!allowed.includes(input.task.status)) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: `当前任务状态 ${input.task.status} 不允许重新开放月度自评`,
      });
    }

    await tx.assessmentTask.update({
      where: { id: input.task.id },
      data: {
        status: TaskStatus.self_eval,
        ...input.taskUpdate,
      },
    });
    await tx.flowRecord.create({
      data: {
        taskId: input.task.id,
        cycleId: input.task.cycleId,
        nodeType: 'self_eval',
        actorId: input.actorId,
        action: 'withdraw',
        comment: input.reason,
        extraData: {
          type: 'monthly_self_evaluation_reopened',
          periodId: input.periodId,
          periodKey: input.periodKey,
          oldTaskStatus: input.task.status,
          newTaskStatus: TaskStatus.self_eval,
        },
      },
    });

    await this.syncCycleStage(tx, input.task.cycleId);

    return { oldStatus: input.task.status, newStatus: TaskStatus.self_eval };
  }
}
