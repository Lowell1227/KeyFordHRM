import { TaskStatus } from '@prisma/client';

export const TEST_ACCEPTANCE_CYCLE_NAME = '测试·2026 Q3 绩效验收周期';

export const ACCEPTANCE_TASK_PLAN = [
  { employeeNo: 'HR001', managerNo: 'VP001', status: TaskStatus.self_eval },
  { employeeNo: 'VP001', managerNo: 'ADMIN', status: TaskStatus.indicator_confirming },
  { employeeNo: 'MGR001', managerNo: 'VP001', status: TaskStatus.manager_scoring },
  { employeeNo: 'EMP001', managerNo: 'MGR001', status: TaskStatus.indicator_reviewing },
  { employeeNo: 'EMP002', managerNo: 'MGR001', status: TaskStatus.self_eval },
  { employeeNo: 'EMP003', managerNo: 'MGR001', status: TaskStatus.manager_scoring },
  { employeeNo: 'EMP004', managerNo: 'MGR001', status: TaskStatus.published },
] as const;
