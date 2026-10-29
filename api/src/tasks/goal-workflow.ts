import { TaskStatus, FlowNodeType } from '@prisma/client';
export const usesFiveStepGoalWorkflow = (version?: number | null): boolean =>
  (version ?? 1) >= 2;
export function hasApprovedGoalBaseline(
  task: {
    indicatorConfirmedAt?: Date | null;
    goalApprovedAt?: Date | null;
    cycle?: { goalWorkflowVersion?: number | null } | null;
  },
  version?: number | null,
): boolean {
  return Boolean(
    usesFiveStepGoalWorkflow(version ?? task.cycle?.goalWorkflowVersion)
      ? task.goalApprovedAt
      : task.indicatorConfirmedAt,
  );
}
type Actors = {
  managerId: string | null;
  deptHeadId: string | null;
  approverId: string | null;
};
export function getGoalReviewActorId(
  task: Actors & { status: TaskStatus },
): string | null {
  return task.status === 'indicator_reviewing' ||
    task.status === 'indicator_setting'
    ? task.managerId
    : task.status === 'indicator_dept_reviewing'
      ? task.deptHeadId
      : task.status === 'indicator_approving'
        ? task.approverId
        : null;
}
export function goalNode(status: TaskStatus): FlowNodeType {
  return status === 'indicator_dept_reviewing'
    ? 'indicator_dept_review'
    : status === 'indicator_approving'
      ? 'indicator_approval'
      : status === 'indicator_confirming'
        ? 'indicator_confirm'
        : 'indicator_setting';
}
export function nextGoalStep(
  task: Actors & { employeeId: string },
  completed: TaskStatus,
): {
  status: TaskStatus;
  skipped: Array<{ status: TaskStatus; reason: string }>;
} {
  const steps: TaskStatus[] = [
    'indicator_drafting',
    'indicator_reviewing',
    'indicator_dept_reviewing',
    'indicator_confirming',
    'indicator_approving',
    'goal_confirmed',
  ];
  let index =
    steps.indexOf(
      completed === 'indicator_setting' ? 'indicator_reviewing' : completed,
    ) + 1;
  if (index === 0) throw new Error('Invalid goal stage');
  const skipped: Array<{ status: TaskStatus; reason: string }> = [];
  const previousActor = getGoalReviewActorId({ ...task, status: completed });
  while (index < steps.length - 1) {
    const status = steps[index];
    if (status === 'indicator_confirming') break;
    const actor = getGoalReviewActorId({ ...task, status });
    if (!actor) throw new Error('目标审核人未配置，请联系管理员');
    const self = actor === task.employeeId;
    const merged =
      status === 'indicator_dept_reviewing' && actor === previousActor;
    if (!self && !merged) break;
    skipped.push({
      status,
      reason: self ? 'self_review_skipped' : 'consecutive_same_actor',
    });
    index++;
  }
  return { status: steps[index], skipped };
}
