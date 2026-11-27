import { Prisma } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import type { PrismaService } from '@/prisma/prisma.service';
import { canManageLifecycle } from '@/performance-lifecycle/lifecycle-policy';
import { performanceHandover } from '@/performance-lifecycle/lifecycle-handover';
import { getGoalReviewActorId } from '@/tasks/goal-workflow';
import type { OperationItem } from './operations.dto';
import { operationPath } from './operations-projection';

const attentionSelect = {
  id: true, cycleId: true, status: true, employeeId: true, employmentRecordId: true,
  managerId: true, deptHeadId: true, approverId: true,
  employee: { select: { status: true, archivedAt: true, deletedAt: true } },
  cycle: { select: { hrOwnerId: true } },
} satisfies Prisma.AssessmentTaskSelect;
type AttentionTask = Prisma.AssessmentTaskGetPayload<{ select: typeof attentionSelect }>;

function currentOwner(row: AttentionTask): string | null {
  if (['indicator_setting', 'indicator_reviewing', 'indicator_dept_reviewing', 'indicator_approving'].includes(row.status)) {
    return getGoalReviewActorId(row);
  }
  if (row.status === 'manager_scoring') return row.managerId;
  if (row.status === 'dept_review') return row.deptHeadId;
  if (row.status === 'hr_calibration') return row.cycle.hrOwnerId;
  if (row.status === 'approval') return row.approverId;
  return row.employeeId;
}

export async function lifecycleAttention(prisma: PrismaService, actor: AuthUser): Promise<OperationItem[]> {
  if (actor.isAssessorOnly) return [];
  const global = canManageLifecycle(actor, 'view');
  const attention: OperationItem[] = [];
  // A cycle owner alone cannot open the global terminated ledger; keep its existing scope unchanged.
  if (global) {
    // These four original ledgers already allow lifecycle-view scope; no historical status is inferred.
    const totals = await Promise.all([
      prisma.assessmentTask.count({ where: { lifecycleStatus: 'terminated' } }),
      prisma.goalChangeRequest.count({ where: { lifecycleStatus: 'terminated' } }),
      prisma.improvementPlan.count({ where: { lifecycleStatus: 'terminated' } }),
      prisma.confirmationApplication.count({ where: { lifecycleStatus: 'terminated' } }),
    ]);
    const ledgers: Array<{ key: string; label: string; path: string; query: Record<string, string> }> = [
      { key: 'tasks', label: '绩效记录', path: '/tasks', query: { goalView: 'monitor', lifecycleStatus: 'terminated' } },
      { key: 'goal-changes', label: '目标变更', path: '/goal-changes', query: { scope: 'all', lifecycleStatus: 'terminated' } },
      { key: 'improvement-plans', label: '改进计划', path: '/improvement-plans', query: { lifecycleStatus: 'terminated' } },
      { key: 'confirmations', label: '转正申请', path: '/confirmation-applications/manage', query: { lifecycleStatus: 'terminated' } },
    ];
    for (const [index, ledger] of ledgers.entries()) {
      const total = totals[index];
      if (total) attention.push({ id: `performance:cleanup:${ledger.key}`, kind: 'lifecycle_cleanup',
        title: `已终止待清理 · ${total} 项${ledger.label}`, status: 'terminated',
        nextAction: '核对已终止记录，按原权限逐项移入历史', dueAt: null, recordCount: total,
        path: operationPath(ledger.path, ledger.query) });
    }
  }
  const tasks = await prisma.assessmentTask.findMany({ where: {
    lifecycleStatus: 'active', isExempt: false, approvedAt: null,
    ...(!global ? { cycle: { hrOwnerId: actor.id } } : {}),
    status: { in: ['pending', 'indicator_drafting', 'indicator_setting', 'indicator_reviewing', 'indicator_dept_reviewing',
      'indicator_confirming', 'indicator_approving', 'self_eval', 'manager_scoring', 'dept_review', 'hr_calibration', 'approval'] },
  }, select: attentionSelect, orderBy: { id: 'asc' } });
  const scoped = tasks.filter(row => global || row.cycle.hrOwnerId === actor.id);
  const handover = await performanceHandover(prisma, scoped.map(currentOwner));
  const unavailable = new Set(handover.unavailableReviewerIds);
  for (const row of scoped) {
    const owner = currentOwner(row);
    const employeeUnavailable = !row.employee || !['active', 'probation'].includes(row.employee.status)
      || !!row.employee.archivedAt || !!row.employee.deletedAt;
    if (!employeeUnavailable && owner && !unavailable.has(owner)) continue;
    const needsReview = !row.employmentRecordId || employeeUnavailable || owner === row.employeeId;
    attention.push({ id: `performance:${needsReview ? 'review-needed' : 'handover'}:${row.id}`,
      kind: needsReview ? 'lifecycle_review_needed' : 'lifecycle_handover',
      title: needsReview ? '绩效记录待核对' : '当前办理人待交接', status: needsReview ? 'needs_review' : 'handover_required',
      nextAction: needsReview ? '核对任职绑定和当前人员状态，不自动清理或改派'
        : '由有权人员核对交接安排，原审核关系保持不变', dueAt: null, taskId: row.id, cycleId: row.cycleId,
      path: global || row.employeeId === actor.id ? `/tasks/${encodeURIComponent(row.id)}`
        : operationPath('/calibration', { cycleId: row.cycleId, taskId: row.id }) });
  }
  return attention;
}
