import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TalentInterview, TalentInterviewSync } from '@prisma/client';
import { hasHrCapability } from '@/auth/hr-capabilities';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { CalendarEventLocator, CalendarLookupResult, InterviewCalendarService } from './interview-calendar.service';

type Snapshot = { interview: TalentInterview; intents: TalentInterviewSync[] };
type UnresolvedReason = Extract<CalendarLookupResult, { kind: 'unresolved' }>['reason'];
export type CalendarReconciliationResult = { status: 'pending'; version: number }
  | { status: 'unconfigured'; version: number; reason: 'calendar_disabled' }
  | { status: 'uncertain'; version: number; reason: UnresolvedReason | 'context_mismatch' };

@Injectable()
export class InterviewCalendarReconciliationService {
  constructor(private readonly prisma: PrismaService, private readonly calendar: InterviewCalendarService) {}

  async reconcile(id: string, version: number, user: AuthUser): Promise<CalendarReconciliationResult> {
    if (!hasHrCapability(user, 'employee_archive_edit')) throw new ForbiddenException('无权限核对面试日程');
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException('请提供有效的邀约版本');
    if (!this.calendar.isEnabled()) return { status: 'unconfigured', version, reason: 'calendar_disabled' };

    const snapshot = await this.prisma.$transaction(tx => this.readLocked(tx, id, version));
    const locator = this.locator(snapshot);
    if (!locator) return { status: 'uncertain', version, reason: 'context_mismatch' };

    let found: CalendarLookupResult;
    // Keep remote I/O outside the transaction. The second lock fences intervening completions.
    try { found = await this.calendar.locate(locator); }
    catch { return { status: 'uncertain', version, reason: 'read_failed' }; }
    if (found.kind === 'unresolved') return { status: 'uncertain', version, reason: found.reason };
    const eventId = found.eventId;
    if (!eventId?.trim() || (locator.eventId && eventId !== locator.eventId)) {
      return { status: 'uncertain', version, reason: 'event_unavailable' };
    }
    if (!this.calendar.isEnabled()) return { status: 'unconfigured', version, reason: 'calendar_disabled' };

    await this.prisma.$transaction(async tx => {
      const current = await this.readLocked(tx, id, version);
      const latestLocator = this.locator(current);
      const original = snapshot.intents[0], latest = current.intents[0];
      if (!latestLocator || JSON.stringify(latestLocator) !== JSON.stringify(locator)
        || latest.id !== original.id || latest.claimToken !== original.claimToken
        || latest.updatedAt.getTime() !== original.updatedAt.getTime()
        || latest.claimedAt?.getTime() !== original.claimedAt?.getTime()) {
        throw new ConflictException('日程状态已变化，请刷新后重新核对');
      }
      const changed = await tx.talentInterviewSync.updateMany({ where: {
        id: original.id, version, status: 'uncertain', claimToken: original.claimToken,
        claimedAt: original.claimedAt, updatedAt: original.updatedAt,
      }, data: {
        status: 'pending', calendarEventId: eventId, claimToken: null, claimedAt: null,
        completedAt: null, nextAttemptAt: null, errorCode: null,
      } });
      if (changed.count !== 1) throw new ConflictException('日程状态已变化，请刷新后重新核对');
      await tx.talentInterview.update({ where: { id }, data: { calendarEventId: eventId, syncStatus: 'pending' } });
      await tx.auditLog.create({ data: {
        userId: user.id, action: 'reconcile_talent_interview_calendar', entityType: 'talent_interview', entityId: id,
        oldValue: { version, syncStatus: 'uncertain', operation: original.operation },
        newValue: { version, syncStatus: 'pending', operation: original.operation,
          matchedBy: locator.eventId ? 'stored_event_id' : 'business_marker' },
      } });
    });
    return { status: 'pending', version };
  }

  private async readLocked(tx: Prisma.TransactionClient, id: string, version: number): Promise<Snapshot> {
    await tx.$queryRaw`SELECT id FROM talent_interviews WHERE id = ${id}::uuid FOR UPDATE`;
    const interview = await tx.talentInterview.findUnique({ where: { id } });
    if (!interview) throw new NotFoundException('面试邀约不存在');
    if (interview.version !== version) throw new ConflictException('邀约已更新，请刷新后重试');
    const intents = await tx.talentInterviewSync.findMany({ where: { interviewId: id, status: { in: ['processing', 'uncertain'] } } });
    if (interview.syncStatus !== 'uncertain' || intents.some(intent => intent.status === 'processing')) {
      throw new ConflictException('当前日程不处于待核对状态，请刷新后重试');
    }
    return { interview, intents };
  }

  private locator({ interview, intents }: Snapshot): CalendarEventLocator | null {
    if (intents.length !== 1) return null;
    const intent = intents[0];
    const operation = interview.status === 'cancelled' ? 'cancel' : 'upsert';
    if (intent.version !== interview.version || intent.operation !== operation
      || !interview.calendarOrganizerUnionId || intent.calendarOrganizerUnionId !== interview.calendarOrganizerUnionId
      || interview.externalCalendarId !== 'primary' || intent.externalCalendarId !== 'primary'
      || intent.calendarEventId !== interview.calendarEventId) return null;
    return { invitationId: interview.id, organizerUnionId: interview.calendarOrganizerUnionId,
      eventId: interview.calendarEventId, operation };
  }
}
