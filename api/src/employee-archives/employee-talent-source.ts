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
  const existingId = existing?.talentCandidateId;
  if (existingId && inputId !== undefined && inputId !== existingId) {
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
