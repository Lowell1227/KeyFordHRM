import type { TaskStatus } from '@/types/enums';

export type TaskStageKey = 'goal-setting' | 'goal-confirmation' | 'self-eval' | 'result';
export type TaskStageState = 'pending' | 'progress' | 'completed' | 'not-started';

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
  if (statuses.every((status) => isTerminalTaskStatus(status) || status === 'goal_confirmed')) return 'completed';
  if (statuses.some((status) => actionableStatuses.has(status))) return 'pending';
  return 'progress';
}
