import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { shanghaiBusinessDate } from '@/employee-archives/employment-timeline';
import { CreateFollowUpDto, parseTalentDate } from './dto/create-follow-up.dto';
import { TalentsService } from './talents.service';
import { assertRecruitmentEditor } from './talent-recruitment-policy';

@Injectable()
export class TalentFollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly talents: TalentsService,
  ) {}

  private async lockedCurrentPlan(tx: Prisma.TransactionClient, candidateId: string) {
    const active = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM talent_candidates WHERE id = ${candidateId}::uuid AND deleted_at IS NULL FOR UPDATE
    `;
    if (!active.length) throw new NotFoundException('候选人不存在或已删除');
    return tx.talentFollowUp.findFirst({ where: { candidateId, planStatus: 'pending' }, select: { id: true, occurredAt: true } });
  }

  private planConflict() {
    return new ConflictException('跟进安排已变化，请刷新查看当前安排后再操作');
  }

  private async closePlan(tx: Prisma.TransactionClient, id: string, status: 'completed' | 'cancelled' | 'superseded', operator: AuthUser) {
    const row = await tx.talentFollowUp.update({ where: { id },
      data: { planStatus: status, planClosedAt: new Date(), planClosedById: operator.id } });
    const action = { completed: 'complete', cancelled: 'cancel', superseded: 'replace' }[status];
    await tx.auditLog.create({ data: { entityType: 'talent_follow_up', entityId: id, userId: operator.id,
      action: action + '_talent_follow_up_plan', oldValue: { planStatus: 'pending' }, newValue: { candidateId: row.candidateId, planStatus: status } } });
    return row;
  }

  async create(candidateId: string, input: CreateFollowUpDto, operator: AuthUser) {
    const occurredAt = parseTalentDate(input.occurredAt) ?? shanghaiBusinessDate();
    const nextFollowUpAt = parseTalentDate(input.nextFollowUpAt, '下次跟进日期');
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockedCurrentPlan(tx, candidateId);
      await assertRecruitmentEditor(tx, operator);
      if (input.expectedPlanId !== undefined && input.expectedPlanId?.toLowerCase() !== current?.id) throw this.planConflict();
      if (input.completePlanId !== undefined && input.completePlanId.toLowerCase() !== current?.id) throw this.planConflict();
      const historical = !!current && occurredAt < current.occurredAt;
      if (input.completePlanId && historical) throw new BadRequestException('完成安排的沟通日期不能早于该安排的沟通日期；可改为补充记录');
      if (current && input.completePlanId) await this.closePlan(tx, current.id, 'completed', operator);
      else if (current && nextFollowUpAt && !historical) {
        if (input.expectedPlanId === undefined) throw new ConflictException('已有当前跟进安排，请刷新页面并核对后再保存');
        await this.closePlan(tx, current.id, 'superseded', operator);
      }
      const planStatus = !nextFollowUpAt ? 'none' : historical ? 'superseded' : 'pending';
      const followUp = await tx.talentFollowUp.create({
        data: {
          candidateId,
          occurredAt,
          channel: input.channel,
          summary: input.summary,
          nextFollowUpAt,
          planStatus,
          ...(planStatus === 'superseded' ? { planClosedAt: new Date(), planClosedById: operator.id } : {}),
          createdById: operator.id,
        },
      });
      if (planStatus !== 'none') {
        await tx.auditLog.create({ data: { entityType: 'talent_follow_up', entityId: followUp.id, userId: operator.id,
          action: 'record_talent_follow_up_plan', newValue: { candidateId, planStatus } } });
      }
      await tx.talentCandidate.updateMany({
        where: { id: candidateId, deletedAt: null, OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lt: occurredAt } }] },
        data: { lastFollowUpAt: occurredAt, updatedById: operator.id },
      });
      return followUp;
    });
  }

  async cancel(candidateId: string, followUpId: string, operator: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const current = await this.lockedCurrentPlan(tx, candidateId);
      await assertRecruitmentEditor(tx, operator);
      if (current?.id !== followUpId.toLowerCase()) throw this.planConflict();
      return this.closePlan(tx, current.id, 'cancelled', operator);
    });
  }

  /** 跟进列表（倒序，附记录人姓名用于时间线展示）。 */
  async list(candidateId: string) {
    await this.talents.findActive(candidateId);
    const rows = await this.prisma.talentFollowUp.findMany({
      where: { candidateId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const creatorIds = [...new Set(rows.map((row) => row.createdById))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(creators.map((user) => [user.id, user.name]));
    return rows.map((row) => ({ ...row, createdByName: nameById.get(row.createdById) ?? null }));
  }

}
