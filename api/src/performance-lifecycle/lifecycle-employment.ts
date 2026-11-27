import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { approvedEmploymentSourceWhere, selectEmploymentAt, shanghaiBusinessDate } from '@/employee-archives/employment-timeline';
import { lockLifecycleRow } from './lifecycle-lock';
import { LifecycleKind, lifecycleTerminationProtected } from './lifecycle-policy';

export async function resolveLifecycleEmployment(tx: Prisma.TransactionClient, employeeId: string, at = new Date()): Promise<string | null> {
  // Offboarding/reentry updates this row too; do not create a plan after that commit.
  await tx.$queryRaw`SELECT id FROM users WHERE id=${employeeId}::uuid FOR SHARE`;
  const employee = await tx.user.findUnique({ where: { id: employeeId }, select: { status: true, deletedAt: true, archivedAt: true } });
  if (!employee || !['active', 'probation'].includes(employee.status) || employee.deletedAt || employee.archivedAt) {
    throw new ConflictException('员工已不在有效任职范围，请刷新后重试');
  }
  const employments = await tx.employmentRecord.findMany({ where: { userId: employeeId, ...approvedEmploymentSourceWhere } });
  const selection = selectEmploymentAt(employments, shanghaiBusinessDate(at));
  // Legacy missing/ambiguous employment is not guessed and is never auto-cleaned later.
  return selection.matches.length === 1 && ['active', 'probation'].includes(selection.current!.employeeStatus)
    ? selection.current!.id : null;
}

/** Called ONLY by an actual transition to effective resignation, within its transaction. */
export async function terminateEmploymentPerformance(tx: Prisma.TransactionClient, employeeId: string,
  departingEmploymentId: string, at: Date, actorId: string | null) {
  const employment = await tx.employmentRecord.findUnique({ where: { id: departingEmploymentId } });
  if (!employment || employment.userId !== employeeId) throw new ConflictException('离职任职关联不一致');
  const sameSpell = employment.entryDate && employment.employeeNo
    ? await tx.employmentRecord.findMany({ where: { userId: employeeId, entryDate: employment.entryDate,
      employeeNo: employment.employeeNo, ...approvedEmploymentSourceWhere }, select: { id: true } })
    : [{ id: employment.id }];
  const where = { employeeId, employmentRecordId: { in: sameSpell.map((row) => row.id) }, lifecycleStatus: 'active' };
  const groups = [
    ['task', await tx.assessmentTask.findMany({ where, orderBy: { id: 'asc' } })],
    ['improvement_plan', await tx.improvementPlan.findMany({ where, orderBy: { id: 'asc' } })],
    ['confirmation', await tx.confirmationApplication.findMany({ where, orderBy: { id: 'asc' } })],
  ] as const;
  for (const [kind, rows] of groups) for (const identity of rows) {
    const row = await lockLifecycleRow(tx, kind, identity.id);
    if (!row || row.lifecycleStatus !== 'active' || lifecycleTerminationProtected(kind, row)) continue;
    const reason = '员工该次任职离职已生效，结束尚未完成的办理；既有业务事实不变';
    const data = { lifecycleStatus: 'terminated', lifecycleVersion: { increment: 1 }, terminatedAt: at,
      terminatedById: actorId, terminationReason: reason, updatedAt: new Date(Math.max(at.getTime(), row.updatedAt.getTime() + 1)) };
    // Terminate dependent unfinished changes before ending their task; applied versions stay untouched.
    if (kind === 'task') {
      const changes = await tx.goalChangeRequest.findMany({ where: { taskId: row.id, lifecycleStatus: 'active',
        effectiveVersionId: null, status: { notIn: ['active', 'revoked'] } }, orderBy: { id: 'asc' } });
      for (const change of changes) {
        await tx.goalChangeRequest.updateMany({ where: { id: change.id, lifecycleStatus: 'active' }, data });
        await auditTermination(tx, 'goal_change', change.id, change.status, employeeId, departingEmploymentId, actorId, reason);
      }
    }
    switch (kind) {
      case 'task': await tx.assessmentTask.updateMany({ where: { id: row.id, lifecycleStatus: 'active' }, data }); break;
      case 'improvement_plan': await tx.improvementPlan.updateMany({ where: { id: row.id, lifecycleStatus: 'active' }, data }); break;
      case 'confirmation': await tx.confirmationApplication.updateMany({ where: { id: row.id, lifecycleStatus: 'active' }, data }); break;
    }
    await auditTermination(tx, kind, row.id, row.status, employeeId, departingEmploymentId, actorId, reason);
    if (kind === 'task') await tx.notificationLog.updateMany({ where: { taskId: row.id, status: { in: ['pending', 'failed'] } },
      data: { status: 'cancelled', errorMsg: 'performance_lifecycle_ended' } });
  }
}

async function auditTermination(tx: Prisma.TransactionClient, kind: LifecycleKind, id: string, status: string,
  employeeId: string, employmentId: string, actorId: string | null, reason: string) {
  const entityType = kind === 'task' ? 'assessment_task' : kind === 'confirmation' ? 'confirmation_application' : kind;
  await tx.auditLog.create({ data: { userId: actorId, action: 'lifecycle_terminated', entityType, entityId: id,
    oldValue: { status, lifecycleStatus: 'active' },
    newValue: { status, lifecycleStatus: 'terminated', employeeId, employmentRecordId: employmentId,
      reason, source: 'effective_offboarding' } } });
}
