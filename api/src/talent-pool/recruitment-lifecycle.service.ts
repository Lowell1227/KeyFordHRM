import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RecruitmentDemand } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import type { ChangeRecruitmentLifecycleDto } from './recruitment-lifecycle.dto';
import { RECRUITMENT_TRACKING_STATES, type RecruitmentLifecycleSummary, type RecruitmentLifecycleView, type RecruitmentTrackingState } from './recruitment-lifecycle.types';
import { assertRecruitmentReader, canEditRecruitment, type RecruitmentActor } from './talent-recruitment-policy';
import { lockRecruitmentSources, recruitmentSourceTx } from './recruitment-postings.service';
import { attachRecruitmentDemandSeats } from './recruitment-demand-seats';
import { currentRecruitmentDemandSql, recruitmentSeatJoin } from './recruitment-progress-sql';
import { RecruitmentDemandsService } from './recruitment-demands.service';

@Injectable()
export class RecruitmentLifecycleService {
  constructor(private readonly prisma: PrismaService, private readonly demands: RecruitmentDemandsService) {}

  private async get(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.recruitmentDemand.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('招聘需求不存在');
    return row;
  }

  private async summary(tx: Prisma.TransactionClient, row: RecruitmentDemand, actor: RecruitmentActor): Promise<RecruitmentLifecycleSummary> {
    const current = await this.demands.currentIntent(tx, row.id, actor);
    const [seats] = await attachRecruitmentDemandSeats(tx, [{ id: row.id, approvedHeadcount: row.approvedHeadcount,
      usable: current?.usable ?? false }]);
    const [pending] = await tx.$queryRaw<Array<{ inProgressCount: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "inProgressCount" FROM talent_applications a ${recruitmentSeatJoin}
      WHERE (${currentRecruitmentDemandSql}) = ${row.id}::uuid AND a.stage <> 'hired'
        AND (a.stage IN ('screening', 'interviewing', 'reserve', 'hiring_review', 'offered', 'accepted', 'onboarding') OR seat.action = 'accept_offer')`);
    return { approvedHeadcount: row.approvedHeadcount, occupiedCount: seats.occupiedCount, acceptedCount: seats.acceptedCount,
      hiredCount: seats.hiredCount, remainingCount: seats.remainingCount, overCount: seats.overCount, inProgressCount: Number(pending.inProgressCount) };
  }

  private async view(tx: Prisma.TransactionClient, row: RecruitmentDemand, actor: RecruitmentActor, summary: RecruitmentLifecycleSummary): Promise<RecruitmentLifecycleView> {
    const canEdit = canEditRecruitment(actor);
    const postings = canEdit ? await tx.recruitmentPosting.findMany({ where: { demandId: row.id },
      select: { id: true, channel: true, name: true, url: true, active: true, ownerId: true }, orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }] }) : [];
    const events = await tx.recruitmentDemandEvent.findMany({ where: { demandId: row.id, action: 'tracking_change' }, orderBy: { revision: 'asc' } });
    const actorIds = [...new Set([row.trackingChangedById, ...postings.map(p => p.ownerId), ...events.map(e => e.actorId)].filter((id): id is string => !!id))];
    const names = new Map((actorIds.length ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : []).map(person => [person.id, person.name]));
    return { id: row.id, revision: row.revision, trackingState: row.trackingState as RecruitmentTrackingState,
      trackingChangedAt: row.trackingChangedAt?.toISOString() ?? null, trackingChangedByName: row.trackingChangedById ? names.get(row.trackingChangedById) ?? null : null,
      trackingReason: row.trackingReason, canEdit, summary,
      externalPostings: postings.map(({ ownerId, ...posting }) => ({ ...posting, ownerName: names.get(ownerId) ?? null })),
      events: events.map(event => {
        const snapshot = event.snapshot as Record<string, unknown> | null;
        return { id: event.id, action: event.action, revision: event.revision, createdAt: event.createdAt.toISOString(), actorName: names.get(event.actorId) ?? null,
          reason: event.reason, previousTrackingState: typeof snapshot?.previousTrackingState === 'string' ? snapshot.previousTrackingState : null,
          trackingState: typeof snapshot?.trackingState === 'string' ? snapshot.trackingState : null };
      }) };
  }

  async detail(id: string, user: AuthUser): Promise<RecruitmentLifecycleView> {
    return this.prisma.$transaction(async tx => {
      const actor = await assertRecruitmentReader(tx, user);
      const row = await this.get(tx, id);
      return this.view(tx, row, actor, await this.summary(tx, row, actor));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
  }

  async change(id: string, input: ChangeRecruitmentLifecycleDto, user: AuthUser): Promise<RecruitmentLifecycleView> {
    return this.prisma.$transaction(async tx => {
      const actor = await lockRecruitmentSources(tx, user);
      const old = await this.get(tx, id);
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision > 2147483646 || !RECRUITMENT_TRACKING_STATES.includes(input.trackingState)
        || !reason || reason.length > 2000) throw new BadRequestException('请选择招聘进度并填写变更原因');
      if (old.revision !== input.expectedRevision) throw new ConflictException('招聘需求已更新，请刷新核对后再登记进度，原输入请保留');
      if (old.trackingState === input.trackingState) throw new BadRequestException('招聘进度未变化，无需重复登记');
      const summary = await this.summary(tx, old, actor);
      const row = await tx.recruitmentDemand.update({ where: { id }, data: { trackingState: input.trackingState, trackingChangedAt: new Date(),
        trackingChangedById: actor.id, trackingReason: reason, revision: old.revision + 1 } });
      const snapshot = { previousTrackingState: old.trackingState, trackingState: row.trackingState, ...summary };
      await tx.recruitmentDemandEvent.create({ data: { demandId: id, revision: row.revision, actorId: actor.id, action: 'tracking_change', reason, snapshot } });
      await tx.auditLog.create({ data: { userId: actor.id, action: 'recruitment_tracking_change', entityType: 'recruitment_demand', entityId: id,
        oldValue: { revision: old.revision, trackingState: old.trackingState }, newValue: { revision: row.revision, ...snapshot } } });
      return this.view(tx, row, actor, summary);
    }, recruitmentSourceTx);
  }
}
