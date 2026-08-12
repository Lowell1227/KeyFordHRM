export const DEMO_CONFIG = {
  source: 'realistic-demo-v1' as const,
  namespace: '7d00d390-fdc5-5c87-9b36-202608110001',
  seed: 20260811,
  asOf: new Date('2026-08-11T00:00:00.000+08:00'),
  departmentHeadcount: { project: 59, supplyChain: 26, creative: 17, hrAdmin: 8, sales: 7, finance: 5, executive: 3, beijing: 2, digital: 1 },
  employmentTypeCount: { full_time: 115, rehire: 9, external: 3, part_time: 1 },
  currentProbationCount: 7,
  resignedHistoryCount: 4,
  acceptanceEmployeeNos: {
    admin: 'FD900001', hr: 'FD100001', vp: 'FD100002', deptHead: 'FD210001',
    manager: 'FD210002', employee: 'FD210101', lowPerformer: 'FD210102', probation: 'FD210103',
  },
  q1: { taskCount: 120, exemptCount: 2, gradeCount: { A: 23, B: 47, C: 37, D: 11 } },
  q2: { taskCount: 124, exemptCount: 1, gradeCount: { A: 24, B: 49, C: 38, D: 12 } },
  q3: { taskCount: 128, taskStatusCount: { self_eval: 113, indicator_confirming: 9, indicator_setting: 6 } },
  annualLeaderTaskCount: 12,
} as const;
