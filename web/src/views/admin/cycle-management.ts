import type { AssessmentCycle, CycleStatusGroup } from '@/types/api.types';
import type { CycleStatus, TaskStatus } from '@/types/enums';

export const CYCLE_PHASES = ['规划配置', '目标准备', '目标跟进', '结果考评', '公示归档'] as const;

export type CycleBusinessStatus =
  | 'pending_review'
  | 'changes_requested'
  | 'ready_to_launch'
  | 'scheduled'
  | 'launch_blocked'
  | 'goal_preparation'
  | 'goal_tracking'
  | 'result_assessment'
  | 'pending_publish'
  | 'published'
  | 'appealing'
  | 'finished';

export interface CycleBusinessState {
  code: CycleBusinessStatus;
  label: string;
  tagType: 'primary' | 'success' | 'warning' | 'info' | 'danger';
  phaseIndex: number;
}

const BUSINESS_STATE_META: Record<CycleBusinessStatus, Omit<CycleBusinessState, 'code'>> = {
  pending_review: { label: '待审核', tagType: 'warning', phaseIndex: 0 },
  changes_requested: { label: '已退回', tagType: 'danger', phaseIndex: 0 },
  ready_to_launch: { label: '待发起', tagType: 'primary', phaseIndex: 0 },
  scheduled: { label: '已预约', tagType: 'primary', phaseIndex: 0 },
  launch_blocked: { label: '发起受阻', tagType: 'danger', phaseIndex: 0 },
  goal_preparation: { label: '目标准备中', tagType: 'warning', phaseIndex: 1 },
  goal_tracking: { label: '目标跟进中', tagType: 'primary', phaseIndex: 2 },
  result_assessment: { label: '结果考评中', tagType: 'primary', phaseIndex: 3 },
  pending_publish: { label: '待公示', tagType: 'warning', phaseIndex: 4 },
  published: { label: '已公示', tagType: 'success', phaseIndex: 4 },
  appealing: { label: '申诉处理中', tagType: 'danger', phaseIndex: 4 },
  finished: { label: '已结束', tagType: 'info', phaseIndex: 4 },
};

const STATUS_GROUP: Record<CycleStatus, CycleStatusGroup> = {
  draft: 'attention',
  scheduled: 'attention',
  launch_blocked: 'attention',
  indicator_setting: 'active',
  self_eval: 'active',
  manager_score: 'active',
  hr_calibration: 'active',
  approval: 'active',
  published: 'active',
  appeal: 'active',
  closed: 'finished',
};

const STAGE_INDEX: Record<CycleStatus, number> = {
  draft: 0,
  scheduled: 0,
  launch_blocked: 0,
  indicator_setting: 1,
  self_eval: 2,
  manager_score: 2,
  hr_calibration: 3,
  approval: 3,
  published: 4,
  appeal: 4,
  closed: 4,
};

const GOAL_PREPARATION_STATUSES: TaskStatus[] = [
  'pending',
  'indicator_drafting',
  'indicator_reviewing',
  'indicator_setting',
  'indicator_confirming',
];
const GOAL_TRACKING_STATUSES: TaskStatus[] = ['goal_confirmed', 'self_eval', 'manager_scoring'];
const RESULT_ASSESSMENT_STATUSES: TaskStatus[] = ['dept_review', 'hr_calibration', 'approval'];

function hasAnyTaskStatus(cycle: AssessmentCycle, statuses: TaskStatus[]): boolean {
  return statuses.some((status) => (cycle.taskStats?.byStatus?.[status] ?? 0) > 0);
}

function resolveBusinessStatus(cycle: AssessmentCycle): CycleBusinessStatus {
  if (cycle.status === 'draft') {
    if (cycle.reviewStatus === 'approved') return 'ready_to_launch';
    if (cycle.reviewStatus === 'rejected') return 'changes_requested';
    return 'pending_review';
  }
  if (cycle.status === 'scheduled') return 'scheduled';
  if (cycle.status === 'launch_blocked') return 'launch_blocked';
  if (cycle.status === 'closed') return 'finished';

  // 详情接口带任务汇总时，以全员实际任务进度为准，避免周期枚举滞后造成错报。
  if (cycle.taskStats?.total) {
    if (hasAnyTaskStatus(cycle, GOAL_PREPARATION_STATUSES)) return 'goal_preparation';
    if (hasAnyTaskStatus(cycle, GOAL_TRACKING_STATUSES)) return 'goal_tracking';
    if (hasAnyTaskStatus(cycle, RESULT_ASSESSMENT_STATUSES)) {
      const activeCount = cycle.taskStats.total - cycle.taskStats.exempted;
      if (activeCount > 0 && (cycle.taskStats.approved ?? 0) >= activeCount) return 'pending_publish';
      return 'result_assessment';
    }
    if (hasAnyTaskStatus(cycle, ['appealing'])) return 'appealing';
    if (hasAnyTaskStatus(cycle, ['published', 'confirmed'])) return 'published';
    const finishedCount = (cycle.taskStats.byStatus.closed ?? 0) + (cycle.taskStats.byStatus.exempted ?? 0);
    if (finishedCount >= cycle.taskStats.total) return 'finished';
  }

  if (cycle.status === 'indicator_setting') return 'goal_preparation';
  if (cycle.status === 'self_eval' || cycle.status === 'manager_score') return 'goal_tracking';
  if (cycle.status === 'hr_calibration' || cycle.status === 'approval') return 'result_assessment';
  if (cycle.status === 'appeal') return 'appealing';
  return 'published';
}

