import { SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { lifecycleAttention } from './lifecycle-attention';

const viewer: AuthUser = { id: 'viewer', name: 'Fictional lifecycle viewer', sysRole: SysRole.hr_user,
  deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: ['performance_lifecycle_view'] };
function fixture(totals = [10, 20, 30, 40]) {
  return {
    assessmentTask: { count: jest.fn().mockResolvedValue(totals[0]), findMany: jest.fn().mockResolvedValue([]) },
    goalChangeRequest: { count: jest.fn().mockResolvedValue(totals[1]) },
    improvementPlan: { count: jest.fn().mockResolvedValue(totals[2]) },
    confirmationApplication: { count: jest.fn().mockResolvedValue(totals[3]) },
    user: { findMany: jest.fn() },
  };
}

describe('four original terminated-ledger cleanup aggregates (new pure cases)', () => {
  it('returns at most one aggregate per original ledger, with exact terminated filters and full record counts', async () => {
    const db = fixture([177, 203, 119, 81]);
    const rows = await lifecycleAttention(db as never, viewer);
    expect(rows.map(row => [row.id, row.recordCount, row.path])).toEqual([
      ['performance:cleanup:tasks', 177, '/tasks?goalView=monitor&lifecycleStatus=terminated'],
      ['performance:cleanup:goal-changes', 203, '/goal-changes?scope=all&lifecycleStatus=terminated'],
      ['performance:cleanup:improvement-plans', 119, '/improvement-plans?lifecycleStatus=terminated'],
      ['performance:cleanup:confirmations', 81, '/confirmation-applications/manage?lifecycleStatus=terminated'],
    ]);
    for (const reader of [db.assessmentTask, db.goalChangeRequest, db.improvementPlan, db.confirmationApplication]) {
      expect(reader.count).toHaveBeenCalledTimes(1);
      expect(reader.count).toHaveBeenCalledWith({ where: { lifecycleStatus: 'terminated' } });
    }
    expect(rows.every(row => row.kind === 'lifecycle_cleanup' && row.status === 'terminated' && !row.taskId && !row.requestId)).toBe(true);
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(JSON.stringify(rows)).not.toMatch(/employeeName|salary|score|approvalPath/);
  });

  it.each([
    { ...viewer, sysRole: SysRole.employee, hrCapabilities: [], canViewAll: true },
    { ...viewer, hrCapabilities: ['performance_lifecycle_delete'] },
  ])('does not infer cross-ledger cleanup visibility from all-data, delete-only, or cycle-owner scope', async actor => {
    const db = fixture();
    expect(await lifecycleAttention(db as never, actor)).toEqual([]);
    for (const reader of [db.assessmentTask, db.goalChangeRequest, db.improvementPlan, db.confirmationApplication]) {
      expect(reader.count).not.toHaveBeenCalled();
    }
    expect(db.assessmentTask.findMany.mock.calls[0][0].where).toMatchObject({ cycle: { hrOwnerId: 'viewer' }, lifecycleStatus: 'active' });
  });

  it('uses the original global HR lifecycle-view policy without granting wage rights or reading domain detail', async () => {
    const db = fixture([0, 8, 0, 3]);
    const rows = await lifecycleAttention(db as never, { ...viewer, sysRole: SysRole.hr, hrCapabilities: [] });
    expect(rows.map(row => row.id)).toEqual(['performance:cleanup:goal-changes', 'performance:cleanup:confirmations']);
    expect(Object.keys(db.goalChangeRequest)).toEqual(['count']);
    expect(Object.keys(db.improvementPlan)).toEqual(['count']);
    expect(Object.keys(db.confirmationApplication)).toEqual(['count']);
  });

  it('omits empty aggregates and refuses assessor-only identities before any query', async () => {
    const empty = fixture([0, 0, 0, 0]);
    expect(await lifecycleAttention(empty as never, viewer)).toEqual([]);
    const assessor = fixture();
    expect(await lifecycleAttention(assessor as never, { ...viewer, isAssessorOnly: true })).toEqual([]);
    expect(assessor.assessmentTask.findMany).not.toHaveBeenCalled();
    expect(assessor.goalChangeRequest.count).not.toHaveBeenCalled();
  });
});
