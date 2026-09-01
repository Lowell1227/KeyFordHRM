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
        message: '建议不早于自评开始',
      });
    }
    if (schedule.selfEvalDueAt > schedule.managerDueAt) {
      issues.push({
        code: 'SELF_EVAL_DUE_AFTER_MANAGER_DUE',
        periodKey: schedule.periodKey,
        message: '建议不早于自评截止',
      });
    }
  }
  return issues;
}

export function launchTimeStructuralBlockers(
  cycle: CycleTimePlan,
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
  }
  return blockers;
}

export function launchTimeSequenceWarnings(
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
  if (timeline.some((value) => !value)) return scoringScheduleSequenceIssues(schedules);

  const warnings: CycleTimeIssue[] = [];

  const goalSettingOpenAt = cycle.goalSettingOpenAt!;
  const deadlineIndicatorSetting = cycle.deadlineIndicatorSetting!;
  const deadlineIndicatorConfirm = cycle.deadlineIndicatorConfirm!;
  const deadlineHrCalibration = cycle.deadlineHrCalibration!;
  const deadlineApproval = cycle.deadlineApproval!;
  const deadlinePublish = cycle.deadlinePublish!;

  if (goalSettingOpenAt > deadlineIndicatorSetting) {
    warnings.push({
      code: 'INDICATOR_SETTING_BEFORE_GOAL_OPEN',
      message: '建议不早于目标开放',
    });
  }
  if (deadlineIndicatorSetting > deadlineIndicatorConfirm) {
    warnings.push({
      code: 'INDICATOR_CONFIRM_BEFORE_SETTING_DUE',
      message: '建议不早于目标截止',
    });
  }

  const orderedSchedules = [...schedules].sort((a, b) => a.sequence - b.sequence);
  const firstSchedule = orderedSchedules[0];
  const lastSchedule = orderedSchedules.at(-1);
  if (firstSchedule && deadlineIndicatorConfirm > firstSchedule.selfEvalOpenAt) {
    warnings.push({
      code: 'FIRST_SELF_EVAL_BEFORE_INDICATOR_CONFIRM',
      periodKey: firstSchedule.periodKey,
      message: '建议不早于目标确认',
    });
  }
  warnings.push(...scoringScheduleSequenceIssues(orderedSchedules));

  if (lastSchedule && lastSchedule.managerDueAt > deadlineHrCalibration) {
    warnings.push({
      code: 'HR_CALIBRATION_BEFORE_FINAL_MANAGER_DUE',
      periodKey: lastSchedule.periodKey,
      message: '建议不早于主管评分',
    });
  }
  if (deadlineHrCalibration > deadlineApproval) {
    warnings.push({
      code: 'APPROVAL_BEFORE_HR_CALIBRATION',
      message: '建议不早于HR校准',
    });
  }
  if (deadlineApproval > deadlinePublish) {
    warnings.push({
      code: 'PUBLISH_BEFORE_APPROVAL',
      message: '建议不早于结果审批',
    });
  }
  return warnings;
}

export function draftTimeSequenceWarnings(
  cycle: CycleTimePlan,
  schedules: CycleTimeSchedule[],
): CycleTimeIssue[] {
  return launchTimeSequenceWarnings(cycle, schedules);
}
