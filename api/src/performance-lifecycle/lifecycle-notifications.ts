import { Prisma } from '@prisma/client';

export async function isPerformanceNotificationActive(db: Prisma.TransactionClient,
  params: { taskId?: string | null; type: string; extraData?: Prisma.InputJsonValue }): Promise<boolean> {
  if (params.taskId) {
    const task = await db.assessmentTask.findUnique({ where: { id: params.taskId }, select: { lifecycleStatus: true } });
    if (!task || task.lifecycleStatus !== 'active') return false;
  }
  const extra = params.extraData && typeof params.extraData === 'object' && !Array.isArray(params.extraData)
    ? params.extraData as Record<string, unknown> : {};
  if (params.type.startsWith('confirmation_') && typeof extra.applicationId === 'string') {
    const record = await db.confirmationApplication.findUnique({ where: { id: extra.applicationId }, select: { lifecycleStatus: true } });
    return record?.lifecycleStatus === 'active';
  }
  if (params.type === 'improvement_plan' && typeof extra.improvementPlanId === 'string') {
    const record = await db.improvementPlan.findUnique({ where: { id: extra.improvementPlanId }, select: { lifecycleStatus: true } });
    return record?.lifecycleStatus === 'active';
  }
  if (params.type === 'goal_change' && typeof extra.goalChangeId === 'string') {
    const record = await db.goalChangeRequest.findUnique({ where: { id: extra.goalChangeId },
      select: { lifecycleStatus: true, task: { select: { lifecycleStatus: true } } } });
    return record?.lifecycleStatus === 'active' && record.task.lifecycleStatus === 'active';
  }
  return true;
}
