import { Prisma, PrismaClient } from '@prisma/client';

/** Keep cycle ownership scoped; never assign an employee their own calibration. */
export async function resolveCalibrationRecipient(
  prisma: Pick<PrismaClient, 'user'>,
  task: { employeeId: string; deptHeadId: string | null; managerId: string | null },
  hrOwnerId: string | null,
): Promise<string | null> {
  if (!hrOwnerId) return null;
  if (hrOwnerId && hrOwnerId !== task.employeeId) return hrOwnerId;

  const eligible: Prisma.UserWhereInput = {
    status: 'active', deletedAt: null,
    OR: [
      { sysRole: { in: ['hr', 'system_admin'] } },
      { sysRole: 'hr_user', hrCapabilities: { has: 'performance_calibration' } },
    ],
  };
  const frozenReviewers = [...new Set([task.deptHeadId, task.managerId])]
    .filter((id): id is string => Boolean(id) && id !== task.employeeId);
  for (const id of frozenReviewers) {
    const user = await prisma.user.findFirst({ where: { ...eligible, id }, select: { id: true } });
    if (user) return user.id;
  }
  const fallback = await prisma.user.findFirst({
    where: { ...eligible, id: { not: task.employeeId } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true },
  });
  return fallback?.id ?? null;
}
