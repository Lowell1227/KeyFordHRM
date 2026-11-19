import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const talentSourceSelect = { id: true, name: true, deletedAt: true } as const;

export async function lockTalentSource(tx: Prisma.TransactionClient, id?: string | null): Promise<void> {
  if (id) await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function resolveTalentSource(
  tx: Prisma.TransactionClient,
  inputId?: string,
  existing?: { id: string; talentCandidateId?: string | null },
  userId?: string | null,
): Promise<string | null> {
  const existingId = existing?.talentCandidateId ?? null;
  if (existing && inputId !== undefined && inputId !== existingId) {
    throw new ConflictException('申请来源人才不能更换，请保留原来源');
  }
  const id = existingId ?? inputId;
  if (!id) return null;
  // Serialize intake creation with other intakes and candidate deletion.
  await lockTalentSource(tx, id);
  const candidate = await tx.talentCandidate.findUnique({ where: { id },
    select: { id: true, deletedAt: true, convertedUserId: true } });
  if (!candidate || (!existingId && candidate.deletedAt)) throw new NotFoundException('来源人才不存在或已删除');
  if (!existingId && candidate.convertedUserId && candidate.convertedUserId !== userId) {
    throw new ConflictException('来源人才已关联员工，请从原员工档案办理');
  }
  const open = await tx.employeeDataChangeRequest.findFirst({ where: {
    talentCandidateId: id, ...(existing ? { id: { not: existing.id } } : {}),
    archivedAt: null, cancelledAt: null,
    onboardingStatus: { in: ['draft', 'submitted', 'pending_entry'] },
  }, select: { id: true } });
  if (open) throw new ConflictException({ message: '来源人才已有未完成的入职申请，请打开原申请', data: { applicationId: open.id } });
  return id;
}

type TalentApplicationSource = { id: string; talentCandidateId?: string | null; talentApplicationId?: string | null };

export async function resolveTalentApplicationSource(
  tx: Prisma.TransactionClient,
  candidateId: string | null,
  inputId?: string,
  existing?: TalentApplicationSource | null,
): Promise<string | null> {
  const savedId = existing?.talentApplicationId ?? null;
  if (existing && inputId !== undefined && inputId !== savedId) {
    throw new ConflictException('申请来源应聘不能更换，请保留原来源');
  }
  const id = savedId ?? inputId ?? null;
  if (!candidateId) {
    if (id) throw new ConflictException('应聘来源必须关联对应人才');
    return null;
  }
  // Old intakes remain usable; only new talent-origin intakes require an accepted application.
  if (!id) {
    if (existing?.talentCandidateId) return null;
    throw new ConflictException('请先在应聘记录中完成录用确认并记录接受录用，再办理入职');
  }
  await tx.$queryRaw`SELECT id FROM talent_applications WHERE id = ${id}::uuid FOR UPDATE`;
  const application = await tx.talentApplication.findUnique({ where: { id } });
  if (!application || application.candidateId !== candidateId) throw new ConflictException('应聘与来源人才不一致');
  if (application.stage !== 'accepted' && !(savedId && application.stage === 'onboarding')) {
    throw new ConflictException('该应聘尚未接受录用或已结束，不能办理入职');
  }
  return id;
}

export async function syncTalentApplicationOnboarding(
  tx: Prisma.TransactionClient,
  request: { id: string; talentApplicationId?: string | null },
  stage: 'accepted' | 'onboarding' | 'hired',
  actorId: string,
): Promise<void> {
  if (!request.talentApplicationId) return;
  await tx.$queryRaw`SELECT id FROM talent_applications WHERE id = ${request.talentApplicationId}::uuid FOR UPDATE`;
  const application = await tx.talentApplication.findUnique({ where: { id: request.talentApplicationId } });
  if (!application) throw new ConflictException('来源应聘不存在，请核对');
  if (application.stage === stage) return;
  const expected = stage === 'onboarding' ? 'accepted' : 'onboarding';
  if (application.stage !== expected) throw new ConflictException('来源应聘进度已变化，请刷新核对');
  const changed = await tx.talentApplication.updateMany({
    where: { id: application.id, stage: expected, revision: application.revision },
    data: { stage, revision: { increment: 1 }, updatedAt: new Date() },
  });
  if (changed.count !== 1) throw new ConflictException('来源应聘进度已变化，请刷新核对');
  await tx.talentApplicationEvent.create({ data: {
    applicationId: application.id, actorId,
    action: stage === 'onboarding' ? 'start_onboarding' : stage === 'hired' ? 'activate_onboarding' : 'cancel_onboarding',
    fromStage: expected, toStage: stage, version: application.revision + 1,
  } });
}
