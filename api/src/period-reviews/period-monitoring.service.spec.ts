import { SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { PeriodMonitoringService } from './period-monitoring.service';

describe('PeriodMonitoringService', () => {
  const prisma = {
    assessmentCycle: { findUnique: jest.fn() },
    assessmentPeriod: { findMany: jest.fn() },
  };
  const dataScope = { getVisibleEmployeeFilter: jest.fn() };
  const service = new PeriodMonitoringService(prisma as any, dataScope as any);
  const viewer: AuthUser = {
    id: 'hr-1',
    name: '周期HR',
    sysRole: SysRole.hr_user,
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
    hrCapabilities: ['cycle_plan_review'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', name: '2026 Q3' });
    dataScope.getVisibleEmployeeFilter.mockResolvedValue({ deptId: { in: ['dept-1'] } });
    prisma.assessmentPeriod.findMany.mockResolvedValue([
      makePeriod({ id: 'p-7-a', sequence: 1, periodKey: '2026-07', employeeNo: '001', employeeName: '甲', selfEvalDueAt: '2026-09-02T10:00:00.000Z' }),
      makePeriod({ id: 'p-7-b', sequence: 1, periodKey: '2026-07', employeeNo: '002', employeeName: '乙', selfEvalDueAt: '2026-09-10T10:00:00.000Z' }),
      makePeriod({ id: 'p-8-a', sequence: 2, periodKey: '2026-08', employeeNo: '001', employeeName: '甲', employeeSubmittedAt: '2026-09-01T08:00:00.000Z' }),
      makePeriod({ id: 'p-9-a', sequence: 3, periodKey: '2026-09', employeeNo: '001', employeeName: '甲', employeeSubmittedAt: '2026-09-01T08:00:00.000Z', managerSubmittedAt: '2026-09-02T08:00:00.000Z', lockedAt: '2026-09-02T08:00:00.000Z', status: 'completed' }),
    ]);
  });

  it('按冻结任务统计四种月度自评状态并优先展示逾期', async () => {
    const result = await service.findCycleMonitoring('cycle-1', { page: 1, pageSize: 20 } as any, viewer, new Date('2026-09-03T00:00:00.000Z'));

    expect(dataScope.getVisibleEmployeeFilter).toHaveBeenCalledWith(viewer);
    expect(prisma.assessmentPeriod.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        task: expect.objectContaining({ cycleId: 'cycle-1', employee: { deptId: { in: ['dept-1'] } } }),
      }),
    }));
    expect(result.summary).toEqual({
      employeePending: 1,
      employeeOverdue: 1,
      managerPending: 1,
      managerCompleted: 1,
      total: 4,
    });
    expect(result.items.map((item) => item.id)).toEqual(['p-7-a', 'p-7-b', 'p-8-a', 'p-9-a']);
    expect(result.items[0]).toMatchObject({ derivedStatus: 'employee_overdue', canReopen: false });
    expect(result.items[3]).toMatchObject({
      derivedStatus: 'manager_completed',
      canReopen: false,
      reopenBlockedReason: '仅具备周期管理编辑权限的HR可重新开放',
    });
  });

  it('支持月份、状态、员工关键词筛选且分页总数不受页大小影响', async () => {
    const editViewer = { ...viewer, hrCapabilities: ['cycle_plan_edit'] };
    const result = await service.findCycleMonitoring('cycle-1', {
      page: 1,
      pageSize: 1,
      periodKey: '2026-09',
      status: 'manager_completed',
      keyword: '甲',
    } as any, editViewer, new Date('2026-09-03T00:00:00.000Z'));

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'p-9-a', canReopen: true, reopenBlockedReason: null });
  });
});

function makePeriod(options: {
  id: string;
  sequence: number;
  periodKey: string;
  employeeNo: string;
  employeeName: string;
  selfEvalDueAt?: string;
  employeeSubmittedAt?: string;
  managerSubmittedAt?: string;
  lockedAt?: string;
  status?: string;
}) {
  return {
    id: options.id,
    periodKey: options.periodKey,
    sequence: options.sequence,
    status: options.status ?? 'self_eval',
    draftVersion: 2,
    selfEvalOpenAt: new Date('2026-09-01T00:00:00.000Z'),
    selfEvalDueAt: new Date(options.selfEvalDueAt ?? '2026-09-10T10:00:00.000Z'),
    managerDueAt: new Date('2026-09-15T10:00:00.000Z'),
    employeeSubmittedAt: options.employeeSubmittedAt ? new Date(options.employeeSubmittedAt) : null,
    managerSubmittedAt: options.managerSubmittedAt ? new Date(options.managerSubmittedAt) : null,
    lockedAt: options.lockedAt ? new Date(options.lockedAt) : null,
    selfScoreTotal: null,
    managerScoreTotal: options.managerSubmittedAt ? { toNumber: () => 90 } : null,
    task: {
      id: `task-${options.employeeNo}`,
      status: options.managerSubmittedAt ? 'dept_review' : 'self_eval',
      publishedAt: null,
      participantDisposition: 'active',
      employee: { id: `employee-${options.employeeNo}`, employeeNo: options.employeeNo, name: options.employeeName },
      dept: { id: 'dept-1', name: '人事组' },
      manager: { id: 'manager-1', name: '方园' },
      cycle: { id: 'cycle-1', publishedAt: null },
      gradeResult: { isPublished: false, publishedAt: null },
    },
  };
}
