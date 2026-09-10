import { test, expect } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
import { cycleBusinessState, cycleNextStep } from '../../src/views/admin/cycle-management';

const cases: Array<{ name: string; status: AssessmentCycle['status']; byStatus: NonNullable<AssessmentCycle['taskStats']>['byStatus']; approved: number; label: string; next: string }> = [
  { name: '全部审批后等待员工', status: 'approval', byStatus: { approval: 2 }, approved: 2, label: '待员工确认', next: '员工结果确认' },
  { name: '部分员工已确认', status: 'approval', byStatus: { approval: 1, confirmed: 1 }, approved: 2, label: '待员工确认', next: '员工结果确认' },
  { name: '全员确认后等待HR', status: 'approval', byStatus: { confirmed: 2 }, approved: 2, label: '待公示', next: '公示结果' },
  { name: '分批公示后仍有已确认记录', status: 'approval', byStatus: { confirmed: 1, published: 1 }, approved: 2, label: '待公示', next: '公示结果' },
  { name: '分批公示后仍有待确认记录', status: 'approval', byStatus: { approval: 1, published: 1 }, approved: 2, label: '待员工确认', next: '员工结果确认' },
  { name: '审批尚未全部通过', status: 'approval', byStatus: { approval: 2 }, approved: 1, label: '结果考评中', next: '结果审批' },
  { name: '全员实际公示', status: 'published', byStatus: { published: 2 }, approved: 2, label: '已公示', next: '等待归档' },
  { name: '兼容旧公示后确认记录', status: 'published', byStatus: { confirmed: 2 }, approved: 2, label: '已公示', next: '等待归档' },
  { name: '豁免不阻塞待公示', status: 'approval', byStatus: { confirmed: 1, exempted: 1 }, approved: 1, label: '待公示', next: '公示结果' },
];

for (const item of cases) {
  test(`周期结果状态：${item.name}`, () => {
    const cycle = { status: item.status, taskStats: { total: 2, approved: item.approved, exempted: item.byStatus.exempted ?? 0,
      unsubmitted: 0, pendingManagerReview: 0, pendingEmployeeConfirmation: 0, goalCompleted: 2, overdue: 0, byStatus: item.byStatus } } as AssessmentCycle;
    expect(cycleBusinessState(cycle).label).toBe(item.label);
    expect(cycleNextStep(cycle).label).toBe(item.next);
  });
}
