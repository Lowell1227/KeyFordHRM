import { SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { PerformanceOperationsService } from './performance-operations.service';
import { lifecycleAttention } from './lifecycle-attention';

jest.mock('@/confirmation/confirmation.service', () => ({ ConfirmationService: class {} }));
jest.mock('@/approval/approval.service', () => ({ ApprovalService: class {} }));
jest.mock('@/calibration/calibration.service', () => ({ CalibrationService: class {} }));
jest.mock('@/tasks/tasks.service', () => ({ TasksService: class {} }));
jest.mock('./lifecycle-attention', () => ({ lifecycleAttention: jest.fn().mockResolvedValue([]) }));

const actor: AuthUser = { id: 'viewer', name: 'Fictional viewer', sysRole: SysRole.employee,
  deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: [] };
const confirmationRow = (id: string, more: Record<string, unknown> = {}) => ({ id, employeeId: 'employee',
  workflowVersion: 2, pendingRole: 'manager', status: 'submitted', employee: { name: 'Fictional employee' }, ...more });

function setup(viewer = actor) {
  const prisma = { assessmentTask: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    assessmentCycle: { findMany: jest.fn().mockResolvedValue([]) } };
  const confirmation = {
    findPending: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    findMine: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const approvals = { getApprovalList: jest.fn().mockResolvedValue([]) };
  const calibration = { listCycles: jest.fn().mockResolvedValue([]), getWorkbench: jest.fn().mockResolvedValue({ items: [] }) };
  const tasks = { findDepartmentReviews: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const service = new PerformanceOperationsService(prisma as never, confirmation as never, approvals as never, calibration as never, tasks as never);
  return { prisma, confirmation, approvals, calibration, tasks, get: () => service.read(viewer) };
}

describe('performance operations original-scope projection (pure)', () => {
  it('never turns retained terminated own drafts or waiting applications back into work', async () => {
    const f = setup();
    const mine = ['draft', 'submitted', 'hr_approved'].map(status => confirmationRow(status, {
      employeeId: actor.id, status, lifecycleStatus: 'terminated', pendingRole: null,
    }));
    f.confirmation.findMine.mockResolvedValue({ items: mine, total: mine.length });
    expect(await f.get()).toEqual({ visible: true, actionable: [], attention: [] });
  });
  it('reuses every pending confirmation page and respects original pendingRole', async () => {
    const f = setup();
    const rows = Array.from({ length: 107 }, (_, i) => confirmationRow(`confirmation-${i}`));
    rows.push(confirmationRow('history-not-handler', { pendingRole: null }));
    f.confirmation.findPending.mockImplementation(async ({ page, pageSize }) => ({
      items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length,
    }));
    const result = await f.get();
    expect(result.actionable).toHaveLength(107);
    expect(f.confirmation.findPending).toHaveBeenCalledTimes(2);
    expect(f.confirmation.findPending.mock.calls[1][0]).toMatchObject({ page: 2, pageSize: 100, skip: 100, take: 100 });
    expect(result.actionable[0].path).toBe('/confirmation-applications/manage/confirmation-0');
  });

  it('separates own draft/returned work from own applications waiting on others, without internal fields', async () => {
    const f = setup();
    const mine = [confirmationRow('draft', { employeeId: 'viewer', status: 'draft', summary: 'private narrative', salary: 12345 }),
      confirmationRow('waiting', { employeeId: 'viewer', status: 'hr_approved' }),
      confirmationRow('done', { employeeId: 'viewer', status: 'approved' }),
      confirmationRow('other-person', { status: 'draft' })];
    f.confirmation.findMine.mockResolvedValue({ total: mine.length, items: mine });
    const result = await f.get();
    expect(result.actionable.map(row => row.requestId)).toEqual(['draft']);
    expect(result.attention.map(row => row.requestId)).toEqual(['waiting']);
    expect(JSON.stringify(result)).not.toMatch(/private narrative|12345|salary|vote|summary/);
    expect(result.actionable[0].path).toBe('/confirmation-applications/mine/draft');
  });

  it('does not infer approvals from administrator/all-data access or historical completed records', async () => {
    const f = setup({ ...actor, sysRole: SysRole.system_admin, canViewAll: true });
    f.prisma.assessmentTask.findMany.mockResolvedValue([{ cycleId: 'cycle' }]);
    const row = { id: 'current', cycleId: 'cycle', employeeId: 'employee', employeeName: 'Fictional employee',
      approverId: 'viewer', approvedAt: null, status: 'approval', totalScore: 98.7, rawGrade: 'A' };
    f.approvals.getApprovalList.mockResolvedValue([row, { ...row, id: 'not-mine', approverId: 'other' },
      { ...row, id: 'self', employeeId: 'viewer' }, { ...row, id: 'already-approved', approvedAt: new Date() },
      { ...row, id: 'wrong-stage', status: 'hr_calibration' }]);
    const result = await f.get();
    expect(result.actionable.map(item => item.taskId)).toEqual(['current']);
    expect(result.actionable[0].path).toBe('/approval?cycleId=cycle&taskId=current');
    expect(f.prisma.assessmentTask.findMany.mock.calls[0][0]).toMatchObject({ where: {
      approverId: 'viewer', employeeId: { not: 'viewer' }, isExempt: false, status: 'approval', approvedAt: null,
    }, select: { cycleId: true }, distinct: ['cycleId'] });
    expect(JSON.stringify(result)).not.toMatch(/98.7|rawGrade|totalScore/);
  });

  it('uses the original calibration owner/capability scope and only actionable non-self rows', async () => {
    const f = setup();
    f.prisma.assessmentCycle.findMany.mockResolvedValue([{ id: 'assigned-cycle', hrOwnerId: 'viewer' }, { id: 'not-mine', hrOwnerId: 'other' }]);
    f.calibration.getWorkbench.mockResolvedValue({ items: [
      { taskId: 'calibrate', employeeName: 'Fictional employee', status: 'hr_calibration', canCalibrate: true, canViewDetail: true },
      { taskId: 'self', employeeName: 'Fictional self', status: 'hr_calibration', canCalibrate: false, canViewDetail: false },
      { taskId: 'not-yet', employeeName: 'Fictional employee', status: 'dept_review', canCalibrate: false, canViewDetail: true },
    ] });
    const result = await f.get();
    expect(f.calibration.listCycles).not.toHaveBeenCalled();
    expect(f.prisma.assessmentCycle.findMany.mock.calls[0][0].where).toMatchObject({ hrOwnerId: 'viewer',
      tasks: { some: { status: 'hr_calibration', isExempt: false, employeeId: { not: 'viewer' } } } });
    expect(f.calibration.getWorkbench).toHaveBeenCalledWith('assigned-cycle', actor);
    expect(f.calibration.getWorkbench).toHaveBeenCalledTimes(1);
    expect(result.actionable.map(row => row.taskId)).toEqual(['calibrate']);
    expect(result.actionable[0].path).toBe('/calibration?cycleId=assigned-cycle&taskId=calibrate');
  });

  it('keeps frozen department-review scope and counts every page before sampling', async () => {
    const f = setup();
    f.prisma.assessmentTask.findFirst.mockResolvedValue({ id: 'dept-0' });
    const rows = Array.from({ length: 104 }, (_, i) => ({ id: `dept-${i}`, cycleId: 'cycle', employeeId: 'employee',
      employeeName: 'Fictional employee', status: 'dept_review', isExempt: false, departmentReview: { canReview: true } }));
    f.tasks.findDepartmentReviews.mockImplementation(async ({ page, pageSize }) => ({
      total: rows.length, items: rows.slice((page - 1) * pageSize, page * pageSize),
    }));
    const result = await f.get();
    expect(result.actionable).toHaveLength(104);
    expect(f.tasks.findDepartmentReviews).toHaveBeenCalledTimes(2);
    expect(f.tasks.findDepartmentReviews.mock.calls[0][0]).toMatchObject({ status: 'dept_review' });
    expect(result.actionable[0].path).toBe('/department-review/dept-0?cycleId=cycle');
  });

  it('omits assessor-only identities without querying any personal operations', async () => {
    const f = setup({ ...actor, isAssessorOnly: true });
    expect(await f.get()).toEqual({ visible: false, actionable: [], attention: [] });
    expect(f.confirmation.findPending).not.toHaveBeenCalled();
    expect(f.calibration.listCycles).not.toHaveBeenCalled();
    expect(f.prisma.assessmentTask.findMany).not.toHaveBeenCalled();
  });

  it('keeps an ordinary employee with no assigned work ready/empty and never invokes privileged readers', async () => {
    const f = setup();
    f.calibration.getWorkbench.mockRejectedValue(new Error('must not call'));
    f.tasks.findDepartmentReviews.mockRejectedValue(new Error('must not call'));
    expect(await f.get()).toEqual({ visible: true, actionable: [], attention: [] });
    expect(f.calibration.listCycles).not.toHaveBeenCalled();
    expect(f.calibration.getWorkbench).not.toHaveBeenCalled();
    expect(f.tasks.findDepartmentReviews).not.toHaveBeenCalled();
    expect(f.approvals.getApprovalList).not.toHaveBeenCalled();
  });

  it('permits the explicit HR calibration capability only in cycles with current pending non-self work', async () => {
    const f = setup({ ...actor, sysRole: SysRole.hr_user, hrCapabilities: ['performance_calibration'] });
    f.prisma.assessmentCycle.findMany.mockResolvedValue([{ id: 'pending-cycle', hrOwnerId: 'other' }]);
    f.calibration.getWorkbench.mockResolvedValue({ items: [
      { taskId: 'current', employeeName: 'Fictional employee', status: 'hr_calibration', canCalibrate: true, canViewDetail: true },
    ] });
    expect((await f.get()).actionable.map(row => row.taskId)).toEqual(['current']);
    const where = f.prisma.assessmentCycle.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('hrOwnerId');
    expect(where.tasks.some).toMatchObject({ status: 'hr_calibration', isExempt: false, employeeId: { not: 'viewer' } });
  });

  it('keeps management handover separate from normal pending approval/calibration work', async () => {
    const f = setup({ ...actor, sysRole: SysRole.hr_user, hrCapabilities: ['performance_lifecycle_view', 'performance_calibration'] });
    f.prisma.assessmentCycle.findMany.mockResolvedValue([{ id: 'cycle', hrOwnerId: 'former-owner' }]);
    f.calibration.getWorkbench.mockResolvedValue({ items: [
      { taskId: 'handover', employeeName: 'Fictional employee', status: 'hr_calibration', canCalibrate: true, canViewDetail: true },
    ] });
    jest.mocked(lifecycleAttention).mockResolvedValueOnce([{ id: 'attention', kind: 'lifecycle_handover', title: 'Current owner unavailable',
      status: 'handover_required', nextAction: 'Check handover', path: '/tasks/handover', taskId: 'handover', dueAt: null }]);
    const result = await f.get();
    expect(result.actionable).toEqual([]);
    expect(result.attention.map(row => row.taskId)).toEqual(['handover']);
    expect(f.prisma.assessmentCycle.findMany.mock.calls[0][0].where.tasks.some.lifecycleStatus).toBe('active');
    expect(f.prisma.assessmentTask.findMany.mock.calls[0][0].where.lifecycleStatus).toBe('active');
    expect(f.prisma.assessmentTask.findFirst.mock.calls[0][0].where.lifecycleStatus).toBe('active');
  });
});
