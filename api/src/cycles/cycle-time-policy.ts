export type CycleTimeIssue = {
  code: string;
  message: string;
  periodKey?: string;
};

export type CycleTimeSchedule = {
  periodKey: string;
  sequence: number;
  selfEvalOpenAt: Date;
  selfEvalDueAt: Date;
  managerDueAt: Date;
};

export type CycleTimePlan = {
  startDate: Date;
  endDate: Date;
  goalSettingOpenAt?: Date | null;
  deadlineIndicatorSetting?: Date | null;
  deadlineIndicatorConfirm?: Date | null;
  deadlineHrCalibration?: Date | null;
  deadlineApproval?: Date | null;
  deadlinePublish?: Date | null;
};

export function scoringScheduleSequenceIssues(
  schedules: CycleTimeSchedule[],
): CycleTimeIssue[] {
  const issues: CycleTimeIssue[] = [];
  for (const schedule of schedules) {
    if (schedule.selfEvalOpenAt > schedule.selfEvalDueAt) {
      issues.push({
        code: 'SELF_EVAL_OPEN_AFTER_DUE',
        periodKey: schedule.periodKey,
        message: '自评开放时间不能晚于员工计划完成时间',
      });
    }
    if (schedule.selfEvalDueAt > schedule.managerDueAt) {
      issues.push({
        code: 'SELF_EVAL_DUE_AFTER_MANAGER_DUE',
        periodKey: schedule.periodKey,
        message: '员工计划完成时间不能晚于主管计划完成时间',
      });
    }
  }
  return issues;
}

export function launchTimeSequenceBlockers(
  cycle: CycleTimePlan,
  schedules: CycleTimeSchedule[],
): CycleTimeIssue[] {
  const blockers: CycleTimeIssue[] = [];
  if (cycle.endDate < cycle.startDate) {
    blockers.push({ code: 'CYCLE_END_BEFORE_START', message: '考核结束日期不能早于开始日期' });
  }

  const required = [
    cycle.goalSettingOpenAt,
    cycle.deadlineIndicatorSetting,
    cycle.deadlineIndicatorConfirm,
    cycle.deadlineHrCalibration,
    cycle.deadlineApproval,
    cycle.deadlinePublish,
  ];
  if (required.some((value) => !value)) {
    blockers.push({ code: 'TIME_PLAN_INCOMPLETE', message: '时间计划不完整，请补齐目标准备和最终结果节点' });
    return blockers;
  }

  const goalSettingOpenAt = cycle.goalSettingOpenAt!;
  const deadlineIndicatorSetting = cycle.deadlineIndicatorSetting!;
  const deadlineIndicatorConfirm = cycle.deadlineIndicatorConfirm!;
  const deadlineHrCalibration = cycle.deadlineHrCalibration!;
  const deadlineApproval = cycle.deadlineApproval!;
  const deadlinePublish = cycle.deadlinePublish!;

  if (goalSettingOpenAt > deadlineIndicatorSetting) {
    blockers.push({
      code: 'INDICATOR_SETTING_BEFORE_GOAL_OPEN',
      message: '指标制定截止不能早于目标制定开放',
    });
  }
  if (deadlineIndicatorSetting > deadlineIndicatorConfirm) {
    blockers.push({
      code: 'INDICATOR_CONFIRM_BEFORE_SETTING_DUE',
      message: '指标确认截止不能早于指标制定截止',
    });
  }

  const orderedSchedules = [...schedules].sort((a, b) => a.sequence - b.sequence);
  const firstSchedule = orderedSchedules[0];
  const lastSchedule = orderedSchedules.at(-1);
  if (firstSchedule && deadlineIndicatorConfirm > firstSchedule.selfEvalOpenAt) {
    blockers.push({
      code: 'FIRST_SELF_EVAL_BEFORE_INDICATOR_CONFIRM',
      periodKey: firstSchedule.periodKey,
      message: '第一期自评开放不能早于指标确认截止',
    });
  }
  blockers.push(...scoringScheduleSequenceIssues(orderedSchedules));

  if (lastSchedule && lastSchedule.managerDueAt > deadlineHrCalibration) {
    blockers.push({
      code: 'HR_CALIBRATION_BEFORE_FINAL_MANAGER_DUE',
      periodKey: lastSchedule.periodKey,
      message: 'HR校准截止不能早于最后一期主管计划完成时间',
    });
  }
  if (deadlineHrCalibration > deadlineApproval) {
    blockers.push({
      code: 'APPROVAL_BEFORE_HR_CALIBRATION',
      message: '结果审批截止不能早于HR校准截止',
    });
  }
  if (deadlineApproval > deadlinePublish) {
    blockers.push({
      code: 'PUBLISH_BEFORE_APPROVAL',
      message: '结果公示截止不能早于结果审批截止',
    });
  }
  return blockers;
}

export function draftTimeSequenceWarnings(
  cycle: CycleTimePlan,
  schedules: CycleTimeSchedule[],
): CycleTimeIssue[] {
  const timeline = [
    cycle.goalSettingOpenAt,
    cycle.deadlineIndicatorSetting,
    cycle.deadlineIndicatorConfirm,
    cycle.deadlineHrCalibration,
    cycle.deadlineApproval,
    cycle.deadlinePublish,
  ];
  if (timeline.every(Boolean)) return launchTimeSequenceBlockers(cycle, schedules);
  return scoringScheduleSequenceIssues(schedules);
}
