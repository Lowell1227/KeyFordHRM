import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTalentApplicationDto, ReturnTalentInterviewFeedbackDto, SaveTalentInterviewFeedbackDto, TalentApplicationActionDto, TalentOwnerQueryDto, TalentApplicationQueueQueryDto, UpdateTalentApplicationDto } from './dto/talent-recruitment.dto';
import { allowedApplicationActions, canConfirmTalentHiring, canEditRecruitment, canReadRecruitment, canReadTalentApplication, canWriteRecruitment, hasTalentHiringConfirm, isCurrentRecruitmentActor, isFeedbackOpen, talentOwnerWhere, TALENT_RESERVE_REASONS, type RecruitmentActor, type TalentReserveReason } from './talent-recruitment-policy';

const actorSelect = { id: true, name: true, sysRole: true, hrCapabilities: true, status: true, deletedAt: true, archivedAt: true, isAssessorOnly: true } satisfies Prisma.UserSelect;
const applicationInclude = {
  candidate: { select: { name: true } },
  events: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
  onboardingRequests: { select: { id: true, onboardingStatus: true, recordStatus: true, cancelledAt: true, archivedAt: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.TalentApplicationInclude;
type Application = Prisma.TalentApplicationGetPayload<{ include: typeof applicationInclude }>;
type Interview = Prisma.TalentInterviewGetPayload<{ include: { participants: true } }>;
const activeOnboardingStatuses = ['draft', 'submitted', 'pending_entry'] as const;

@Injectable()
export class TalentRecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  private async actor(tx: Prisma.TransactionClient, user: AuthUser) {
    const actor = await tx.user.findUnique({ where: { id: user.id }, select: actorSelect });
    if (!actor || !isCurrentRecruitmentActor(actor)) throw new ForbiddenException('当前账号不具备办理资格');
    return actor;
  }

  private assertRead(actor: RecruitmentActor) {
    if (!canReadRecruitment(actor)) throw new ForbiddenException('无权限查看应聘记录');
  }

  private assertWrite(actor: RecruitmentActor) {
    if (!canEditRecruitment(actor)) throw new ForbiddenException('无权限维护应聘记录');
  }

  async queue(query: TalentApplicationQueueQueryDto, user: AuthUser) {
    const actor = await this.actor(this.prisma, user);this.assertRead(actor);
    const keyword = query.keyword?.trim();
    const where: Prisma.TalentApplicationWhereInput = { candidate: { deletedAt: null },
      ...((query.scope ?? 'owned') === 'owned' ? { ownerId: actor.id } : {}),
      ...(query.stage ? { stage: query.stage } : {}), ...(query.deptId ? { deptId: query.deptId } : {}),
      ...(keyword ? { OR: [{ candidate: { name: { contains: keyword, mode: 'insensitive' } } },
        { positionName: { contains: keyword, mode: 'insensitive' } }, { recruitmentBatch: { contains: keyword, mode: 'insensitive' } }] } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.talentApplication.findMany({ where, select: { id: true, candidateId: true, candidate: { select: { name: true } },
        positionName: true, recruitmentBatch: true, stage: true, ownerId: true, departmentNameSnapshot: true, expectedEntryDate: true, updatedAt: true,
        interviews: { where: { status: 'scheduled' }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 1,
          select: { id: true, startsAt: true, endsAt: true, status: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: query.skip, take: query.take }),
      this.prisma.talentApplication.count({ where }),
    ]);
    const owners = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(r => r.ownerId))] } }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
    return { items: rows.map(({ candidate, interviews, ...row }) => ({ ...row, candidateName: candidate.name, ownerName: owners.get(row.ownerId) ?? null, nextInterview: interviews[0] ?? null })),
      total, page: query.page, pageSize: query.pageSize };
  }

  async owners(query: TalentOwnerQueryDto, user: AuthUser) {
    this.assertRead(await this.actor(this.prisma, user));
    const where = talentOwnerWhere();
    const keyword = query.keyword?.trim();
    if (keyword) where.AND = [{ OR: [
      { name: { contains: keyword, mode: 'insensitive' } },
      { employeeNo: { contains: keyword, mode: 'insensitive' } },
    ] }];
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } },
        orderBy: [{ name: 'asc' }, { employeeNo: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(row => ({ id: row.id, name: row.name, employeeNo: row.employeeNo, deptName: row.dept?.name ?? null })),
      total, page: query.page, pageSize: query.pageSize };
  }

  async assertOwner(tx: Prisma.TransactionClient, ownerId: string) {
    const owner = await tx.user.findUnique({ where: { id: ownerId }, select: actorSelect });
    if (!owner || !canEditRecruitment(owner)) throw new BadRequestException('请选择当前在职或试用、具备招聘经办权限的负责人');
    return owner;
  }

  async list(candidateId: string, user: AuthUser) {
    const actor = await this.actor(this.prisma, user);
    this.assertRead(actor);
    const candidate = await this.prisma.talentCandidate.findUnique({ where: { id: candidateId }, select: { id: true } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    const rows = await this.prisma.talentApplication.findMany({ where: { candidateId }, include: applicationInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const activeOnboarding = await this.hasActiveOnboarding(this.prisma, candidateId);
    return Promise.all(rows.map(row => this.view(this.prisma, row, actor, activeOnboarding)));
  }

  async detail(id: string, user: AuthUser) {
    const actor = await this.actor(this.prisma, user);
    const row = await this.prisma.talentApplication.findUnique({ where: { id }, include: applicationInclude });
    if (!row) throw new NotFoundException('应聘记录不存在');
    if (!canReadTalentApplication(actor, row)) throw new ForbiddenException('无权限查看此应聘记录');
    return this.view(this.prisma, row, actor);
  }

  async hiringReviews(user: AuthUser) {
    const actor = await this.actor(this.prisma, user);
    if (!hasTalentHiringConfirm(actor)) throw new ForbiddenException('无录用确认权限');
    const rows = await this.prisma.talentApplication.findMany({
      where: { stage: 'hiring_review', hiringRequestedById: { not: actor.id } }, include: applicationInclude,
      orderBy: [{ hiringRequestedAt: 'asc' }, { id: 'asc' }],
    });
    return Promise.all(rows.map(row => this.view(this.prisma, row, actor)));
  }

  private async hasActiveOnboarding(tx: Prisma.TransactionClient, candidateId: string) {
    return Boolean(await tx.employeeDataChangeRequest.findFirst({ where: { talentCandidateId: candidateId,
      archivedAt: null, cancelledAt: null, onboardingStatus: { in: [...activeOnboardingStatuses] } }, select: { id: true } }));
  }

  private async view(tx: Prisma.TransactionClient, row: Application, actor: RecruitmentActor, activeOnboarding?: boolean) {
    const ids = [...new Set([row.ownerId, row.createdById, ...row.events.map(event => event.actorId)])];
    const names = new Map((await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(user => [user.id, user.name]));
    const { events, onboardingRequests, candidate, requestId, creationFingerprint, ...fields } = row;
    const visibleEvents = canReadRecruitment(actor) ? events : events.filter(event => !event.action.endsWith('_feedback'));
    const request = onboardingRequests.find(request => !request.cancelledAt && !request.archivedAt
      && activeOnboardingStatuses.includes(request.onboardingStatus as typeof activeOnboardingStatuses[number])) ?? onboardingRequests[0];
    const activity = canReadRecruitment(actor) ? await tx.talentInterview.findMany({ where: { applicationId: row.id, status: { not: 'cancelled' } },
      select: { status: true, participants: { select: { userId: true } }, feedback: { where: { status: 'submitted' }, select: { userId: true } } } }) : [];
    const activitySummary = { scheduledCount: activity.filter(i => i.status === 'scheduled').length,
      unsubmittedFeedbackCount: activity.reduce((n, i) => n + i.participants.filter(p => !i.feedback.some(f => f.userId === p.userId)).length, 0) };
    return { ...fields, ...(canReadRecruitment(actor) ? { activitySummary } : {}), candidateName: candidate.name, ownerName: names.get(row.ownerId) ?? null, creatorName: names.get(row.createdById) ?? null,
      allowedActions: allowedApplicationActions(actor, row, activeOnboarding ?? await this.hasActiveOnboarding(tx, row.candidateId)),
      events: visibleEvents.map(event => ({ ...event, actorName: names.get(event.actorId) ?? null })),
      onboardingRequest: request ? { id: request.id, onboardingStatus: request.onboardingStatus, recordStatus: request.recordStatus, cancelledAt: request.cancelledAt } : null };
  }

  private async lockCandidate(tx: Prisma.TransactionClient, candidateId: string) {
    await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${candidateId}::uuid FOR UPDATE`;
  }

  private async lockApplication(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM talent_applications WHERE id = ${id}::uuid FOR UPDATE`;
  }

  private async applicationForUpdate(tx: Prisma.TransactionClient, id: string) {
    const reference = await tx.talentApplication.findUnique({ where: { id }, select: { candidateId: true } });
    if (!reference) throw new NotFoundException('应聘记录不存在');
    await this.lockCandidate(tx, reference.candidateId);
    await this.lockApplication(tx, id);
    const row = await tx.talentApplication.findUnique({ where: { id }, include: applicationInclude });
    if (!row) throw new NotFoundException('应聘记录不存在');
    if (row.candidateId !== reference.candidateId) throw new ConflictException('应聘来源已变化，请刷新后重试');
    return row;
  }

  private revision(actual: number, expected: number) {
    if (!Number.isInteger(expected) || expected < 0 || actual !== expected) throw new ConflictException('记录已更新，请刷新后重试');
  }

  private text(value: unknown, label: string, max: number, required = false): string | null {
    if (value !== null && value !== undefined && typeof value !== 'string') throw new BadRequestException(`${label}格式不正确`);
    const result = (value as string | null | undefined)?.trim() || null;
    if ((required && !result) || (result && result.length > max)) throw new BadRequestException(`${label}${required ? '不能为空，且' : ''}最多${max}字`);
    return result;
  }

  private date(value: string | null | undefined) {
    if (value == null) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('预计入职日期格式不正确');
    }
    return date;
  }

  private async editableFields(tx: Prisma.TransactionClient, input: Partial<CreateTalentApplicationDto>) {
    const data: Prisma.TalentApplicationUncheckedUpdateManyInput = {};
    if (input.positionName !== undefined) data.positionName = this.text(input.positionName, '应聘岗位', 100, true)!;
    if (input.recruitmentBatch !== undefined) data.recruitmentBatch = this.text(input.recruitmentBatch, '招聘批次', 100);
    if (input.expectedEntryDate !== undefined) data.expectedEntryDate = this.date(input.expectedEntryDate);
    if (input.ownerId !== undefined) {
      if (!input.ownerId) throw new BadRequestException('请选择负责人');
      await this.assertOwner(tx, input.ownerId);
      data.ownerId = input.ownerId;
    }
    if (input.deptId !== undefined) {
      const dept = input.deptId ? await tx.department.findUnique({ where: { id: input.deptId }, select: { id: true, name: true, isActive: true } }) : null;
      if (input.deptId && !dept?.isActive) throw new BadRequestException('请选择有效的应聘部门');
      data.deptId = dept?.id ?? null;
      data.departmentNameSnapshot = dept?.name ?? null;
    }
    return data;
  }

  async create(candidateId: string, input: CreateTalentApplicationDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.lockCandidate(tx, candidateId);
      if (input.requestId) {
        // Different candidate locks cannot serialize a reused global request UUID.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${input.requestId.toLowerCase()}, 0))`;
      }
      const actor = await this.actor(tx, user);
      this.assertWrite(actor);
      const candidate = await tx.talentCandidate.findUnique({ where: { id: candidateId }, select: { id: true, deletedAt: true } });
      if (!candidate || candidate.deletedAt) throw new NotFoundException('候选人不存在或已删除');
      const ownerId = input.ownerId ?? actor.id;
      const positionName = this.text(input.positionName, '应聘岗位', 100, true)!;
      const recruitmentBatch = this.text(input.recruitmentBatch, '招聘批次', 100);
      const expectedEntryDate = this.date(input.expectedEntryDate);
      const creationFingerprint = input.requestId ? createHash('sha256').update(JSON.stringify([
        positionName, recruitmentBatch, input.deptId?.toLowerCase() ?? null, ownerId.toLowerCase(), expectedEntryDate,
      ])).digest('hex') : null;
      if (input.requestId) {
        const existing = await tx.talentApplication.findUnique({ where: { requestId: input.requestId }, include: applicationInclude });
        if (existing) {
          if (existing.candidateId !== candidate.id || existing.createdById !== actor.id || existing.creationFingerprint !== creationFingerprint) {
            throw new ConflictException('本次新建请求已用于其他应聘内容，请重新发起');
          }
          return this.view(tx, existing, actor);
        }
      }
      const fields = await this.editableFields(tx, { ownerId, deptId: input.deptId });
      const row = await tx.talentApplication.create({ data: {
        candidateId, createdById: actor.id, ownerId, stage: 'screening', revision: 0,
        requestId: input.requestId ?? null, creationFingerprint, positionName, recruitmentBatch, expectedEntryDate,
        deptId: fields.deptId as string | null | undefined, departmentNameSnapshot: fields.departmentNameSnapshot as string | null | undefined,
      }, include: applicationInclude });
      await this.event(tx, row, actor.id, 'create', null, null);
      await this.audit(tx, actor.id, 'create_application', 'talent_application', row.id, null, { candidateId, stage: row.stage, revision: row.revision });
      return this.reloadView(tx, row.id, actor);
    });
  }

  async update(id: string, input: UpdateTalentApplicationDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const row = await this.applicationForUpdate(tx, id);
      const actor = await this.actor(tx, user);
      this.assertWrite(actor);
      this.revision(row.revision, input.expectedRevision);
      if (!['screening', 'interviewing', 'reserve'].includes(row.stage)) throw new BadRequestException('当前应聘阶段不能编辑');
      const fields = await this.editableFields(tx, input);
      await this.changeApplication(tx, row, fields);
      const updated = { ...row, revision: row.revision + 1 };
      await this.event(tx, updated, actor.id, 'update', row.stage, null);
      await this.audit(tx, actor.id, 'update_application', 'talent_application', id, { stage: row.stage, revision: row.revision }, { stage: row.stage, revision: updated.revision });
      return this.reloadView(tx, id, actor);
    });
  }

  async act(id: string, input: TalentApplicationActionDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const row = await this.applicationForUpdate(tx, id);
      const actor = await this.actor(tx, user);
      if (!canReadTalentApplication(actor, row)) throw new ForbiddenException('无权限查看此应聘记录');
      this.revision(row.revision, input.expectedRevision);
      const confirmation = input.action === 'approve_hiring' || input.action === 'return_hiring';
      if (confirmation) {
        if (!canConfirmTalentHiring(actor, row.hiringRequestedById)) throw new ForbiddenException('需由独立的录用确认人办理，不能确认本人提交的申请');
      } else this.assertWrite(actor);
      const activeOnboarding = await this.hasActiveOnboarding(tx, row.candidateId);
      if (!allowedApplicationActions(actor, row, activeOnboarding).includes(input.action)) throw new BadRequestException('当前阶段不支持此操作，或候选人仍有进行中的入职申请');
      const note = this.text(input.note, '操作说明', 4000, ['submit_hiring', 'return_hiring', 'reject'].includes(input.action));
      const reserveReasons = input.reserveReasons ?? [];
      if (!Array.isArray(reserveReasons) || reserveReasons.length > 4 || new Set(reserveReasons).size !== reserveReasons.length
        || reserveReasons.some(reason => !TALENT_RESERVE_REASONS.includes(reason)) || (input.action !== 'reserve' && reserveReasons.length > 0)) {
        throw new BadRequestException('储备原因无效，请选择有效选项且不要重复；仅转储备时可填写原因');
      }
      const destinations = {
        start_interview: 'interviewing', submit_hiring: 'hiring_review', approve_hiring: 'offered', return_hiring: row.reviewReturnStage,
        accept_offer: 'accepted', decline_offer: 'declined', reject: 'rejected', reserve: 'reserve', withdraw: 'withdrawn', reopen: 'screening',
      };
      const stage = destinations[input.action];
      if (!stage || (input.action === 'return_hiring' && !['screening', 'interviewing'].includes(stage))) throw new BadRequestException('录用申请的退回阶段无效');
      const fields: Prisma.TalentApplicationUncheckedUpdateManyInput = { stage };
      if (input.expectedEntryDate !== undefined) fields.expectedEntryDate = this.date(input.expectedEntryDate);
      if (input.action === 'submit_hiring') Object.assign(fields, { hiringReason: note, hiringRequestedById: actor.id,
        hiringRequestedAt: new Date(), reviewReturnStage: row.stage, hiringReviewedById: null, hiringReviewedAt: null });
      if (confirmation) Object.assign(fields, { hiringReviewedById: actor.id, hiringReviewedAt: new Date() });
      await this.changeApplication(tx, row, fields);
      const updated = { ...row, stage, revision: row.revision + 1 };
      await this.event(tx, updated, actor.id, input.action, row.stage, note, reserveReasons);
      await this.audit(tx, actor.id, input.action, 'talent_application', id, { stage: row.stage, revision: row.revision }, { stage, revision: updated.revision });
      return this.reloadView(tx, id, actor);
    });
  }

  private async changeApplication(tx: Prisma.TransactionClient, row: Application, fields: Prisma.TalentApplicationUncheckedUpdateManyInput) {
    const result = await tx.talentApplication.updateMany({ where: { id: row.id, candidateId: row.candidateId, revision: row.revision, stage: row.stage }, data: { ...fields, revision: row.revision + 1 } });
    if (result.count !== 1) throw new ConflictException('应聘记录已更新，请刷新后重试');
  }

  private async reloadView(tx: Prisma.TransactionClient, id: string, actor: RecruitmentActor) {
    const row = await tx.talentApplication.findUnique({ where: { id }, include: applicationInclude });
    if (!row) throw new NotFoundException('应聘记录不存在');
    return this.view(tx, row, actor);
  }

  private async event(tx: Prisma.TransactionClient, row: Application, actorId: string, action: string, fromStage: string | null, note: string | null, reserveReasons: TalentReserveReason[] = []) {
    await tx.talentApplicationEvent.create({ data: { applicationId: row.id, actorId, action, fromStage, toStage: row.stage, version: row.revision, note, reserveReasons } });
  }

  private async audit(tx: Prisma.TransactionClient, userId: string, action: string, entityType: string, entityId: string,
    oldValue: Prisma.InputJsonObject | null, newValue: Prisma.InputJsonObject) {
    await tx.auditLog.create({ data: { userId, action, entityType, entityId, oldValue: oldValue ?? undefined, newValue } });
  }

  private async feedbackContext(tx: Prisma.TransactionClient, id: string, user: AuthUser, lock = false, feedbackUserId = user.id) {
    const reference = await tx.talentInterview.findUnique({ where: { id }, select: { candidateId: true, applicationId: true } });
    if (!reference) throw new NotFoundException('面试邀约不存在或无权查看');
    if (lock) {
      await this.lockCandidate(tx, reference.candidateId);
      if (reference.applicationId) await this.lockApplication(tx, reference.applicationId);
      await tx.$queryRaw`SELECT id FROM talent_interviews WHERE id = ${id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT interview_id FROM talent_interview_feedback WHERE interview_id = ${id}::uuid AND user_id = ${feedbackUserId}::uuid FOR UPDATE`;
    }
    const actor = await this.actor(tx, user);
    const interview = await tx.talentInterview.findUnique({ where: { id }, include: { participants: true } });
    if (!interview) throw new NotFoundException('面试邀约不存在或无权查看');
    if (interview.candidateId !== reference.candidateId || interview.applicationId !== reference.applicationId) throw new ConflictException('面试来源已变化，请刷新后重试');
    const participant = interview.participants.some(participant => participant.userId === actor.id);
    if (!canReadRecruitment(actor) && !participant) throw new NotFoundException('面试邀约不存在或无权查看');
    const application = interview.applicationId ? await tx.talentApplication.findUnique({ where: { id: interview.applicationId }, include: applicationInclude }) : null;
    if (interview.applicationId && (!application || application.candidateId !== interview.candidateId)) throw new ConflictException('面试关联的应聘来源不一致');
    return { actor, interview, participant, application };
  }

  async feedback(id: string, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const context = await this.feedbackContext(tx, id, user);
      return this.feedbackView(tx, context);
    });
  }

  private async feedbackView(tx: Prisma.TransactionClient, context: { actor: RecruitmentActor; interview: Interview; participant: boolean; application: Application | null }) {
    const { actor, interview, participant, application } = context;
    const isHr = canReadRecruitment(actor);
    const where = { interviewId: interview.id, ...(!isHr ? { userId: actor.id } : {}) };
    const rows = await tx.talentInterviewFeedback.findMany({ where,
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] });
    const history = rows.length ? await tx.talentInterviewFeedbackEvent.findMany({ where,
      orderBy: [{ createdAt: 'asc' }, { revision: 'asc' }, { id: 'asc' }] }) : [];
    const names = new Map(interview.participants.map(participant => [participant.userId, participant.userNameSnapshot]));
    const missingIds = rows.filter(row => !names.has(row.userId)).map(row => row.userId);
    if (missingIds.length) {
      for (const user of await tx.user.findMany({ where: { id: { in: missingIds } }, select: { id: true, name: true } })) names.set(user.id, user.name);
    }
    const items = rows.map(row => ({ ...row, userName: names.get(row.userId) ?? null, history: history.filter(event => event.userId === row.userId) }));
    const own = items.find(row => row.userId === actor.id) ?? null;
    const open = isFeedbackOpen(application?.stage ?? null, interview.status);
    return { interviewVersion: interview.version, own, items, canEdit: participant && isCurrentRecruitmentActor(actor) && open && own?.status !== 'submitted',
      canReturn: canWriteRecruitment(actor) && open && items.some(row => row.status === 'submitted') };
  }

  async saveFeedback(id: string, input: SaveTalentInterviewFeedbackDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const context = await this.feedbackContext(tx, id, user, true);
      const { actor, interview, application } = context;
      if (!context.participant) throw new ForbiddenException('只有实际参与人可以填写本人反馈');
      this.revision(interview.version, input.interviewVersion);
      if (!isFeedbackOpen(application?.stage ?? null, interview.status)) throw new BadRequestException('面试已取消或应聘已进入录用及后续阶段，不能修改反馈');
      const before = await tx.talentInterviewFeedback.findUnique({ where: { interviewId_userId: { interviewId: id, userId: actor.id } } });
      this.revision(before?.revision ?? 0, input.expectedRevision);
      if (before?.status === 'submitted') throw new BadRequestException('反馈已提交，请由HR退回后再修改');
      if (typeof input.submit !== 'boolean') throw new BadRequestException('请选择保存草稿或提交反馈');
      const outcome = input.outcome === undefined ? before?.outcome ?? null : input.outcome;
      const summary = input.summary === undefined ? before?.summary ?? null : this.text(input.summary, '反馈说明', 4000);
      if (outcome !== null && !['pass', 'reject', 'pending'].includes(outcome)) throw new BadRequestException('反馈结论不正确');
      if (input.submit && (!outcome || !summary?.trim())) throw new BadRequestException('提交反馈必须填写结论和说明');
      const data = { status: input.submit ? 'submitted' : 'draft', outcome, summary, revision: (before?.revision ?? 0) + 1, submittedAt: input.submit ? new Date() : null };
      if (!before) await tx.talentInterviewFeedback.create({ data: { interviewId: id, userId: actor.id, ...data } });
      else {
        const changed = await tx.talentInterviewFeedback.updateMany({ where: { interviewId: id, userId: actor.id, revision: before.revision, status: 'draft' }, data });
        if (changed.count !== 1) throw new ConflictException('反馈已更新，请刷新后重试');
      }
      const action = input.submit ? 'submit_feedback' : 'save_feedback';
      if (input.submit) await tx.talentInterviewFeedbackEvent.create({ data: { interviewId: id, userId: actor.id, actorId: actor.id,
        action, revision: data.revision, status: data.status, outcome, summary, note: null } });
      if (application && input.submit) await this.event(tx, application, actor.id, action, application.stage, `${outcome}\n${summary}`);
      await this.audit(tx, actor.id, action, 'talent_interview_feedback', id,
        before ? { userId: actor.id, status: before.status, revision: before.revision } : null,
        { interviewId: id, userId: actor.id, status: data.status, revision: data.revision });
      return this.feedbackView(tx, context);
    });
  }

  async returnFeedback(id: string, userId: string, input: ReturnTalentInterviewFeedbackDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const context = await this.feedbackContext(tx, id, user, true, userId);
      const { actor, interview, application } = context;
      if (!canWriteRecruitment(actor)) throw new ForbiddenException('无权限退回面试反馈');
      this.revision(interview.version, input.interviewVersion);
      if (!isFeedbackOpen(application?.stage ?? null, interview.status)) throw new BadRequestException('录用送审或面试取消后不能退回反馈');
      const note = this.text(input.note, '退回说明', 4000, true);
      const before = await tx.talentInterviewFeedback.findUnique({ where: { interviewId_userId: { interviewId: id, userId } } });
      if (!before) throw new NotFoundException('反馈不存在');
      this.revision(before.revision, input.expectedRevision);
      if (before.status !== 'submitted') throw new BadRequestException('只能退回已提交的反馈');
      const changed = await tx.talentInterviewFeedback.updateMany({ where: { interviewId: id, userId, revision: before.revision, status: 'submitted' },
        data: { status: 'draft', revision: before.revision + 1, submittedAt: null } });
      if (changed.count !== 1) throw new ConflictException('反馈已更新，请刷新后重试');
      await tx.talentInterviewFeedbackEvent.create({ data: { interviewId: id, userId, actorId: actor.id, action: 'return_feedback',
        revision: before.revision + 1, status: 'draft', outcome: before.outcome, summary: before.summary, note } });
      if (application) await this.event(tx, application, actor.id, 'return_feedback', application.stage, note);
      await this.audit(tx, actor.id, 'return_feedback', 'talent_interview_feedback', id,
        { userId, status: before.status, revision: before.revision }, { interviewId: id, userId, status: 'draft', revision: before.revision + 1 });
      return this.feedbackView(tx, context);
    });
  }
}
