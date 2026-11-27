import { SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { lifecycleAttention } from './lifecycle-attention';

const actor: AuthUser = { id: 'viewer', name: 'Fictional viewer', sysRole: SysRole.employee,
  deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: [] };
const user = (id: string, status = 'active') => ({ id, status, deletedAt: null, archivedAt: null });
const task = (id: string, more: Record<string, unknown> = {}) => ({ id, cycleId: 'cycle', employeeId: 'employee',
  employmentRecordId: 'employment', status: 'indicator_dept_reviewing', managerId: 'manager', deptHeadId: 'head', approverId: 'approver',
  employee: user('employee'), cycle: { hrOwnerId: 'viewer' }, ...more });
function setup(tasks: unknown[] = [], users = [user('manager'), user('head'), user('approver'), user('employee'), user('viewer')]) {
  return { assessmentTask: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue(tasks) },
    goalChangeRequest: { count: jest.fn().mockResolvedValue(0) },
    improvementPlan: { count: jest.fn().mockResolvedValue(0) },
    confirmationApplication: { count: jest.fn().mockResolvedValue(0) },
    user: { findMany: jest.fn().mockResolvedValue(users) } };
}

describe('scoped lifecycle management attention (pure)', () => {
  it('requires lifecycle-view/global HR scope for the single aggregate terminated-ledger action', async () => {
    const db = setup(); db.assessmentTask.count.mockResolvedValue(177);
    const result = await lifecycleAttention(db as never, { ...actor, sysRole: SysRole.hr_user, hrCapabilities: ['performance_lifecycle_view'] });
    expect(result).toEqual([expect.objectContaining({ kind: 'lifecycle_cleanup', recordCount: 177,
      path: '/tasks?goalView=monitor&lifecycleStatus=terminated' })]);
    expect(db.assessmentTask.count).toHaveBeenCalledWith({ where: { lifecycleStatus: 'terminated' } });
    expect(db.assessmentTask.findMany.mock.calls[0][0].where).not.toHaveProperty('cycle');
  });

  it('does not infer management or cleanup rights from canViewAll or a job title', async () => {
    const db = setup([task('other', { cycle: { hrOwnerId: 'other' } })], []);
    expect(await lifecycleAttention(db as never, { ...actor, canViewAll: true })).toEqual([]);
    expect(db.assessmentTask.count).not.toHaveBeenCalled();
    expect(db.assessmentTask.findMany.mock.calls[0][0].where).toMatchObject({ cycle: { hrOwnerId: 'viewer' }, lifecycleStatus: 'active' });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('uses the frozen current goal-review owner, not future reviewers, without rewriting it', async () => {
    const db = setup([task('current-head'), task('healthy-manager', { status: 'indicator_reviewing' })],
      [user('manager'), user('head', 'resigned'), user('approver', 'resigned')]);
    const result = await lifecycleAttention(db as never, actor);
    expect(result.map(row => [row.taskId, row.kind])).toEqual([['current-head', 'lifecycle_handover']]);
    expect(result[0].path).toBe('/calibration?cycleId=cycle&taskId=current-head');
    expect(Object.keys(db.assessmentTask)).toEqual(['count', 'findMany']);
    expect(db.user.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(['head', 'manager']);
  });

  it('flags absent result approvers and keeps null-employment legacy rows review-only', async () => {
    const db = setup([task('missing-approver', { status: 'approval', approverId: null }),
      task('legacy', { employmentRecordId: null }), task('departed-person', { employee: user('employee', 'resigned') })], [user('head', 'resigned')]);
    const result = await lifecycleAttention(db as never, actor);
    expect(result.map(row => [row.taskId, row.kind])).toEqual([
      ['missing-approver', 'lifecycle_handover'], ['legacy', 'lifecycle_review_needed'], ['departed-person', 'lifecycle_review_needed'],
    ]);
    expect(result.find(row => row.taskId === 'legacy')?.nextAction).toContain('不自动清理或改派');
  });

  it('reports all scoped issues for later pagination while selecting no salary or score fields', async () => {
    const db = setup(Array.from({ length: 119 }, (_, i) => task(`task-${i}`)), [user('head', 'resigned')]);
    const result = await lifecycleAttention(db as never, actor);
    expect(result).toHaveLength(119);
    const query = db.assessmentTask.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ lifecycleStatus: 'active', approvedAt: null, isExempt: false });
    expect(query.select).not.toHaveProperty('gradeResult');
    expect(query.select).not.toHaveProperty('sources');
    expect(JSON.stringify(result)).not.toMatch(/salary|score|employeeName/);
  });
});
