import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { shanghaiBusinessDate } from '@/employee-archives/employment-timeline';

type TransferChoice = { followUpPlanAction?: 'keep' | 'replace'; expectedFollowUpPlanId?: string | null };
type IntakePromise = { id: string; nextFollowUpAt: Date | null; associatedToId?: string | null };
type SourceChoice = { followUpSourceIntakeId?: string; expectedFollowUpSourceAt?: string };

export function intakeFollowUpSources(primary: IntakePromise, related: IntakePromise[]) {
  return [primary, ...related.filter(source => source.associatedToId === primary.id)].filter(source => source.nextFollowUpAt)
    .map(source => ({ intakeId: source.id, nextFollowUpAt: source.nextFollowUpAt!.toISOString(), primary: source.id === primary.id }));
}

export function selectIntakeFollowUpSource(primary: IntakePromise, related: IntakePromise[], choice: SourceChoice): IntakePromise | null {
  const sources = [primary, ...related.filter(source => source.associatedToId === primary.id)].filter(source => source.nextFollowUpAt);
  const selected = choice.followUpSourceIntakeId ? sources.find(source => source.id === choice.followUpSourceIntakeId!.toLowerCase())
    : primary.nextFollowUpAt ? primary : sources.length === 1 ? sources[0] : null;
  const changed = !!choice.followUpSourceIntakeId && !selected || !!choice.expectedFollowUpSourceAt
    && (!selected || Date.parse(choice.expectedFollowUpSourceAt) !== selected.nextFollowUpAt!.getTime());
  if (changed || !selected && sources.length > 1) throw new ConflictException({
    message: changed ? '收件跟进来源已变化，请重新核对要承接的安排' : '关联收件有多个跟进安排，请选择本次要承接的来源',
    data: { reason: changed ? 'INTAKE_FOLLOW_UP_SOURCE_CHANGED' : 'INTAKE_FOLLOW_UP_SOURCE_REQUIRED', followUpSources: intakeFollowUpSources(primary, related) },
  });
  return selected ?? null;
}

/** An intake promise is a plan, never evidence that a conversation has occurred. */
export async function transferIntakeFollowUpPlan(tx: Prisma.TransactionClient,
  source: { id: string; nextFollowUpAt: Date | null }, candidateId: string, choice: TransferChoice, actorId: string) {
  if (!source.nextFollowUpAt) {
    if (choice.followUpPlanAction === 'replace') throw new BadRequestException('本次收件没有需要承接的跟进安排');
    return;
  }
  const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM talent_candidates WHERE id = ${candidateId}::uuid AND deleted_at IS NULL FOR UPDATE`;
  if (!active.length) throw new NotFoundException('目标人才不存在或已删除');
  if (await tx.talentFollowUp.findUnique({ where: { sourceIntakeId: source.id } })) return;
  const current = await tx.talentFollowUp.findFirst({ where: { candidateId, planStatus: 'pending' },
    select: { id: true, nextFollowUpAt: true, sourceFollowUpAt: true } });
  const replace = choice.followUpPlanAction === 'replace';
  if (replace && (choice.expectedFollowUpPlanId === undefined || choice.expectedFollowUpPlanId?.toLowerCase() !== current?.id)) {
    // Null explicitly means that the operator observed no pending plan.
    if (!(choice.expectedFollowUpPlanId === null && current === null)) throw new ConflictException({
      message: '人才跟进安排已变化，请核对当前安排后再入库', data: { reason: 'TALENT_FOLLOW_UP_PLAN_CHANGED',
        currentPlan: current ? { id: current.id, nextFollowUpAt: current.nextFollowUpAt?.toISOString().slice(0, 10) ?? null,
          sourceFollowUpAt: current.sourceFollowUpAt?.toISOString() ?? null } : null,
        intakeFollowUpAt: source.nextFollowUpAt.toISOString() },
    });
  }
  const now = new Date();
  if (replace && current) {
    await tx.talentFollowUp.update({ where: { id: current.id }, data: { planStatus: 'superseded', planClosedAt: now, planClosedById: actorId } });
    await tx.auditLog.create({ data: { userId: actorId, action: 'replace_talent_follow_up_plan', entityType: 'talent_follow_up', entityId: current.id,
      oldValue: { planStatus: 'pending' }, newValue: { candidateId, planStatus: 'superseded', sourceIntakeId: source.id } } });
  }
  const planStatus = current && !replace ? 'superseded' : 'pending';
  const plan = await tx.talentFollowUp.create({ data: { candidateId, recordType: 'plan', sourceIntakeId: source.id,
    sourceFollowUpAt: source.nextFollowUpAt, occurredAt: shanghaiBusinessDate(now), channel: 'other',
    summary: planStatus === 'pending' ? '从简历收件带入的跟进安排' : '本次收件安排未采用，保留人才库原安排',
    nextFollowUpAt: shanghaiBusinessDate(source.nextFollowUpAt), planStatus, createdById: actorId,
    ...(planStatus === 'superseded' ? { planClosedAt: now, planClosedById: actorId } : {}) } });
  await tx.auditLog.create({ data: { userId: actorId, action: 'transfer_intake_follow_up_plan', entityType: 'talent_follow_up', entityId: plan.id,
    newValue: { candidateId, sourceIntakeId: source.id, recordType: 'plan', planStatus, choice: replace ? 'replace' : 'keep' } } });
}
