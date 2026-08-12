import { DEMO_CONFIG } from './config';

it('locks approved people and performance totals', () => {
  expect(Object.values(DEMO_CONFIG.departmentHeadcount).reduce((a, b) => a + b, 0)).toBe(128);
  expect(Object.values(DEMO_CONFIG.employmentTypeCount).reduce((a, b) => a + b, 0)).toBe(128);
  expect(DEMO_CONFIG.currentProbationCount).toBe(7);
  expect(DEMO_CONFIG.resignedHistoryCount).toBe(4);
  expect(DEMO_CONFIG.q1.gradeCount).toEqual({ A: 23, B: 47, C: 37, D: 11 });
  expect(DEMO_CONFIG.q2.gradeCount).toEqual({ A: 24, B: 49, C: 38, D: 12 });
  expect(DEMO_CONFIG.q3.taskStatusCount).toEqual({ self_eval: 113, indicator_confirming: 9, indicator_setting: 6 });
});
