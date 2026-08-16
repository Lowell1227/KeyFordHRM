import { computed, unref } from 'vue';
import type { TaskDetail, AssessmentCycle } from '@/types/api.types';
import { FLOW_NODE_LABELS } from '@/types/enums';
import type { TaskFlowNode, TaskActions, TaskViewMode } from '@/types/task.types';
import type { FlowNodeType, TaskStatus } from '@/types/enums';
import type { MaybeRef } from 'vue';
import { usePermission } from './usePermission';

const FLOW_SEQUENCE: FlowNodeType[] = [
  'indicator_setting',
  'indicator_confirm',
  'self_eval',
  'manager_score',
  'dept_review',
  'hr_calibration',
  'approval',
  'publish',
  'employee_confirm',
];

/** 将 TaskStatus 映射到当前所在流程节点。 */
function statusToNode(status: TaskStatus): FlowNodeType {
  switch (status) {
    case 'pending':
      return 'indicator_setting';
    case 'indicator_drafting':
    case 'indicator_reviewing':
    case 'indicator_setting':
      return 'indicator_setting';
    case 'indicator_confirming':
      return 'indicator_confirm';
    case 'goal_confirmed':
      return 'self_eval';
    case 'self_eval':
      return 'self_eval';
    case 'manager_scoring':
      return 'manager_score';
    case 'dept_review':
      return 'dept_review';
    case 'hr_calibration':
      return 'hr_calibration';
    case 'approval':
      return 'approval';
    case 'published':
    case 'appealing':
      return 'publish';
    case 'confirmed':
      return 'employee_confirm';
    case 'closed':
    case 'exempted':
      return 'employee_confirm';
    default:
      return 'indicator_setting';
  }
}

function getNodeStatus(
  node: FlowNodeType,
  currentNode: FlowNodeType,
  task?: TaskDetail | null,
): TaskFlowNode['status'] {
  const currentIndex = FLOW_SEQUENCE.indexOf(currentNode);
  const nodeIndex = FLOW_SEQUENCE.indexOf(node);

  if (task?.status === 'closed' || task?.status === 'exempted') {
    return nodeIndex <= currentIndex ? 'done' : 'pending';
  }

  if (task?.status === 'goal_confirmed' && node === 'self_eval') return 'pending';

  if (nodeIndex < currentIndex) return 'done';
  if (nodeIndex === currentIndex) return 'active';
  return 'pending';
}

export interface UseTaskFlowOptions {
  task?: MaybeRef<TaskDetail | null | undefined>;
  cycle?: MaybeRef<AssessmentCycle | null | undefined>;
  viewMode?: TaskViewMode;
}

export function useTaskFlow(options: UseTaskFlowOptions = {}) {
  const task = computed(() => unref(options.task) ?? null);
  const permission = usePermission({ task: options.task, cycle: options.cycle });

  const currentNode = computed(() => statusToNode(task.value?.status ?? 'pending'));

  const flowNodes = computed<TaskFlowNode[]>(() => {
    const t = task.value;
    return FLOW_SEQUENCE.map((node) => ({
      key: node,
      label: FLOW_NODE_LABELS[node],
      status: getNodeStatus(node, currentNode.value, t),
      completedAt: getCompletedAt(t, node),
    }));
  });

  const actions = computed<TaskActions>(() => {
    const s = task.value?.status;
    const exempt = task.value?.isExempt ?? false;
    const isSelf = permission.isTaskSelf.value;
    const isManager = permission.isTaskManager.value;
    const isDeptHead = permission.isTaskDeptHead.value;
    const isAdmin = permission.isAdminLike.value;

    return {
      canSetIndicator: !exempt && (s === 'indicator_reviewing' || s === 'indicator_setting') && (isManager || isAdmin),
      canConfirmIndicator: !exempt && s === 'indicator_confirming' && isSelf,
      canSelfEval: permission.canEditSelfEval.value,
      canManagerScore: permission.canEditManagerScore.value,
      canDeptReview: !exempt && s === 'dept_review' && (isDeptHead || isAdmin),
      canHrCalibrate: !exempt && s === 'hr_calibration' && isAdmin,
      canApprove: !exempt && s === 'approval' && (isAdmin || task.value?.approverId === task.value?.employeeId),
      canPublish: !exempt && s === 'approval' && isAdmin,
      canAppeal: permission.canAppeal.value,
      canConfirmResult: permission.canConfirmResult.value,
      canExempt: !exempt && isAdmin,
      canViewManagerScore: permission.canViewManagerScore.value,
    };
  });

  const viewMode = computed<TaskViewMode>(() => {
    if (options.viewMode) return options.viewMode;
    const u = permission.isTaskSelf.value;
    if (u) return 'employee';
    if (permission.isTaskManager.value) return 'manager';
    if (permission.isTaskDeptHead.value) return 'dept_head';
    if (permission.isAdminLike.value) return 'hr';
    return 'employee';
  });

  return {
    task,
    currentNode,
    flowNodes,
    actions,
    viewMode,
    permission,
  };
}

function getCompletedAt(task: TaskDetail | null | undefined, node: FlowNodeType): string | undefined {
  if (!task) return undefined;
  switch (node) {
    case 'indicator_setting':
      return task.indicatorSetAt;
    case 'indicator_confirm':
      return task.indicatorConfirmedAt;
    case 'self_eval':
      return task.selfEvalSubmittedAt;
    case 'manager_score':
      return task.managerScoredAt;
    case 'dept_review':
      return task.deptReviewedAt;
    case 'hr_calibration':
      return task.hrCalibratedAt;
    case 'approval':
      return task.approvedAt;
    case 'publish':
      return task.publishedAt;
    case 'employee_confirm':
      return task.employeeConfirmedAt;
    default:
      return undefined;
  }
}
