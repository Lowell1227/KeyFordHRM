import type { TaskStatus } from '@/types/enums';
import type { AssessmentPeriodSummary } from '@/types/api.types';

export type TaskStageKey = 'goal-setting' | 'goal-confirmation' | 'self-eval' | 'result';
export type TaskStageState = 'pending' | 'progress' | 'completed' | 'not-started' | 'exempted';

export const TASK_STAGE_ORDER: TaskStageKey[] = [
  'goal-setting',
  'goal-confirmation',
  'self-eval',
  'result',
];

export const TASK_STATUS_STAGE: Record<TaskStatus, TaskStageKey> = {
  pending: 'goal-setting',
  indicator_drafting: 'goal-setting',
  indicator_reviewing: 'goal-setting',
  indicator_setting: 'goal-setting',
  indicator_confirming: 'goal-confirmation',
  goal_confirmed: 'goal-confirmation',
  self_eval: 'self-eval',
  manager_scoring: 'result',
  dept_review: 'result',
  hr_calibration: 'result',
  approval: 'result',
  published: 'result',
  confirmed: 'result',
  appealing: 'result',
  closed: 'result',
  exempted: 'result',
};

const terminalTaskStatuses = new Set<TaskStatus>(['confirmed', 'closed', 'exempted']);
const actionableStatuses = new Set<TaskStatus>([
  'indicator_drafting',
  'indicator_confirming',
  'self_eval',
  'published',
  'appealing',
]);

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return terminalTaskStatuses.has(status);
}

export function getTaskStageState(statuses: TaskStatus[]): TaskStageState {
  if (statuses.length === 0 || statuses.every((status) => status === 'pending')) {
    return 'not-started';
  }
  if (statuses.every((status) => status === 'exempted')) return 'exempted';
  if (statuses.every((status) => isTerminalTaskStatus(status) || status === 'goal_confirmed')) return 'completed';
  if (statuses.some((status) => actionableStatuses.has(status))) return 'pending';
  return 'progress';
}

export function getTaskStageStateForStatus(status: TaskStatus, stage: TaskStageKey): TaskStageState {
  if (status === 'exempted') return 'exempted';
  const currentStage = TASK_STATUS_STAGE[status];
  const currentIndex = TASK_STAGE_ORDER.indexOf(currentStage);
  const stageIndex = TASK_STAGE_ORDER.indexOf(stage);
  if (stageIndex < currentIndex) return 'completed';
  if (stageIndex > currentIndex) return 'not-started';
  return getTaskStageState([status]);
}

export interface EmployeeTaskStageSource {
  status: TaskStatus;
  isExempt?: boolean;
  workflowVersion?: number;
  periods?: AssessmentPeriodSummary[];
}

export interface EmployeeTaskEntry {
  stage: TaskStageKey;
  label: string;
  actionLabel: string;
  periodId?: string;
  progressLabel?: string;
  hintLabel?: string;
  actionPath?: string;
}

const employeeResultPendingStatuses = new Set<TaskStatus>(['published', 'appealing']);
const employeeResultCompletedStatuses = new Set<TaskStatus>(['confirmed', 'closed']);
const resultProcessingStatuses = new Set<TaskStatus>([
  'manager_scoring',
  'dept_review',
  'hr_calibration',
  'approval',
]);

function employeeCanSubmitPeriod(period: AssessmentPeriodSummary): boolean {
  return (
    period.status === 'self_eval'
    && !period.employeeSubmittedAt
    && !period.managerSubmittedAt
  );
}

export function getEmployeeActionablePeriod(
  task: EmployeeTaskStageSource,
): AssessmentPeriodSummary | undefined {
  if (task.workflowVersion !== 2) return undefined;
  return [...(task.periods ?? [])]
    .filter(employeeCanSubmitPeriod)
    .sort((left, right) => left.sequence - right.sequence)[0];
}

function getEmployeeWaitingPeriod(task: EmployeeTaskStageSource): AssessmentPeriodSummary | undefined {
  if (task.workflowVersion !== 2) return undefined;
  return [...(task.periods ?? [])]
    .filter((period) => Boolean(period.employeeSubmittedAt) && !period.managerSubmittedAt)
    .sort((left, right) => right.sequence - left.sequence)[0];
}

function monthlyPeriodLabel(period: AssessmentPeriodSummary): string {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(period.periodKey);
  return monthMatch
    ? `${monthMatch[1]}年${Number(monthMatch[2])}月月度自评`
    : '月度自评';
}

