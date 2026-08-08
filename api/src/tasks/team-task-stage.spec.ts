import { getTeamStageState } from './team-task-stage';

describe('getTeamStageState', () => {
  it.each([
    ['indicator_reviewing', 'goal-review', 'pending'],
    ['indicator_confirming', 'goal-review', 'completed'],
    ['self_eval', 'manager-eval', 'not_started'],
    ['manager_scoring', 'manager-eval', 'pending'],
    ['dept_review', 'manager-eval', 'completed'],
    ['exempted', 'manager-eval', 'exempted'],
  ] as const)('maps %s for %s to %s', (status, stage, expected) => {
    expect(getTeamStageState(status, stage)).toBe(expected);
  });
});
