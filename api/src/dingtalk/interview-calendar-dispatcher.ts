import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { CURRENT_WORKER_STATUSES } from '@/common/personnel/current-worker';
import { CalendarSyncError, InterviewCalendarEvent, InterviewCalendarService } from './interview-calendar.service';

interface ClaimedSync {
  id: string; interviewId: string; version: number; operation: string; claimToken: string;
  eventId: string | null; event: InterviewCalendarEvent;
}

@Injectable()
export class InterviewCalendarDispatcher {
  private readonly logger = new Logger(InterviewCalendarDispatcher.name);
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly calendar: InterviewCalendarService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async dispatch() {
    if (this.running || !this.calendar.isEnabled()) return;
    this.running = true;
    try {
      await this.expireClaims();
      const pending = await this.prisma.talentInterviewSync.findMany({
        where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true },
      });
      for (const item of pending) {
        const claim = await this.claim(item.id);
        if (!claim) continue;
        let eventId = claim.eventId;
        try {
          if (claim.operation === 'cancel') {
            if (eventId) await this.calendar.cancel(eventId, claim.event);
          } else if (eventId) await this.calendar.update(eventId, claim.event);
          else eventId = await this.calendar.create(claim.event);
        } catch (error) {
          await this.finish(claim, error instanceof CalendarSyncError ? error.state : 'uncertain', eventId);
          continue;
        }
        await this.finish(claim, 'synced', eventId);
      }
    } catch {
      // Provider exceptions may contain access tokens or invitation text.
      this.logger.warn('Interview calendar dispatch interrupted; durable claims will be reconciled');
    } finally { this.running = false; }
  }

  private async expireClaims() {
    const expired = await this.prisma.talentInterviewSync.findMany({ where: {
      status: 'processing', claimedAt: { lt: new Date(Date.now() - 120000) },
    }, select: { id: true, interviewId: true, claimToken: true, version: true } });
    for (const row of expired) await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM talent_interviews WHERE id = ${row.interviewId}::uuid FOR UPDATE`;
      const result = await tx.talentInterviewSync.updateMany({ where: { id: row.id, status: 'processing', claimToken: row.claimToken },
        data: { status: 'uncertain', errorCode: 'response_unconfirmed' } });
      if (result.count) await tx.talentInterview.updateMany({ where: { id: row.interviewId, version: row.version }, data: { syncStatus: 'uncertain' } });
    });
  }

  private async claim(id: string): Promise<ClaimedSync | null> {
    return this.prisma.$transaction(async tx => {
      const reference = await tx.talentInterviewSync.findUnique({ where: { id }, select: { interviewId: true } });
      if (!reference) return null;
      await tx.$queryRaw`SELECT id FROM talent_interviews WHERE id = ${reference.interviewId}::uuid FOR UPDATE`;
      const row = await tx.talentInterviewSync.findUnique({ where: { id }, include: { interview: true } });
      if (!row || row.status !== 'pending') return null;
      const interview = row.interview;
      if (row.version !== interview.version) {
        await tx.talentInterviewSync.update({ where: { id }, data: { status: 'superseded' } });
        return null;
      }
      if (await tx.talentInterviewSync.findFirst({ where: { interviewId: interview.id, status: { in: ['processing', 'uncertain'] } } })) return null;

      // No remote event exists to cancel or complete. Never create a past invitation here.
      if (interview.status !== 'scheduled' && !interview.calendarEventId) {
        await tx.talentInterviewSync.update({ where: { id }, data: { status: 'synced', completedAt: new Date() } });
        await tx.talentInterview.update({ where: { id: interview.id }, data: { syncStatus: 'synced', calendarSyncedVersion: row.version } });
        return null;
      }
      const needsParticipants = row.operation !== 'cancel';
      const ids = [...new Set([interview.createdById, ...(needsParticipants ? row.participantIds : [])])];
      const bindings = await tx.externalIdentityBinding.findMany({ where: {
        userId: { in: ids }, provider: 'dingtalk', status: 'enabled', endedAt: null,
        user: { deletedAt: null, archivedAt: null, status: { in: CURRENT_WORKER_STATUSES } },
      }, select: { userId: true, externalUnionId: true } });
      const identity = (userId: string) => {
        const matches = bindings.filter(binding => binding.userId === userId);
        return matches.length === 1 ? matches[0].externalUnionId : null;
      };
      const organizerUnionId = interview.calendarOrganizerUnionId || identity(interview.createdById);
      const participantUnionIds = needsParticipants ? row.participantIds.map(identity) : [];
      if (!organizerUnionId || participantUnionIds.some(value => !value)) {
        await tx.talentInterviewSync.update({ where: { id }, data: { status: 'failed', errorCode: 'identity_not_bound' } });
        await tx.talentInterview.update({ where: { id: interview.id }, data: { syncStatus: 'failed' } });
        return null;
      }
      const claimToken = randomUUID();
      await tx.talentInterviewSync.update({ where: { id }, data: {
        status: 'processing', claimToken, claimedAt: new Date(), attempts: { increment: 1 }, errorCode: null,
        calendarOrganizerUnionId: organizerUnionId, calendarEventId: interview.calendarEventId, externalCalendarId: 'primary',
      } });
      await tx.talentInterview.update({ where: { id: interview.id }, data: {
        syncStatus: 'processing', calendarOrganizerUnionId: organizerUnionId, externalCalendarId: 'primary',
      } });
      return { id, interviewId: interview.id, version: row.version, operation: row.operation, claimToken,
        eventId: interview.calendarEventId,
        event: { invitationId: interview.id, version: row.version, organizerUnionId,
          participantUnionIds: participantUnionIds as string[], summary: `面试：${interview.candidateNameSnapshot}`,
          description: [interview.invitationText, interview.meetingUrl].filter(Boolean).join('\n'),
          startsAt: interview.startsAt, endsAt: interview.endsAt },
      };
    });
  }

  private async finish(claim: ClaimedSync, status: string, eventId: string | null) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM talent_interviews WHERE id = ${claim.interviewId}::uuid FOR UPDATE`;
      const changed = await tx.talentInterviewSync.updateMany({ where: {
        id: claim.id, claimToken: claim.claimToken, status: { in: ['processing', 'uncertain'] },
      }, data: { status, calendarEventId: eventId, completedAt: status === 'synced' ? new Date() : null,
        errorCode: status === 'synced' ? null : status === 'uncertain' ? 'response_unconfirmed' : 'calendar_rejected',
        claimToken: status === 'uncertain' ? claim.claimToken : null,
      } });
      if (!changed.count) return;
      // Retain a late successful create id even if a later version is waiting.
      if (eventId) await tx.talentInterview.update({ where: { id: claim.interviewId }, data: { calendarEventId: eventId } });
      await tx.talentInterview.updateMany({ where: { id: claim.interviewId, version: claim.version }, data: {
        syncStatus: status, ...(status === 'synced' ? { calendarSyncedVersion: claim.version } : {}),
      } });
    });
  }
}
