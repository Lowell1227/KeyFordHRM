import { Prisma, UserStatus } from '@prisma/client';

export const payrollParameterEligibleUser = {
  status: { in: [UserStatus.active, UserStatus.probation] }, archivedAt: null, deletedAt: null, isAssessorOnly: false,
};

export function payrollParameterReviewerWhere(actorId: string, subjectId?: string): Prisma.PayrollParameterReleaseWhereInput {
  return { reviewerId: actorId, ...(subjectId ? { subjectId } : {}),
    reviewer: { is: payrollParameterEligibleUser },
    submittedBy: { is: { ...payrollParameterEligibleUser, directManagerId: actorId,
      ...(subjectId ? { payrollGrants: { some: { subjectId, revokedAt: null, capabilities: { has: 'payroll_edit' } } } } : {}) } } };
}
