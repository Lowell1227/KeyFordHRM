import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { CURRENT_WORKER_STATUSES } from '@/common/personnel/current-worker';
import type { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/notifications/notifications.service';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTalentInterviewDto, InterviewVersionDto, TalentInterviewQueryDto, UpdateTalentInterviewDto } from './dto/talent-interview.dto';

const include = { participants: { orderBy: { userId: 'asc' as const } }, candidate: { select: { deletedAt: true } } } satisfies Prisma.TalentInterviewInclude;
type Interview = Prisma.TalentInterviewGetPayload<{ include: typeof include }>;

export function safeTencentMeetingUrl(input?: string | null): string | null {
  if (!input?.trim()) return null;
  const value = input.trim();
  let url: URL;
  try { url = new URL(value); } catch { throw new BadRequestException('请填写有效的腾讯会议 HTTPS 链接'); }
  if (/[\s\\\u0000-\u001f\u007f]/.test(value) || url.protocol !== 'https:' || url.hostname !== 'meeting.tencent.com'
    || url.username || url.password || (url.port && url.port !== '443')) {
    throw new BadRequestException('仅支持 meeting.tencent.com 的 HTTPS 会议链接');
  }
  return url.href;
}

@Injectable()
export class TalentInterviewsService {
  private readonly logger = new Logger(TalentInterviewsService.name);
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  private canReadTalent(user: AuthUser) {
    return hasHrCapability(user, 'employee_archive_edit') || hasHrCapability(user, 'employee_archive_review');
  }

  private assertWrite(user: AuthUser) {
    if (!hasHrCapability(user, 'employee_archive_edit')) throw new ForbiddenException('无权限维护面试邀约');
  }

  async list(query: TalentInterviewQueryDto, user: AuthUser) {
    if (query.scope === 'created') this.assertWrite(user);
    if (query.candidateId && !this.canReadTalent(user)) throw new ForbiddenException('无权限查看候选人面试列表');
    const where: Prisma.TalentInterviewWhereInput = query.scope === 'created'
      ? { createdById: user.id, ...(query.candidateId ? { candidateId: query.candidateId } : {}) }
      : query.candidateId && query.scope !== 'mine'
      ? { candidateId: query.candidateId }
      : { participants: { some: { userId: user.id } } };
    const rows = await this.prisma.talentInterview.findMany({ where, include, orderBy: [{ startsAt: 'desc' }, { id: 'asc' }] });
    return rows.map((row) => this.view(row, user));
  }

  async detail(id: string, user: AuthUser) {
    const row = await this.prisma.talentInterview.findUnique({ where: { id }, include });
    if (!row || (!this.canReadTalent(user) && !row.participants.some((p) => p.userId === user.id))) {
      throw new NotFoundException('面试邀约不存在或无权查看');
    }
    return this.view(row, user);
  }

  private view(row: Interview, user: AuthUser) {
    const minimal = {
      id: row.id, candidateNameSnapshot: row.candidateNameSnapshot, startsAt: row.startsAt, endsAt: row.endsAt,
      invitationText: row.invitationText, meetingUrl: row.meetingUrl, note: row.note, status: row.status, version: row.version,
      sourceDeleted: row.candidate.deletedAt !== null,
      participantNames: row.participants.map((p) => p.userNameSnapshot),
    };
    if (!this.canReadTalent(user)) return minimal;
    return { ...minimal, candidateId: row.candidateId,
      participants: row.participants.map(({ userId, userNameSnapshot }) => ({ userId, userNameSnapshot })),
      syncStatus: row.syncStatus, calendarSyncedVersion: row.calendarSyncedVersion };
  }

  private validate(input: Pick<CreateTalentInterviewDto, 'startsAt' | 'endsAt' | 'invitationText' | 'meetingUrl' | 'note'>) {
    if (![input.startsAt, input.endsAt].every((value) => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))) {
      throw new BadRequestException('面试时间必须包含明确时区');
    }
    const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }
    if (!input.invitationText?.trim() || input.invitationText.length > 10000) throw new BadRequestException('请填写面试邀请内容（最多10000字）');
    if (input.note && input.note.length > 2000) throw new BadRequestException('备注最多2000字');
    if (input.meetingUrl && input.meetingUrl.length > 1000) throw new BadRequestException('会议链接过长');
    return { startsAt, endsAt, invitationText: input.invitationText.trim(), meetingUrl: safeTencentMeetingUrl(input.meetingUrl), note: input.note?.trim() || null };
  }

  private async participants(tx: Prisma.TransactionClient, ids: string[]) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || new Set(ids).size !== ids.length) {
      throw new BadRequestException('请选择1至50名不重复的内部参与人');
    }
    const users = await tx.user.findMany({ where: { id: { in: ids }, status: { in: CURRENT_WORKER_STATUSES }, deletedAt: null, archivedAt: null }, select: { id: true, name: true } });
    if (users.length !== ids.length) throw new BadRequestException('部分参与人不在职或不可用，请重新选择');
    return users.map((user) => ({ userId: user.id, userNameSnapshot: user.name }));
  }

  private syncStatus() {
    return process.env.NODE_ENV !== 'test' && process.env.DINGTALK_INTERVIEW_CALENDAR_ENABLED === 'true' ? 'pending' : 'unconfigured';
  }

  private async lockCandidate(tx: Prisma.TransactionClient, candidateId: string) {
    await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${candidateId}::uuid FOR UPDATE`;
  }

  async create(input: CreateTalentInterviewDto, user: AuthUser) {
    this.assertWrite(user);
    const data = this.validate(input);
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockCandidate(tx, input.candidateId);
      if (input.requestId) {
        const existing = await tx.talentInterview.findUnique({ where: { id: input.requestId }, include });
        if (existing) {
          if (existing.createdById !== user.id || existing.candidateId !== input.candidateId
            || existing.startsAt.getTime() !== data.startsAt.getTime() || existing.endsAt.getTime() !== data.endsAt.getTime()
            || existing.invitationText !== data.invitationText || existing.meetingUrl !== data.meetingUrl || existing.note !== data.note
            || JSON.stringify(existing.participants.map((p) => p.userId).sort()) !== JSON.stringify([...input.participantIds].sort())) {
            throw new ConflictException('新建请求已使用，请刷新邀约列表后重试');
          }
          return existing;
        }
      }
      const candidate = await tx.talentCandidate.findUnique({ where: { id: input.candidateId } });
      if (!candidate || candidate.deletedAt) throw new NotFoundException('候选人不存在或已删除');
      const participants = await this.participants(tx, input.participantIds);
      const created = await tx.talentInterview.create({ data: { ...data, ...(input.requestId ? { id: input.requestId } : {}), candidateId: candidate.id, candidateNameSnapshot: candidate.name,
        createdById: user.id, syncStatus: this.syncStatus(), participants: { create: participants } }, include });
      await this.intent(tx, created, user, 'create');
      return created;
    });
    await this.notify(row, user);
    return this.view(row, user);
  }

  update(id: string, input: UpdateTalentInterviewDto, user: AuthUser) { return this.mutate(id, input, user, 'update'); }
  cancel(id: string, input: InterviewVersionDto, user: AuthUser) { return this.mutate(id, input, user, 'cancel'); }
  complete(id: string, input: InterviewVersionDto, user: AuthUser) { return this.mutate(id, input, user, 'complete'); }
  retrySync(id: string, input: InterviewVersionDto, user: AuthUser) { return this.mutate(id, input, user, 'retry'); }

  private async mutate(id: string, input: UpdateTalentInterviewDto, user: AuthUser, action: 'update' | 'cancel' | 'complete' | 'retry') {
    this.assertWrite(user);
    const row = await this.prisma.$transaction(async (tx) => {
      const reference = await tx.talentInterview.findUnique({ where: { id }, select: { candidateId: true } });
      if (!reference) throw new NotFoundException('面试邀约不存在');
      await this.lockCandidate(tx, reference.candidateId);
      // Same lock order as deletion: candidate first, then invitation.
      await tx.$queryRaw`SELECT id FROM talent_interviews WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.talentInterview.findUnique({ where: { id }, include });
      if (!before) throw new NotFoundException('面试邀约不存在');
      if (before.version !== input.version) throw new ConflictException('邀约已更新，请刷新后重试');
      if (action !== 'retry' && before.status !== 'scheduled') throw new BadRequestException('已结束的面试不能再修改');
      const unresolved = await tx.talentInterviewSync.findFirst({ where: { interviewId: id, status: { in: ['processing', 'uncertain'] } } });
      if (unresolved || ['processing', 'uncertain'].includes(before.syncStatus)) {
        throw new ConflictException('日程同步结果待核对，暂不能修改或重复发送');
      }
      if (action === 'retry') {
        if (before.syncStatus === 'synced') throw new BadRequestException('日程已同步，无需重试');
      }
      const fields = action === 'update' ? this.validate({
        startsAt: input.startsAt ?? before.startsAt.toISOString(), endsAt: input.endsAt ?? before.endsAt.toISOString(),
        invitationText: input.invitationText ?? before.invitationText,
        meetingUrl: input.meetingUrl !== undefined ? input.meetingUrl : before.meetingUrl,
        note: input.note !== undefined ? input.note : before.note,
      }) : {};
      if (action === 'update' && (input.startsAt === null || input.endsAt === null || input.invitationText === null || input.participantIds === null)) {
        throw new BadRequestException('时间、参与人和邀请内容不能为空');
      }
      const participants = action === 'update' && input.participantIds !== undefined
        ? await this.participants(tx, input.participantIds) : before.participants;
      const status = action === 'cancel' ? 'cancelled' : action === 'complete' ? 'completed' : before.status;
      const changed = await tx.talentInterview.updateMany({ where: { id, version: input.version }, data: {
        ...fields, status, version: before.version + 1, syncStatus: this.syncStatus(), updatedById: user.id,
      } });
      if (changed.count !== 1) throw new ConflictException('邀约已更新，请刷新后重试');
      if (action === 'update' && input.participantIds !== undefined) {
        await tx.talentInterviewParticipant.deleteMany({ where: { interviewId: id } });
        await tx.talentInterviewParticipant.createMany({ data: participants.map(({ userId, userNameSnapshot }) => ({ interviewId: id, userId, userNameSnapshot })) });
      }
      const updated = { ...before, ...fields, participants, status, version: before.version + 1, syncStatus: this.syncStatus() } as Interview;
      await this.intent(tx, updated, user, action, before);
      return updated;
    });
    if (action !== 'retry') await this.notify(row, user);
    return this.view(row, user);
  }

  private async intent(tx: Prisma.TransactionClient, row: Interview, user: AuthUser, action: string, before?: Interview) {
    await tx.talentInterviewSync.updateMany({ where: { interviewId: row.id, status: { in: ['pending', 'failed', 'unconfigured'] } }, data: { status: 'superseded' } });
    await tx.talentInterviewSync.create({ data: { interviewId: row.id, version: row.version, operation: row.status === 'cancelled' ? 'cancel' : 'upsert',
      status: this.syncStatus(), participantIds: row.participants.map((p) => p.userId),
      calendarEventId: row.calendarEventId, externalCalendarId: row.externalCalendarId, calendarOrganizerUnionId: row.calendarOrganizerUnionId } });
    await tx.auditLog.create({ data: { userId: user.id, action: `${action}_talent_interview`, entityType: 'talent_interview', entityId: row.id,
      oldValue: before ? { version: before.version, status: before.status, startsAt: before.startsAt.toISOString(), endsAt: before.endsAt.toISOString(), participantIds: before.participants.map((p) => p.userId) } : undefined,
      newValue: { version: row.version, status: row.status, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), participantIds: row.participants.map((p) => p.userId) } } });
  }

  private async notify(row: Interview, user: AuthUser) {
    for (const participant of row.participants) {
      try {
        // A preceding delivery may have awaited while HR changed this invitation.
        const current = await this.prisma.talentInterview.findFirst({
          where: { id: row.id, version: row.version, participants: { some: { userId: participant.userId } } },
          select: { id: true },
        });
        if (!current) continue;
        await this.notifications.create({ userId: participant.userId, senderId: user.id, type: 'talent_interview',
          dedupeKey: `talent_interview:${row.id}:${row.version}:${participant.userId}`,
          title: row.status === 'cancelled' ? '面试邀约已取消' : row.status === 'completed' ? '面试已完成' : '面试邀约已更新',
          content: '请查看面试邀约的最新安排。', extraData: { invitationId: row.id, version: row.version } });
      } catch {
        this.logger.warn(`Interview notification creation failed: ${row.id}`);
      }
    }
  }
}
