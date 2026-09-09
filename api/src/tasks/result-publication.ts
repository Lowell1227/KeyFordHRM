import { Prisma, TaskStatus } from '@prisma/client';

export interface ResultPublicationFact {
  status: TaskStatus;
  approvedAt?: Date | null;
  publishedAt?: Date | null;
  employeeConfirmedAt?: Date | null;
  gradeResult?: { approvedAt?: Date | null; publishedAt?: Date | null; isPublished?: boolean } | null;
}

/** confirmed may precede publication; retain legacy post-publication statuses. */
export function isResultPublished(task: ResultPublicationFact): boolean {
  return Boolean(task.publishedAt || task.gradeResult?.publishedAt || task.gradeResult?.isPublished)
    || (['published', 'appealing', 'closed'] as TaskStatus[]).includes(task.status);
}

export function canEmployeeViewResult(task: ResultPublicationFact): boolean {
  return isResultPublished(task) || (
    (task.status === 'approval' || task.status === 'confirmed')
    && Boolean(task.approvedAt || task.gradeResult?.approvedAt)
  );
}

export const PUBLISHED_RESULT_WHERE: Prisma.AssessmentTaskWhereInput = {
  OR: [
    { publishedAt: { not: null } },
    { gradeResult: { is: { OR: [{ isPublished: true }, { publishedAt: { not: null } }] } } },
    { status: { in: ['published', 'appealing', 'closed'] } },
  ],
};
