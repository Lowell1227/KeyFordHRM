import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// The candidate and application are resolved and locked by the caller before the identity lock.
export async function cancelledFirstHireIdentity(
  tx: Prisma.TransactionClient, candidateId: string | null, applicationId: string | null,
  requestId: string | undefined, employee: Record<string, unknown>, profile: Record<string, unknown>,
) {
  if (!candidateId || !applicationId) return null;
  const history = await tx.employeeDataChangeRequest.findMany({ where: {
    talentCandidateId: candidateId, sourceType: 'manual_employee_create', intakeType: 'new_hire',
    requiresArrivalConfirmation: true, recordStatus: 'cancelled', onboardingStatus: 'cancelled',
    cancelledAt: { not: null }, userId: { not: null },
    OR: [{ profileReviewStatus: 'approved' }, { employeeNumbers: { some: { status: 'released', userId: { not: null } } } }],
    arrivalConfirmedAt: null, arrivalConfirmedById: null, arrivalDate: null,
  }, select: { id: true, userId: true, talentApplicationId: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  if (!history.length) return null;
  const candidate = await tx.talentCandidate.findUnique({ where: { id: candidateId }, select: { deletedAt: true, convertedUserId: true } });
  if (!candidate || candidate.deletedAt || candidate.convertedUserId) throw new ConflictException('来源人才已删除或已转为员工，请核对原档案');
  const prior = history[0], userId = prior.userId!;
  if (history.some(row => row.userId !== userId)) throw new ConflictException('此人才的历史首次入职关联多个身份，请核对原档案');
  const sameApplication = history.find(row => row.talentApplicationId === applicationId);
  if (sameApplication) {
    return { userId, sourceRequestId: sameApplication.id, issue: '本次应聘已有取消的首次入职申请，请从原申请恢复办理', sameApplication: true };
  }
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: {
    name: true, phone: true, status: true, employeeNo: true, archivedAt: true, deletedAt: true, accountType: true,
    employeeProfile: { select: { phone: true, idNumberFingerprint: true } },
  } });
  if (!user || user.status !== 'pending_entry' || user.accountType !== 'employee' || user.archivedAt || user.deletedAt || user.employeeNo !== null) {
    throw new ConflictException('原员工身份或工号已变化，请核对原档案');
  }
  const employment = await tx.employmentRecord.findFirst({ where: { userId }, select: { id: true } });
  const number = await tx.employeeNumberAssignment.findFirst({ where: { userId, status: { not: 'released' },
    ...(requestId ? { NOT: { sourceRequestId: requestId, status: 'reserved' } } : {}) }, select: { id: true } });
  const storedFingerprint = user.employeeProfile?.idNumberFingerprint ?? null;
  const subject: Prisma.EmployeeDataChangeRequestWhereInput[] = [
    { userId }, { userId: null, baseValue: { path: ['firstHireIdentity', 'userId'], equals: userId } },
  ];
  if (storedFingerprint) subject.push({ userId: null, sourceType: 'manual_employee_create',
    proposedValue: { path: ['profile', 'idNumberFingerprint'], equals: storedFingerprint } });
  const unfinished: Prisma.EmployeeDataChangeRequestWhereInput = {
    archivedAt: null, cancelledAt: null, OR: [{ recordStatus: 'draft' }, { recordStatus: 'submitted', OR: [
      { onboardingStatus: { in: ['submitted', 'pending_entry'] } }, { profileReviewStatus: { in: ['pending', 'applying', 'rejected'] } },
      { performanceReviewStatus: { in: ['pending', 'applying', 'rejected'] } }, { profileReviewStatus: 'approved', appliedAt: null },
    ] }],
  };
  const otherRequest = await tx.employeeDataChangeRequest.findFirst({ where: {
    ...(requestId ? { id: { not: requestId } } : {}),
    AND: [{ OR: subject }, { OR: [{ arrivalConfirmedAt: { not: null } }, { onboardingStatus: 'effective' }, { intakeType: 'reentry' }, unfinished] }],
  }, select: { id: true } });
  if (employment || number || otherRequest) throw new ConflictException('原身份已有任职、工号、到岗记录或其他办理申请，请先核对原档案');
  const phone = typeof employee.phone === 'string' ? employee.phone : profile.phone;
  let issue = '';
  if (storedFingerprint !== (profile.idNumberFingerprint ?? null)) issue = '请核对原待入职档案的身份证号，填写一致后继续';
  else if (employee.name !== user.name || !phone || ![user.phone, user.employeeProfile?.phone].includes(String(phone))) {
    issue = '请核对原待入职档案的姓名和手机号，填写一致后继续';
  }
  return { userId, sourceRequestId: prior.id, issue, sameApplication: false };
}
