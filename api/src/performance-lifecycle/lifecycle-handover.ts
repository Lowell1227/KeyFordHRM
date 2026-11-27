import { Prisma } from '@prisma/client';

/** Caller must first apply its original record scope; this hook never changes frozen reviewers. */
export async function performanceHandover(db: Prisma.TransactionClient, reviewerIds: readonly (string | null | undefined)[]) {
  const ids = [...new Set(reviewerIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return { handoverRequired: false, unavailableReviewerIds: [] as string[], handoverIssue: null as string | null };
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, archivedAt: true, deletedAt: true } });
  const available = new Set(users.filter((user) => ['active', 'probation'].includes(user.status) && !user.archivedAt && !user.deletedAt).map((user) => user.id));
  const unavailableReviewerIds = ids.filter((id) => !available.has(id));
  return { handoverRequired: unavailableReviewerIds.length > 0, unavailableReviewerIds,
    handoverIssue: unavailableReviewerIds.length ? '当前办理人已不在有效任职范围，请联系 HR 核对交接；原审核关系未自动变更' : null };
}
