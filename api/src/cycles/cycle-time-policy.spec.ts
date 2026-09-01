import {
  launchTimeSequenceWarnings,
  launchTimeStructuralBlockers,
} from './cycle-time-policy';

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
    expect(launchTimeStructuralBlockers(baseCycle())).toEqual([]);
    expect(launchTimeSequenceWarnings(baseCycle(), baseSchedules())).toEqual([]);
  });

  it.each([
    ['INDICATOR_SETTING_BEFORE_GOAL_OPEN', { deadlineIndicatorSetting: at(1) }, {}],
    ['INDICATOR_CONFIRM_BEFORE_SETTING_DUE', { deadlineIndicatorConfirm: at(2) }, {}],
    ['FIRST_SELF_EVAL_BEFORE_INDICATOR_CONFIRM', {}, { selfEvalOpenAt: at(3) }],
    ['SELF_EVAL_OPEN_AFTER_DUE', {}, { selfEvalOpenAt: at(5, 10) }],
    ['SELF_EVAL_DUE_AFTER_MANAGER_DUE', {}, { selfEvalDueAt: at(6, 10) }],
    ['HR_CALIBRATION_BEFORE_FINAL_MANAGER_DUE', { deadlineHrCalibration: at(5, 10) }, {}],
    ['APPROVAL_BEFORE_HR_CALIBRATION', { deadlineApproval: at(5, 10) }, {}],
    ['PUBLISH_BEFORE_APPROVAL', { deadlinePublish: at(6, 10) }, {}],
  ] as const)('returns only warning %s for its reversed dependency', (expectedCode, cycleChanges, scheduleChanges) => {
    const cycle = { ...baseCycle(), ...cycleChanges };
    const schedules = [{ ...baseSchedules()[0], ...scheduleChanges }];

    expect(launchTimeStructuralBlockers(cycle)).toEqual([]);
    expect(launchTimeSequenceWarnings(cycle, schedules).map(({ code }) => code)).toEqual([expectedCode]);
  });

  it('uses the same goal terminology in user-visible time reminders', () => {
    const settingWarning = launchTimeSequenceWarnings({
      ...baseCycle(),
      deadlineIndicatorSetting: at(1),
    }, baseSchedules());
    const confirmationWarning = launchTimeSequenceWarnings({
      ...baseCycle(),
      deadlineIndicatorConfirm: at(2),
    }, baseSchedules());

    expect(settingWarning[0]?.message).toBe('建议不早于目标开放');
    expect(confirmationWarning[0]?.message).toBe('建议不早于目标截止');
  });

  it('uses concise non-blocking copy for monthly follow-up sequence warnings', () => {
    const selfEvalWarning = launchTimeSequenceWarnings(
      baseCycle(),
      [{ ...baseSchedules()[0], selfEvalOpenAt: at(5, 10) }],
    );
    const managerWarning = launchTimeSequenceWarnings(
      baseCycle(),
      [{ ...baseSchedules()[0], selfEvalDueAt: at(6, 10) }],
    );

    expect(selfEvalWarning[0]?.message).toBe('建议不早于自评开始');
    expect(managerWarning[0]?.message).toBe('建议不早于自评截止');
    expect(selfEvalWarning[0]?.message.length).toBeLessThanOrEqual(15);
    expect(managerWarning[0]?.message.length).toBeLessThanOrEqual(15);
  });

  it('names both fields in final-result sequence warnings', () => {
    const calibrationWarning = launchTimeSequenceWarnings({
      ...baseCycle(),
      deadlineHrCalibration: at(5, 10),
    }, baseSchedules());
    const approvalWarning = launchTimeSequenceWarnings({
      ...baseCycle(),
      deadlineApproval: at(5, 10),
    }, baseSchedules());

    expect(calibrationWarning[0]?.message).toBe('HR校准截止早于主管评分截止');
    expect(approvalWarning[0]?.message).toBe('结果审批截止早于HR校准截止');
  });

  it('keeps a reversed performance period as a structural blocker', () => {
    expect(launchTimeStructuralBlockers({
      ...baseCycle(),
      startDate: at(2),
      endDate: at(1),
    })).toEqual([
      expect.objectContaining({ code: 'CYCLE_END_BEFORE_START' }),
    ]);
  });

  it('reports one completeness blocker when required launch nodes are missing', () => {
    expect(launchTimeStructuralBlockers({
      ...baseCycle(),
      deadlinePublish: null,
    })).toEqual([
      expect.objectContaining({ code: 'TIME_PLAN_INCOMPLETE' }),
    ]);
  });
});
