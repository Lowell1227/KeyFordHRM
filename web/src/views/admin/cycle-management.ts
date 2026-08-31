import type { AssessmentCycle, CycleStatusGroup } from '@/types/api.types';
import type { CycleStatus } from '@/types/enums';

const STATUS_GROUP: Record<CycleStatus, CycleStatusGroup> = {
  draft: 'attention',
  launch_blocked: 'attention',
  scheduled: 'active',
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

const PRIMARY_ACTION_LABEL: Record<CycleStatus, string> = {
  draft: '发起检查',
  launch_blocked: '重新检查',
  scheduled: '查看预约',
  indicator_setting: '查看进度',
  self_eval: '查看进度',
  manager_score: '查看进度',
  hr_calibration: '查看进度',
  approval: '查看进度',
  published: '查看进度',
  appeal: '查看进度',
  closed: '查看归档',
};

export interface CycleNextStep {
  label: string;
  time?: string;
}

export function cycleStatusGroup(status: CycleStatus): CycleStatusGroup {
  return STATUS_GROUP[status];
}

export function cycleStageIndex(status: CycleStatus): number {
  return STAGE_INDEX[status];
}

export function cyclePrimaryActionLabel(status: CycleStatus): string {
  return PRIMARY_ACTION_LABEL[status];
}

export function cycleNextStep(cycle: AssessmentCycle): CycleNextStep {
  switch (cycle.status) {
    case 'draft':
      return { label: '完成发起检查', time: cycle.goalSettingOpenAt };
    case 'launch_blocked':
      return { label: '处理发起阻断项', time: cycle.goalSettingOpenAt };
    case 'scheduled':
      return { label: '预约发起时间', time: cycle.goalSettingOpenAt };
    case 'indicator_setting':
      return { label: '目标制定截止', time: cycle.deadlineIndicatorSetting };
    case 'self_eval':
      return { label: '员工自评截止', time: cycle.deadlineSelfEval };
    case 'manager_score':
      return { label: '主管评分截止', time: cycle.deadlineManagerScore };
    case 'hr_calibration':
      return { label: 'HR校准截止', time: cycle.deadlineHrCalibration };
    case 'approval':
      return { label: '结果审批截止', time: cycle.deadlineApproval };
    case 'published':
      return { label: '结果公示完成', time: cycle.deadlinePublish ?? cycle.publishedAt };
    case 'appeal':
      return { label: '申诉处理', time: cycle.deadlineAppeal };
    case 'closed':
      return { label: '已归档', time: cycle.closedAt };
  }
}
