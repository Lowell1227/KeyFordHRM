import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertLifecycleActive, LifecycleKind } from './lifecycle-policy';

export async function lockLifecycleRow(tx: Prisma.TransactionClient, kind: LifecycleKind, id: string) {
  switch (kind) {
    case 'task':
      // Match goal-change/monthly review ordering: period rows, then parent task.
      await tx.$queryRaw`SELECT id FROM assessment_periods WHERE task_id=${id}::uuid ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM assessment_tasks WHERE id=${id}::uuid FOR UPDATE`;
      return tx.assessmentTask.findUnique({ where: { id }, include: { gradeResult: {
        select: { approvedAt: true, employeeConfirmedAt: true, publishedAt: true, isPublished: true },
      } } });
    case 'goal_change': {
      const identity = await tx.goalChangeRequest.findUnique({ where: { id }, select: { taskId: true } });
      if (!identity) throw new NotFoundException('目标变更不存在');
      await lockLifecycleRow(tx, 'task', identity.taskId);
      await tx.$queryRaw`SELECT id FROM goal_change_requests WHERE id=${id}::uuid FOR UPDATE`;
      return tx.goalChangeRequest.findUnique({ where: { id } });
    }
    case 'improvement_plan':
      await tx.$queryRaw`SELECT id FROM improvement_plans WHERE id=${id}::uuid FOR UPDATE`;
      return tx.improvementPlan.findUnique({ where: { id } });
    case 'confirmation':
      await tx.$queryRaw`SELECT id FROM confirmation_applications WHERE id=${id}::uuid FOR UPDATE`;
      return tx.confirmationApplication.findUnique({ where: { id } });
  }
}

// Call inside the writing transaction, not only during the preflight read.
export async function lockActiveTask(tx: Prisma.TransactionClient, taskId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ lifecycleStatus: string }>>`
    SELECT lifecycle_status AS "lifecycleStatus" FROM assessment_tasks WHERE id=${taskId}::uuid FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('绩效任务不存在');
  assertLifecycleActive(rows[0]);
}