function monthlyProgressLabel(periods: AssessmentPeriodSummary[], period?: AssessmentPeriodSummary): string {
  const position = period ? periods.findIndex((item) => item.id === period.id) + 1 : 0;
  const submitted = periods.filter((item) => Boolean(item.employeeSubmittedAt)).length;
  return position > 0
    ? `第${position}/${periods.length}期 · 已提交 ${submitted}/${periods.length}`
    : `已提交 ${submitted}/${periods.length}`;
}

export function getEmployeeTaskStageState(
  task: EmployeeTaskStageSource,
  stage: TaskStageKey,
): TaskStageState {
  if (task.isExempt || task.status === 'exempted') return 'exempted';
  if (task.workflowVersion !== 2 || !(task.periods?.length)) {
    if (stage === 'result') {
      if (employeeResultCompletedStatuses.has(task.status)) return 'completed';
      if (employeeResultPendingStatuses.has(task.status)) return 'pending';
      if (resultProcessingStatuses.has(task.status)) return 'not-started';
    }
    return getTaskStageStateForStatus(task.status, stage);
  }
  if (stage === 'result') {
    if (employeeResultCompletedStatuses.has(task.status)) return 'completed';
    if (employeeResultPendingStatuses.has(task.status)) return 'pending';
    return 'not-started';
  }
  if (stage !== 'self-eval') return getTaskStageStateForStatus(task.status, stage);

  if (getEmployeeActionablePeriod(task)) return 'pending';
  const periods = task.periods;
  if (periods.every((period) => period.status === 'unopened')) return 'not-started';
  const allEmployeeReviewsFinished = periods.every((period) => (
    period.status === 'completed'
    || period.status === 'no_result'
    || Boolean(period.employeeSubmittedAt)
    || Boolean(period.managerSubmittedAt)
  ));
  return allEmployeeReviewsFinished ? 'completed' : 'progress';
}

export function resolveEmployeeTaskStage(task: EmployeeTaskStageSource): TaskStageKey {
  if (getEmployeeActionablePeriod(task)) return 'self-eval';
  if (getEmployeeWaitingPeriod(task)) return 'self-eval';
  return TASK_STATUS_STAGE[task.status];
}

export function resolveEmployeeTaskEntry(task: EmployeeTaskStageSource): EmployeeTaskEntry {
  const monthlyPeriods = [...(task.periods ?? [])]
    .filter((item) => item.periodType === 'month')
    .sort((left, right) => left.sequence - right.sequence);
  const period = getEmployeeActionablePeriod(task);
  if (period) {
    const monthly = period.periodType === 'month';
    return {
      stage: 'self-eval',
      label: monthly ? monthlyPeriodLabel(period) : '周期自评',
      actionLabel: monthly ? '填写月度自评' : '填写周期自评',
      periodId: period.id,
      progressLabel: monthly
        ? monthlyProgressLabel(monthlyPeriods, period)
        : undefined,
    };
  }
  const waitingPeriod = getEmployeeWaitingPeriod(task);
  if (waitingPeriod?.periodType === 'month') {
    return {
      stage: 'self-eval',
      label: monthlyPeriodLabel(waitingPeriod),
      actionLabel: '等待直属上级月度评分',
      periodId: waitingPeriod.id,
      progressLabel: monthlyProgressLabel(monthlyPeriods, waitingPeriod),
    };
  }
  const nextUnopened = monthlyPeriods.find((item) => item.status === 'unopened');
  if (task.workflowVersion === 2 && nextUnopened) {
    return {
      stage: 'self-eval',
      label: '目标跟进',
      actionLabel: '更新目标进展',
      progressLabel: monthlyProgressLabel(monthlyPeriods),
      hintLabel: '下一期月度自评尚未开放',
      actionPath: '/action-items',
    };
  }
  if (resultProcessingStatuses.has(task.status)) {
    return { stage: 'result', label: '结果处理中', actionLabel: '查看进度' };
  }
  const stage = TASK_STATUS_STAGE[task.status];
  const labels: Record<TaskStageKey, Pick<EmployeeTaskEntry, 'label' | 'actionLabel'>> = {
    'goal-setting': { label: '目标制定', actionLabel: '继续制定目标' },
    'goal-confirmation': { label: '目标确认', actionLabel: '确认绩效目标' },
    'self-eval': { label: '自评', actionLabel: '填写绩效自评' },
    result: { label: '结果确认', actionLabel: '查看并确认结果' },
  };
  return { stage, ...labels[stage] };
}