export interface CycleNextStep {
  label: string;
  time?: string;
}

export function cycleBusinessState(cycle: AssessmentCycle): CycleBusinessState {
  const code = resolveBusinessStatus(cycle);
  return { code, ...BUSINESS_STATE_META[code] };
}

export function cycleStatusGroup(status: CycleStatus): CycleStatusGroup {
  return STATUS_GROUP[status];
}

export function cycleStageIndex(status: CycleStatus): number {
  return STAGE_INDEX[status];
}

function currentTaskAction(cycle: AssessmentCycle, fallback: string): string {
  const byStatus = cycle.taskStats?.byStatus;
  if (!byStatus) return fallback;
  if ((byStatus.indicator_drafting ?? 0) + (byStatus.indicator_setting ?? 0) + (byStatus.pending ?? 0) > 0) return '目标制定';
  if ((byStatus.indicator_reviewing ?? 0) > 0) return '目标审核';
  if ((byStatus.indicator_confirming ?? 0) > 0) return '目标确认';
  if ((byStatus.goal_confirmed ?? 0) > 0) return '等待本期开始';
  if ((byStatus.self_eval ?? 0) > 0) return '员工自评';
  if ((byStatus.manager_scoring ?? 0) > 0) return '主管评分';
  if ((byStatus.dept_review ?? 0) > 0) return '部门复核';
  if ((byStatus.hr_calibration ?? 0) > 0) return '绩效校准';
  if ((byStatus.approval ?? 0) > 0) return '结果审批';
  if ((byStatus.appealing ?? 0) > 0) return '处理申诉';
  if ((byStatus.published ?? 0) + (byStatus.confirmed ?? 0) > 0) return '员工结果确认';
  return fallback;
}

export function cyclePrimaryActionLabel(cycle: AssessmentCycle): string {
  switch (cycleBusinessState(cycle).code) {
    case 'pending_review': return '审核计划';
    case 'changes_requested': return '修改后重新提交';
    case 'ready_to_launch': return '发起考核';
    case 'scheduled': return '查看预约';
    case 'launch_blocked': return '处理发起问题';
    case 'finished': return '查看归档';
    default: return '查看进度';
  }
}

export function cycleNextStep(cycle: AssessmentCycle): CycleNextStep {
  switch (cycleBusinessState(cycle).code) {
    case 'pending_review':
      return { label: '审核计划', time: cycle.goalSettingOpenAt };
    case 'changes_requested':
      return { label: '修改后重新提交', time: cycle.goalSettingOpenAt };
    case 'ready_to_launch':
      return { label: '发起考核', time: cycle.goalSettingOpenAt };
    case 'scheduled':
      return { label: '等待预约发起', time: cycle.scheduledAt ?? cycle.goalSettingOpenAt };
    case 'launch_blocked':
      return { label: '处理发起问题', time: cycle.goalSettingOpenAt };
    case 'goal_preparation':
      return { label: currentTaskAction(cycle, '目标制定'), time: cycle.deadlineIndicatorSetting };
    case 'goal_tracking':
      return { label: currentTaskAction(cycle, '等待本期开始'), time: cycle.deadlineManagerScore ?? cycle.deadlineSelfEval };
    case 'result_assessment':
      return { label: currentTaskAction(cycle, '结果审批'), time: cycle.deadlineApproval ?? cycle.deadlineHrCalibration };
    case 'pending_publish':
      return { label: '公示结果', time: cycle.deadlinePublish };
    case 'published':
      return { label: currentTaskAction(cycle, '员工结果确认'), time: cycle.deadlineAppeal };
    case 'appealing':
      return { label: '处理申诉', time: cycle.deadlineAppeal };
    case 'finished':
      return { label: '结束归档', time: cycle.closedAt };
  }
}
