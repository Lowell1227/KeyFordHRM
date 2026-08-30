import { launchTimeSequenceBlockers } from './cycle-time-policy';

describe('cycle launch time policy', () => {
  const at = (day: number, hour = 9) => new Date(`2027-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`);
  const baseCycle = () => ({
    startDate: at(1),
    endDate: at(1),
    goalSettingOpenAt: at(2),
    deadlineIndicatorSetting: at(3),
    deadlineIndicatorConfirm: at(4),
    deadlineHrCalibration: at(6),
    deadlineApproval: at(7),
    deadlinePublish: at(7),
  });
  const baseSchedules = () => [{
    periodKey: '2027-01',
    sequence: 1,
    selfEvalOpenAt: at(4),
    selfEvalDueAt: at(5),
    managerDueAt: at(6),
  }];

  it('allows every adjacent workflow point and the performance period boundaries to be equal', () => {
    expect(launchTimeSequenceBlockers(baseCycle(), baseSchedules())).toEqual([]);
  });

  it.each([
    ['CYCLE_END_BEFORE_START', { startDate: at(2), endDate: at(1) }, {}],
    ['INDICATOR_SETTING_BEFORE_GOAL_OPEN', { deadlineIndicatorSetting: at(1) }, {}],
    ['INDICATOR_CONFIRM_BEFORE_SETTING_DUE', { deadlineIndicatorConfirm: at(2) }, {}],
    ['FIRST_SELF_EVAL_BEFORE_INDICATOR_CONFIRM', {}, { selfEvalOpenAt: at(3) }],
    ['SELF_EVAL_OPEN_AFTER_DUE', {}, { selfEvalOpenAt: at(5, 10) }],
    ['SELF_EVAL_DUE_AFTER_MANAGER_DUE', {}, { selfEvalDueAt: at(6, 10) }],
    ['HR_CALIBRATION_BEFORE_FINAL_MANAGER_DUE', { deadlineHrCalibration: at(5, 10) }, {}],
    ['APPROVAL_BEFORE_HR_CALIBRATION', { deadlineApproval: at(5, 10) }, {}],
    ['PUBLISH_BEFORE_APPROVAL', { deadlinePublish: at(6, 10) }, {}],
  ] as const)('returns only %s for its reversed dependency', (expectedCode, cycleChanges, scheduleChanges) => {
    const cycle = { ...baseCycle(), ...cycleChanges };
    const schedules = [{ ...baseSchedules()[0], ...scheduleChanges }];

    expect(launchTimeSequenceBlockers(cycle, schedules).map(({ code }) => code)).toEqual([expectedCode]);
  });

  it('reports one completeness blocker when required launch nodes are missing', () => {
    expect(launchTimeSequenceBlockers({
      ...baseCycle(),
      deadlinePublish: null,
    }, baseSchedules())).toEqual([
      expect.objectContaining({ code: 'TIME_PLAN_INCOMPLETE' }),
    ]);
  });
});
