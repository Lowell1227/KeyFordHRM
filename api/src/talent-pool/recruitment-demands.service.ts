import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type RecruitmentDemandSyncRun } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { DingtalkRecruitmentService } from '@/dingtalk/dingtalk-recruitment.service';
import { CreateLocalRecruitmentDemandDto, LocalRecruitmentDemandActionDto, MapRecruitmentDemandDto, RecruitmentDemandIntentOptionsQueryDto, RecruitmentDemandOptionsQueryDto, RecruitmentDemandQueryDto, SyncRecruitmentDemandsDto, UpdateLocalRecruitmentDemandDto } from './recruitment-demands.dto';
import { assertRecruitmentDemandReader, assertRecruitmentDemandReviewer, assertRecruitmentEditor, assertRecruitmentReader, canEditRecruitment, canReadRecruitmentDemand, canReadTalentApplication, canReviewRecruitmentDemand, recruitmentActorSelect, type RecruitmentActor } from './talent-recruitment-policy';
import { type RecruitmentDemandGateway, type RecruitmentDemandSource, type RecruitmentDemandSubmissionSnapshot, type RecruitmentDemandSubmissionProof, type RecruitmentDemandVerification } from './recruitment-demands.types';
import { attachRecruitmentDemandSeats } from './recruitment-demand-seats';
import { isUUID } from 'class-validator';
import { recruitmentDemandWorkbenchWhere } from './talent-workbench.service';

const directoryInclude = {
  department: { select: { id: true, name: true, fullPath: true, isActive: true } },
  position: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.RecruitmentDemandInclude;
type Demand = Prisma.RecruitmentDemandGetPayload<{ include: typeof directoryInclude }>;
type ApplicationReference = { deptId: string | null; positionName: string };
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000, maxWait: 10000 };
const maxSyncInstances = 10;
const syncBudgetMs = 10000;

@Injectable()
export class RecruitmentDemandsService {
  private readonly submissionProofs = new WeakSet<RecruitmentDemandSubmissionProof>();
  constructor(private readonly prisma: PrismaService,
    @Optional() @Inject(DingtalkRecruitmentService) private readonly source?: RecruitmentDemandGateway) {}

  // One ledger lock also orders verified supersessions whose predecessor may not exist yet.
  private async lock(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('recruitment-demand-ledger', 0))`;
  }

  private async editorAfterLock(tx: Prisma.TransactionClient, user: AuthUser) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR SHARE`;
    return assertRecruitmentEditor(tx, user);
  }

  private async reviewerAfterLock(tx: Prisma.TransactionClient, user: AuthUser) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR SHARE`;
    return assertRecruitmentDemandReviewer(tx, user);
  }

  private sourceStatus(): ReturnType<RecruitmentDemandGateway['status']> {
    const status = this.source?.status() ?? { configured: false, missing: ['recruitmentSource'], readOnly: true as const };
    if (status.configured && (!status.scope?.organizationKey || !status.scope.processCode)) return { ...status, configured: false, missing: [...status.missing, 'recruitmentSourceScope'] };
    return status;
  }

  private requireSource() {
    if (!this.source || !this.sourceStatus().configured) throw new ServiceUnavailableException('招聘需求只读来源尚未配置，不能确认需求有效性');
    return this.source;
  }

  private inScope(row: { organizationKey: string | null; processCode: string | null }) {
    const status = this.sourceStatus();
    return status.configured && row.organizationKey === status.scope?.organizationKey && row.processCode === status.scope.processCode;
  }

  async status(user: AuthUser) {
    await assertRecruitmentDemandReader(this.prisma, user);
    return this.sourceStatus();
  }

  private issues(row: Demand, application?: ApplicationReference): string[] {
    const issues: string[] = [];
    const local = row.sourceKind === 'local';
    if (!local) {
      if (!this.sourceStatus().configured) issues.push('来源尚未配置，待核对');
      else if (!this.inScope(row)) issues.push('需求不属于当前已配置的组织和表单');
    }
    if (row.syncIssue) issues.push('来源同步未完成或失败，待重新同步核对');
    if (row.sourceState !== 'approved') {
      if (local) issues.push(({ draft: '请先提交招聘需求', pending: '招聘需求待审核',
        rejected: '请按退回意见修改后重新提交招聘需求', withdrawn: '招聘需求已撤销，不能用于新的录用提交' } as Record<string, string>)[row.sourceState] ?? '招聘需求状态待核对');
      else issues.push('需求尚未终审通过或已失效');
    }
    if (row.supersededByInstanceId) issues.push('需求已由更正单替代');
    if ((!local || row.sourceState === 'approved') && (!row.mappedFingerprint || row.mappedFingerprint !== row.sourceFingerprint)) issues.push(local ? '系统创建需求的审批版本不完整' : '来源版本尚未完成人工核对');
    if (local && row.sourceState === 'approved' && (!row.approvedById || !row.submittedById
      || (row.approvalMode === 'self_created'
        ? row.createdById !== row.approvedById || row.submittedById !== row.approvedById
        : row.approvedById === row.submittedById)
      || row.approvedHeadcount !== row.requestedHeadcount)) issues.push('系统创建需求的审核记录不完整');
    if (!row.department?.isActive) issues.push('请核对有效部门');
    if (!row.position?.isActive) issues.push('请核对有效岗位');
    if ((!local || row.sourceState === 'approved') && (!Number.isInteger(row.approvedHeadcount) || row.approvedHeadcount! < 1)) issues.push('请核对批准人数');
    if (application && (!application.deptId || application.deptId !== row.deptId)) issues.push('需求部门与当前应聘不一致');
    if (application && application.positionName.trim() !== row.position?.name) issues.push('需求岗位与当前应聘不一致');
    return issues;
  }

  private localActions(row: Demand, actor?: RecruitmentActor): string[] {
    if (row.sourceKind !== 'local' || !actor) return [];
    const edit = canEditRecruitment(actor);
    if (['draft', 'rejected'].includes(row.sourceState)) return edit ? ['edit',
      canReviewRecruitmentDemand(actor) && row.createdById === actor.id ? 'submit_approve' : 'submit', 'withdraw'] : [];
    const actions: string[] = [];
    if (row.sourceState === 'pending' && canReviewRecruitmentDemand(actor) && row.submittedById
      && (row.submittedById !== actor.id || row.createdById === actor.id)) actions.push('approve', 'return');
    if (edit && ['pending', 'approved'].includes(row.sourceState)) actions.push('withdraw');
    return actions;
  }

  private view(row: Demand, application?: ApplicationReference, actor?: RecruitmentActor) {
    const issues = this.issues(row, application);
    return { id: row.id, revision: row.revision, sourceKind: row.sourceKind === 'local' ? 'local' as const : 'dingtalk' as const,
      instanceId: row.instanceId, sourceState: row.sourceState,
      rawDepartment: row.rawDepartment, rawPosition: row.rawPosition, rawHeadcount: row.rawHeadcount,
      deptId: row.deptId, departmentName: row.department?.name ?? null, departmentFullPath: row.department?.fullPath ?? null,
      positionId: row.positionId, positionName: row.position?.name ?? null, trackingState: row.trackingState ?? 'recruiting',
      approvedHeadcount: row.approvedHeadcount, usable: issues.length === 0, issues, approvedAt: row.approvedAt?.toISOString() ?? null,
      sourceLink: row.sourceLink, lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      requestedHeadcount: row.requestedHeadcount ?? null, requestReason: row.requestReason ?? null, createdById: row.createdById ?? null,
      submittedById: row.submittedById ?? null, approvedById: row.approvedById ?? null, approvalMode: row.approvalMode ?? null,
      createdAt: row.createdAt?.toISOString() ?? null,
      allowedActions: this.localActions(row, actor) };
  }

  private async withReviewContext(tx: Prisma.TransactionClient, rows: Array<ReturnType<RecruitmentDemandsService['view']>>, viewer?: RecruitmentActor) {
    if (!rows.length) return [];
    const ids = [...new Set(rows.flatMap(row => [row.createdById, row.submittedById, row.approvedById]).filter((id): id is string => !!id))];
    const [accounts, submissions] = await Promise.all([
      tx.user.findMany({ where: { OR: [{ id: { in: ids } }, { status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null,
        isAssessorOnly: false, hrCapabilities: { has: 'recruitment_demand_review' } }] }, select: recruitmentActorSelect }),
      tx.recruitmentDemandEvent.findMany({ where: { demandId: { in: rows.map(row => row.id) }, action: { in: ['local_submit', 'local_submit_approve'] } },
        orderBy: { revision: 'desc' }, select: { demandId: true, createdAt: true } }),
    ]);
    const names = new Map(accounts.map(account => [account.id, account.name]));
    return rows.map(row => {
      const submitterId = ['draft', 'rejected'].includes(row.sourceState) && viewer ? viewer.id : row.submittedById;
      const reviewers = row.sourceKind === 'local' ? accounts.filter(account => canReviewRecruitmentDemand(account)
        && (submitterId !== account.id || row.createdById === account.id)).map(({ id, name }) => ({ id, name })) : [];
      const submissionIssue = row.allowedActions.includes('submit') && !reviewers.length
        ? '请由创建人或其他经办提交，再交需求审核人审核' : null;
      return { ...row, createdByName: names.get(row.createdById ?? '') ?? null,
        submittedByName: names.get(row.submittedById ?? '') ?? null, approvedByName: names.get(row.approvedById ?? '') ?? null,
        submittedAt: submissions.find(event => event.demandId === row.id)?.createdAt.toISOString() ?? null,
        reviewers, submissionIssue, allowedActions: submissionIssue ? row.allowedActions.filter(action => action !== 'submit') : row.allowedActions };
    });
  }

  private async assertReviewAvailable(tx: Prisma.TransactionClient, creatorId: string | null, submitterId: string) {
    await tx.$queryRaw`SELECT id FROM users WHERE 'recruitment_demand_review' = ANY(hr_capabilities) ORDER BY id FOR SHARE`;
    const accounts = await tx.user.findMany({ where: { status: { in: ['active', 'probation'] }, archivedAt: null,
      deletedAt: null, isAssessorOnly: false, hrCapabilities: { has: 'recruitment_demand_review' } }, select: recruitmentActorSelect });
    if (!accounts.some(account => canReviewRecruitmentDemand(account) && (account.id !== submitterId || creatorId === account.id))) {
      throw new BadRequestException('请由创建人或其他经办提交，再交需求审核人审核');
    }
  }

  private keyword(keyword?: string): Prisma.RecruitmentDemandWhereInput {
    const value = keyword?.trim();
    return value ? { OR: [
      ...['instanceId', 'rawDepartment', 'rawPosition'].map(field => ({ [field]: { contains: value, mode: 'insensitive' } })),
      { department: { is: { name: { contains: value, mode: 'insensitive' } } } },
      { position: { is: { name: { contains: value, mode: 'insensitive' } } } },
      ...(isUUID(value) ? [{ id: value }] : []),
    ] } : {};
  }

  async list(query: RecruitmentDemandQueryDto, user: AuthUser) {
    const actor = await assertRecruitmentDemandReader(this.prisma, user);
    const filters: Prisma.RecruitmentDemandWhereInput = { ...this.keyword(query.keyword), ...(query.status ? { sourceState: query.status } : {}),
      ...(query.trackingState ? { trackingState: query.trackingState,
        AND: [{ OR: [{ sourceState: 'approved' }, { approvedAt: { not: null } }, { trackingChangedAt: { not: null } }] }] } : {}) };
    const where: Prisma.RecruitmentDemandWhereInput = query.workQueue
      ? { AND: [filters, recruitmentDemandWorkbenchWhere(query.workQueue, actor)] } : filters;
    const [rows, total] = await Promise.all([
      this.prisma.recruitmentDemand.findMany({ where, include: directoryInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: query.skip, take: query.take }),
      this.prisma.recruitmentDemand.count({ where }),
    ]);
    const enriched = await this.withReviewContext(this.prisma, rows.map(row => this.view(row, undefined, actor)), actor);
    return { items: await attachRecruitmentDemandSeats(this.prisma, enriched), total, page: query.page, pageSize: query.pageSize };
  }

  async directories(user: AuthUser) {
    await assertRecruitmentDemandReader(this.prisma, user);
    const departments = await this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, fullPath: true }, orderBy: [{ fullPath: 'asc' }, { id: 'asc' }] });
    const positions = await this.prisma.position.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return { departments: departments.map(({ id, name, fullPath }) => ({ id, name, fullPath })), positions: positions.map(({ id, code, name }) => ({ id, code, name })) };
  }

  async options(query: RecruitmentDemandOptionsQueryDto, user: AuthUser) {
    const actor = await assertRecruitmentReader(this.prisma, user);
    const app = await this.prisma.talentApplication.findUnique({ where: { id: query.applicationId }, select: { deptId: true, positionName: true, stage: true, candidate: { select: { deletedAt: true } } } });
    if (!app || app.candidate.deletedAt) throw new NotFoundException('应聘记录不存在');
    if (!app.deptId || !['screening', 'interviewing'].includes(app.stage)) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    const origins: Prisma.RecruitmentDemandWhereInput[] = [{ sourceKind: 'local', approvedById: { not: null }, submittedById: { not: null } }];
    if (this.sourceStatus().configured) origins.push({ sourceKind: 'dingtalk', ...this.sourceStatus().scope! });
    // mappedFingerprint equality is a column comparison, not a client-provided value.
    const where: Prisma.RecruitmentDemandWhereInput = { AND: [this.keyword(query.keyword), { OR: origins }], deptId: app.deptId, sourceState: 'approved', syncIssue: null,
      supersededByInstanceId: null, mappedFingerprint: { equals: this.prisma.recruitmentDemand.fields.sourceFingerprint }, approvedHeadcount: { gt: 0 },
      department: { is: { isActive: true } }, position: { is: { isActive: true, name: app.positionName.trim() } } };
    const [rows, total] = await Promise.all([
      this.prisma.recruitmentDemand.findMany({ where, include: directoryInclude, orderBy: [{ approvedAt: 'desc' }, { id: 'asc' }], skip: query.skip, take: query.take }),
      this.prisma.recruitmentDemand.count({ where }),
    ]);
    return { items: await attachRecruitmentDemandSeats(this.prisma, rows.map(row => this.view(row, app, actor))), total, page: query.page, pageSize: query.pageSize };
  }

  async detail(id: string, user: AuthUser) {
    const actor = await assertRecruitmentDemandReader(this.prisma, user);
    const row = await this.get(this.prisma, id);
    const events = await this.prisma.recruitmentDemandEvent.findMany({ where: { demandId: id }, orderBy: [{ revision: 'asc' }] });
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(events.map(event => event.actorId))] } }, select: { id: true, name: true } })).map(actor => [actor.id, actor.name]));
    const [current] = await attachRecruitmentDemandSeats(this.prisma, await this.withReviewContext(this.prisma, [this.view(row, undefined, actor)], actor));
    return { ...current, events: events.map(event => ({ id: event.id, action: event.action, revision: event.revision,
      createdAt: event.createdAt.toISOString(), actorName: names.get(event.actorId) ?? null, reason: event.reason })) };
  }

  async intentOptions(query: RecruitmentDemandIntentOptionsQueryDto, user: AuthUser) {
    const actor = await assertRecruitmentReader(this.prisma, user);
    const origins: Prisma.RecruitmentDemandWhereInput[] = [{ sourceKind: 'local', approvedById: { not: null }, submittedById: { not: null } }];
    if (this.sourceStatus().configured) origins.push({ sourceKind: 'dingtalk', ...this.sourceStatus().scope! });
    const where: Prisma.RecruitmentDemandWhereInput = { AND: [this.keyword(query.keyword), { OR: origins }],
      ...(query.deptId ? { deptId: query.deptId } : {}), sourceState: 'approved', syncIssue: null,
      supersededByInstanceId: null, mappedFingerprint: { equals: this.prisma.recruitmentDemand.fields.sourceFingerprint }, approvedHeadcount: { gt: 0 },
      department: { is: { isActive: true } }, position: { is: { isActive: true, ...(query.positionName ? { name: query.positionName.trim() } : {}) } } };
    const [rows, total] = await Promise.all([
      this.prisma.recruitmentDemand.findMany({ where, include: directoryInclude, orderBy: [{ approvedAt: 'desc' }, { id: 'asc' }], skip: query.skip, take: query.take }),
      this.prisma.recruitmentDemand.count({ where }),
    ]);
    return { items: rows.map(row => this.view(row, undefined, actor)), total, page: query.page, pageSize: query.pageSize };
  }

  async assertIntent(tx: Prisma.TransactionClient, id: string, application: ApplicationReference, user: AuthUser) {
    await this.lock(tx);
    await this.editorAfterLock(tx, user);
    const reference = await this.get(tx, id);
    if (reference.deptId) await tx.$queryRaw`SELECT id FROM departments WHERE id = ${reference.deptId}::uuid FOR SHARE`;
    if (reference.positionId) await tx.$queryRaw`SELECT id FROM positions WHERE id = ${reference.positionId}::uuid FOR SHARE`;
    const issues = this.issues(await this.get(tx, id), application);
    if (issues.length) throw new BadRequestException(issues.join('；'));
  }

  async currentIntent(tx: Prisma.TransactionClient, id: string | null, actor: RecruitmentActor) {
    if (!id || !canReadRecruitmentDemand(actor)) return null;
    const row = await tx.recruitmentDemand.findUnique({ where: { id }, include: directoryInclude });
    return row ? this.view(row, undefined, actor) : null;
  }

  async currentForApplication(tx: Prisma.TransactionClient, application: { recruitmentDemandId: string | null; stage: string; hiringRequestedById: string | null }, actor: RecruitmentActor) {
    if (!canReadTalentApplication(actor, application)) throw new ForbiddenException('无权限查看此应聘记录');
    if (!application.recruitmentDemandId) return null;
    const row = await tx.recruitmentDemand.findUnique({ where: { id: application.recruitmentDemandId }, include: directoryInclude });
    if (!row) return null;
    const full = this.view(row, undefined, actor);
    if (canReadRecruitmentDemand(actor)) return (await attachRecruitmentDemandSeats(tx, [full]))[0];
    const { id, revision, sourceKind, instanceId, deptId, departmentName, positionId, positionName, approvedHeadcount,
      sourceState, usable, issues, approvedAt, sourceLink, lastSyncedAt } = full;
    return (await attachRecruitmentDemandSeats(tx, [{ id, revision, sourceKind, instanceId, deptId, departmentName, positionId, positionName,
      approvedHeadcount, sourceState, usable, issues, approvedAt, sourceLink, lastSyncedAt }]))[0];
  }

  private async get(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.recruitmentDemand.findUnique({ where: { id }, include: directoryInclude });
    if (!row) throw new NotFoundException('招聘需求不存在');
    return row;
  }

  private revision(row: Demand, expected: number) {
    if (!Number.isInteger(expected) || row.revision !== expected) throw new ConflictException('招聘需求版本已变化，请重新核对并选择');
  }

  private assertLocal(row: Demand) {
    if (row.sourceKind !== 'local') throw new BadRequestException('只能办理系统创建的招聘需求，钉钉需求请在原流程处理');
  }

  private localFields(input: Partial<CreateLocalRecruitmentDemandDto>, row?: Demand) {
    const deptId = input.deptId !== undefined ? input.deptId : row?.deptId;
    const positionId = input.positionId !== undefined ? input.positionId : row?.positionId;
    const headcount = input.headcount !== undefined ? input.headcount : row?.requestedHeadcount;
    const reason = input.reason !== undefined ? input.reason : row?.requestReason;
    if (typeof deptId !== 'string' || !deptId || typeof positionId !== 'string' || !positionId
      || !Number.isInteger(headcount) || headcount! < 1 || headcount! > 2147483647
      || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) throw new BadRequestException('请填写有效部门、岗位、正整数需求人数和申请原因');
    return { deptId: deptId.toLowerCase(), positionId: positionId.toLowerCase(), headcount: headcount!, reason: reason.trim() };
  }

  private localFingerprint(fields: ReturnType<RecruitmentDemandsService['localFields']>) {
    return createHash('sha256').update(JSON.stringify([fields.deptId, fields.positionId, fields.headcount, fields.reason])).digest('hex');
  }

  private async localCatalog(tx: Prisma.TransactionClient, fields: { deptId: string; positionId: string }) {
    await tx.$queryRaw`SELECT id FROM departments WHERE id = ${fields.deptId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM positions WHERE id = ${fields.positionId}::uuid FOR SHARE`;
    const department = await tx.department.findUnique({ where: { id: fields.deptId }, select: { isActive: true } });
    const position = await tx.position.findUnique({ where: { id: fields.positionId }, select: { isActive: true } });
    if (!department?.isActive || !position?.isActive) throw new BadRequestException('请选择启用的HRM部门和岗位');
  }

  async createLocal(input: CreateLocalRecruitmentDemandDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx); const actor = await this.editorAfterLock(tx, user);
      const fields = this.localFields(input), fingerprint = this.localFingerprint(fields);
      const existing = await tx.recruitmentDemand.findUnique({ where: { localRequestId: input.requestId }, include: directoryInclude });
      if (existing) {
        if (existing.createdById !== actor.id) throw new ForbiddenException('本次创建请求不属于当前经办人');
        if (existing.localCreationFingerprint !== fingerprint) throw new ConflictException('本次创建请求已用于其他需求内容，请恢复原请求或重新创建');
        return (await attachRecruitmentDemandSeats(tx, [this.view(existing, undefined, actor)]))[0];
      }
      await this.localCatalog(tx, fields);
      const row = await tx.recruitmentDemand.create({ data: { sourceKind: 'local', sourceState: 'draft', localRequestId: input.requestId,
        localCreationFingerprint: fingerprint, sourceFingerprint: fingerprint, deptId: fields.deptId, positionId: fields.positionId,
        requestedHeadcount: fields.headcount, requestReason: fields.reason, createdById: actor.id }, include: directoryInclude });
      await this.record(tx, row, actor.id, 'local_create', fields.reason);
      return (await attachRecruitmentDemandSeats(tx, [this.view(row, undefined, actor)]))[0];
    }, transactionOptions);
  }

  async updateLocal(id: string, input: UpdateLocalRecruitmentDemandDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx); const actor = await this.editorAfterLock(tx, user);
      const row = await this.get(tx, id); this.assertLocal(row); this.revision(row, input.expectedRevision);
      if (!['draft', 'rejected'].includes(row.sourceState)) throw new BadRequestException('仅草稿或已退回的系统创建需求可修改，已提交或已批准的内容不可覆盖');
      const fields = this.localFields(input, row); await this.localCatalog(tx, fields);
      const updated = await tx.recruitmentDemand.update({ where: { id }, data: { deptId: fields.deptId, positionId: fields.positionId,
        requestedHeadcount: fields.headcount, requestReason: fields.reason, sourceFingerprint: this.localFingerprint(fields), revision: row.revision + 1 }, include: directoryInclude });
      await this.record(tx, updated, actor.id, 'local_update', fields.reason);
      return (await attachRecruitmentDemandSeats(tx, [this.view(updated, undefined, actor)]))[0];
    }, transactionOptions);
  }

  async actLocal(id: string, input: LocalRecruitmentDemandActionDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx);
      const review = ['approve', 'return', 'submit_approve'].includes(input.action);
      const actor = review ? await this.reviewerAfterLock(tx, user) : await this.editorAfterLock(tx, user);
      const row = await this.get(tx, id); this.assertLocal(row); this.revision(row, input.expectedRevision);
      if (input.action === 'submit_approve' && (!canEditRecruitment(actor) || row.createdById !== actor.id)) throw new ForbiddenException('只有具备审核资格的创建人可提交并通过本人创建的需求');
      if (review && row.submittedById === actor.id && row.createdById !== actor.id) throw new ForbiddenException('不能审核本人提交且由他人创建的需求');
      if (input.action === 'submit') await this.assertReviewAvailable(tx, row.createdById, actor.id);
      if (!this.localActions(row, actor).includes(input.action)) throw new BadRequestException('当前系统创建需求的状态不支持此操作');
      const reason = input.reason?.trim() || null;
      if ((['return', 'withdraw'].includes(input.action) && !reason) || (reason && reason.length > 1000)) throw new BadRequestException('请填写明确的退回或撤回原因，最多1000字');
      const data: Prisma.RecruitmentDemandUncheckedUpdateInput = { revision: row.revision + 1 };
      if (['submit', 'approve', 'submit_approve'].includes(input.action)) {
        const fields = this.localFields({}, row); await this.localCatalog(tx, fields);
        if (this.localFingerprint(fields) !== row.sourceFingerprint) throw new ConflictException('系统创建需求的内容版本不一致，请重新核对');
      }
      if (input.action === 'submit') Object.assign(data, { sourceState: 'pending', submittedById: actor.id, approvalMode: null });
      if (input.action === 'approve' || input.action === 'submit_approve') Object.assign(data, { sourceState: 'approved', approvedById: actor.id, approvedAt: new Date(),
        approvedHeadcount: row.requestedHeadcount, mappedFingerprint: row.sourceFingerprint,
        approvalMode: input.action === 'submit_approve' || row.submittedById === actor.id ? 'self_created' : 'independent',
        ...(input.action === 'submit_approve' ? { submittedById: actor.id } : {}) });
      if (input.action === 'return') data.sourceState = 'rejected';
      if (input.action === 'withdraw') data.sourceState = 'withdrawn';
      const updated = await tx.recruitmentDemand.update({ where: { id }, data, include: directoryInclude });
      await this.record(tx, updated, actor.id, `local_${input.action}`, reason);
      return (await attachRecruitmentDemandSeats(tx, [this.view(updated, undefined, actor)]))[0];
    }, transactionOptions);
  }

  async map(id: string, input: MapRecruitmentDemandDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx);
      const actor = await this.editorAfterLock(tx, user);
      const row = await this.get(tx, id); this.revision(row, input.expectedRevision);
      if (row.sourceKind === 'local') throw new BadRequestException('系统创建的招聘需求不使用钉钉来源映射，请通过系统内需求操作办理');
      this.requireSource();
      if (!this.inScope(row)) throw new BadRequestException('需求不属于当前已配置的组织和表单');
      if (row.sourceState !== 'approved' || row.syncIssue || row.supersededByInstanceId) throw new BadRequestException('请先同步并核对已批准且有效的招聘需求');
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (!reason || reason.length > 1000 || !Number.isInteger(input.approvedHeadcount) || input.approvedHeadcount < 1 || input.approvedHeadcount > 2147483647) throw new BadRequestException('请填写明确的核对依据和正整数批准人数');
      const explicitCount = /^(\d+)\s*(?:人|名)?$/.exec(row.rawHeadcount?.trim() ?? '');
      if (explicitCount && Number(explicitCount[1]) !== input.approvedHeadcount) throw new BadRequestException('确认人数必须与原单明确批准人数一致');
      await tx.$queryRaw`SELECT id FROM departments WHERE id = ${input.deptId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM positions WHERE id = ${input.positionId}::uuid FOR SHARE`;
      const department = await tx.department.findUnique({ where: { id: input.deptId }, select: { id: true, isActive: true } });
      const position = await tx.position.findUnique({ where: { id: input.positionId }, select: { id: true, isActive: true } });
      if (!department?.isActive || !position?.isActive) throw new BadRequestException('请选择启用的HRM部门和岗位');
      const updated = await tx.recruitmentDemand.update({ where: { id }, data: { deptId: department.id, positionId: position.id, approvedHeadcount: input.approvedHeadcount,
        mappedFingerprint: row.sourceFingerprint, revision: row.revision + 1 }, include: directoryInclude });
      await this.record(tx, updated, actor.id, 'map', reason);
      return (await attachRecruitmentDemandSeats(tx, [this.view(updated)]))[0];
    }, transactionOptions);
  }

  async prepareSubmission(id: string | undefined, expectedRevision: number | undefined, user: AuthUser) {
    await assertRecruitmentEditor(this.prisma, user);
    if (!id || expectedRevision === undefined) throw new BadRequestException('提交录用前请选择已批准并核对的招聘需求');
    const reference = await this.get(this.prisma, id);
    this.revision(reference, expectedRevision);
    if (reference.sourceKind === 'local') {
      const issues = this.issues(reference);
      if (issues.length) throw new BadRequestException(issues.join('；'));
      const proof: RecruitmentDemandSubmissionProof = Object.freeze({ sourceKind: 'local' as const, demandId: reference.id, revision: reference.revision,
        sourceFingerprint: reference.sourceFingerprint, actorId: user.id, organizationKey: null, processCode: null, verifiedAt: new Date().toISOString() });
      this.submissionProofs.add(proof);
      return proof;
    }
    const source = this.requireSource();
    if (!reference.instanceId) throw new ServiceUnavailableException('钉钉来源实例标识缺失，不能提交录用');
    const instanceId = reference.instanceId;
    if (!this.inScope(reference)) throw new BadRequestException('需求不属于当前已配置的组织和表单');
    const priorIssues = this.issues(reference);
    if (priorIssues.length) throw new BadRequestException(priorIssues.join('；'));
    let verification: RecruitmentDemandVerification;
    let verifiedAt: string;
    try {
      if (!source.verifyForSubmission) throw new Error('Fresh verification unavailable');
      verification = await source.verifyForSubmission(instanceId);
      if (!verification || !Array.isArray(verification.relatedSources) || verification.relatedSources.length > 500
        || !['complete', 'unproven'].includes(verification.replacementCoverage)
        || !Number.isFinite(Date.parse(verification.checkedAt)) || Date.now() - Date.parse(verification.checkedAt) > 15000
        || Date.parse(verification.checkedAt) > Date.now()) throw new Error('Invalid verification');
      verifiedAt = verification.checkedAt;
      for (const item of [verification.source, ...verification.relatedSources]) {
        const normalized = this.normalize(item, item === verification.source ? instanceId : item.instanceId);
        if (!this.inScope(normalized)) throw new Error('Verification scope mismatch');
      }
    } catch {
      await this.prisma.$transaction(async tx => {
        await this.lock(tx); const actor = await this.editorAfterLock(tx, user);
        const current = await this.get(tx, id);
        if (current.revision === reference.revision) await this.markIssue(tx, current, actor.id, 'submission_verification_failed');
      }, transactionOptions);
      throw new ServiceUnavailableException('未能核验钉钉需求当前状态，尚未提交录用。请核对取数权限或重新刷新需求后重试。');
    }
    // Remote IO is complete before taking the shared ledger lock or application transaction.
    const current = await this.prisma.$transaction(async tx => {
      await this.lock(tx); const actor = await this.editorAfterLock(tx, user);
      const row = await this.get(tx, id); this.revision(row, reference.revision);
      if (!this.inScope(row)) throw new ConflictException('招聘需求来源配置已变化，请重新核对');
      await this.readAndStore(tx, instanceId, actor.id, row, verification.source);
      for (const related of verification.relatedSources) {
        if (related.status === 'approved' && related.supersedesInstanceId) await this.readAndStore(tx, related.instanceId, actor.id, undefined, related);
      }
      const refreshed = await this.get(tx, id);
      if (verification.replacementCoverage !== 'complete') await this.markIssue(tx, refreshed, actor.id, 'replacement_verification_incomplete');
      return this.get(tx, id);
    }, transactionOptions);
    if (verification.replacementCoverage !== 'complete') throw new ServiceUnavailableException('需求后续更正核验未完成，尚未提交录用。请联系应用维护人员核对表单读取范围和核验记录，再刷新需求重试。');
    this.revision(current, expectedRevision);
    const issues = this.issues(current);
    if (issues.length) throw new BadRequestException(issues.join('；'));
    const proof: RecruitmentDemandSubmissionProof = Object.freeze({ sourceKind: 'dingtalk' as const, demandId: current.id, revision: current.revision,
      sourceFingerprint: current.sourceFingerprint, actorId: user.id, organizationKey: current.organizationKey, processCode: current.processCode,
      verifiedAt });
    this.submissionProofs.add(proof);
    return proof;
  }

  async assertSubmission(tx: Prisma.TransactionClient, application: ApplicationReference, id: string | undefined, expectedRevision: number | undefined, user: AuthUser, proof?: RecruitmentDemandSubmissionProof) {
    if (!id || expectedRevision === undefined) throw new BadRequestException('提交录用前请选择已批准并核对的招聘需求');
    await this.lock(tx);
    await this.editorAfterLock(tx, user);
    const reference = await this.get(tx, id);
    const local = reference.sourceKind === 'local';
    if (!local) this.requireSource();
    if (reference.deptId) await tx.$queryRaw`SELECT id FROM departments WHERE id = ${reference.deptId}::uuid FOR SHARE`;
    if (reference.positionId) await tx.$queryRaw`SELECT id FROM positions WHERE id = ${reference.positionId}::uuid FOR SHARE`;
    const row = await this.get(tx, id);
    this.revision(row, expectedRevision);
    const issues = this.issues(row, application);
    if (issues.length) throw new BadRequestException(issues.join('；'));
    if (!proof || !this.submissionProofs.has(proof) || proof.sourceKind !== (local ? 'local' : 'dingtalk')
      || proof.demandId !== id || proof.actorId !== user.id || proof.revision !== row.revision
      || proof.sourceFingerprint !== row.sourceFingerprint || proof.organizationKey !== row.organizationKey || proof.processCode !== row.processCode
      || (!local && (Date.now() - Date.parse(proof.verifiedAt) > 15000 || Date.parse(proof.verifiedAt) > Date.now()))) {
      throw new ConflictException('提交前需求核验已失效，请刷新核对后重新提交，填写内容已保留。');
    }
    this.submissionProofs.delete(proof);
    const snapshot: RecruitmentDemandSubmissionSnapshot = { sourceKind: local ? 'local' : 'dingtalk', demandId: row.id, revision: row.revision, instanceId: row.instanceId,
      departmentId: row.deptId!, departmentName: row.department!.name, positionId: row.positionId!, positionName: row.position!.name,
      approvedHeadcount: row.approvedHeadcount!, approvedAt: row.approvedAt?.toISOString() ?? null, sourceLink: row.sourceLink,
      syncedAt: row.lastSyncedAt?.toISOString() ?? null, ...(!local ? { verifiedAt: proof.verifiedAt } : {}) };
    return { id: row.id, revision: row.revision, snapshot };
  }

  private normalize(source: RecruitmentDemandSource, requestedId: string) {
    const text = (value: unknown, max: number, required = false) => {
      if (value == null && !required) return null;
      if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid source field');
      return value.trim() || null;
    };
    const date = (value: unknown) => {
      if (value == null) return null;
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid source date');
      return new Date(value);
    };
    if (!source || source.instanceId !== requestedId || !['pending', 'approved', 'rejected', 'withdrawn', 'unknown'].includes(source.status)) throw new Error('Unverified source identity or state');
    const sourceLink = text(source.sourceLink, 2000);
    if (sourceLink && !/^https:\/\//i.test(sourceLink)) throw new Error('Unsafe source link');
    const supersedesInstanceId = source.status === 'approved' ? text(source.supersedesInstanceId, 200) : null;
    if (supersedesInstanceId === requestedId) throw new Error('Invalid supersession');
    return { organizationKey: text(source.organizationKey, 200, true)!, processCode: text(source.processCode, 200, true)!, instanceId: requestedId,
      sourceState: source.status, rawDepartment: text(source.rawDepartment, 4000), rawPosition: text(source.rawPosition, 4000), rawHeadcount: text(source.rawHeadcount, 4000),
      approvedAt: date(source.approvedAt), sourceCreatedAt: date(source.sourceCreatedAt), sourceUpdatedAt: date(source.sourceUpdatedAt), sourceLink,
      mainInstanceId: text(source.mainInstanceId, 200), bizAction: text(source.bizAction, 50), supersedesInstanceId };
  }

  private async record(tx: Prisma.TransactionClient, row: Demand, actorId: string, action: string, reason: string | null = null) {
    const snapshot = { ...this.view(row), sourceFingerprint: row.sourceFingerprint, mappedFingerprint: row.mappedFingerprint,
      supersedesInstanceId: row.supersedesInstanceId, supersededByInstanceId: row.supersededByInstanceId, syncIssue: row.syncIssue,
      processCode: row.processCode, mainInstanceId: row.mainInstanceId, bizAction: row.bizAction,
      sourceCreatedAt: row.sourceCreatedAt?.toISOString() ?? null, sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null };
    await tx.recruitmentDemandEvent.create({ data: { demandId: row.id, actorId, action, revision: row.revision, snapshot, reason } });
    await tx.auditLog.create({ data: { userId: actorId, action: `recruitment_demand_${action}`, entityType: 'recruitment_demand', entityId: row.id,
      newValue: { revision: row.revision, sourceState: row.sourceState, sourceFingerprint: row.sourceFingerprint, syncIssue: row.syncIssue } } });
  }

  private async markIssue(tx: Prisma.TransactionClient, row: Demand, actorId: string, issue: string) {
    if (row.syncIssue === issue) return;
    const updated = await tx.recruitmentDemand.update({ where: { id: row.id }, data: { syncIssue: issue, revision: row.revision + 1 }, include: directoryInclude });
    await this.record(tx, updated, actorId, 'sync_failed');
  }

  private async readAndStore(tx: Prisma.TransactionClient, instanceId: string, actorId: string, expected?: Demand, verifiedSource?: RecruitmentDemandSource) {
    if (expected?.sourceKind === 'local') throw new BadRequestException('系统创建的招聘需求不读取钉钉来源');
    let source: ReturnType<RecruitmentDemandsService['normalize']>;
    try {
      source = this.normalize(verifiedSource ?? await this.requireSource().readInstance(instanceId), instanceId);
      if (!this.inScope(source)) throw new Error('Source scope mismatch');
      if (expected && (expected.organizationKey !== source.organizationKey || expected.processCode !== source.processCode)) throw new Error('Source scope changed');
    } catch {
      const scope = this.sourceStatus().scope;
      const rows = expected ? [expected] : scope ? await tx.recruitmentDemand.findMany({ where: { sourceKind: 'dingtalk', instanceId, ...scope }, include: directoryInclude }) : [];
      for (const row of rows) await this.markIssue(tx, row, actorId, 'source_unavailable');
      return null;
    }
    const row = await tx.recruitmentDemand.findUnique({ where: { organizationKey_instanceId: { organizationKey: source.organizationKey, instanceId } }, include: directoryInclude });
    if (row && (row.sourceKind === 'local' || row.processCode !== source.processCode)) return null;
    // A terminal rejection/withdrawal or verified replacement cannot be undone by an old upstream response.
    if (row && ['withdrawn', 'rejected'].includes(row.sourceState) && source.sourceState !== row.sourceState) {
      return tx.recruitmentDemand.update({ where: { id: row.id }, data: { lastSyncedAt: new Date() }, include: directoryInclude });
    }
    source.supersedesInstanceId = row?.supersedesInstanceId ?? source.supersedesInstanceId;
    const fingerprint = createHash('sha256').update(JSON.stringify(source)).digest('hex');
    const replacement = await tx.recruitmentDemand.findFirst({ where: { sourceKind: 'dingtalk', organizationKey: source.organizationKey, processCode: source.processCode, supersedesInstanceId: instanceId }, include: directoryInclude });
    const supersededByInstanceId = row?.supersededByInstanceId ?? replacement?.instanceId ?? null;
    let updated: Demand;
    if (row && row.sourceFingerprint === fingerprint && row.supersededByInstanceId === supersededByInstanceId) {
      updated = await tx.recruitmentDemand.update({ where: { id: row.id }, data: { lastSyncedAt: new Date(),
        ...(row.syncIssue ? { syncIssue: null, revision: row.revision + 1 } : {}) }, include: directoryInclude });
      if (row.syncIssue) await this.record(tx, updated, actorId, 'sync');
    } else {
      const data = { sourceKind: 'dingtalk', ...source, sourceFingerprint: fingerprint, supersededByInstanceId, syncIssue: null, mappedFingerprint: null, lastSyncedAt: new Date() };
      updated = row ? await tx.recruitmentDemand.update({ where: { id: row.id }, data: { ...data, revision: row.revision + 1 }, include: directoryInclude })
        : await tx.recruitmentDemand.create({ data, include: directoryInclude });
      await this.record(tx, updated, actorId, 'sync');
    }
    if (source.supersedesInstanceId) {
      const predecessor = await tx.recruitmentDemand.findUnique({ where: { organizationKey_instanceId: { organizationKey: source.organizationKey, instanceId: source.supersedesInstanceId } }, include: directoryInclude });
      if (predecessor && predecessor.sourceKind !== 'local' && predecessor.processCode === source.processCode && !predecessor.supersededByInstanceId) {
        const retired = await tx.recruitmentDemand.update({ where: { id: predecessor.id }, data: { supersededByInstanceId: instanceId, mappedFingerprint: null, revision: predecessor.revision + 1 }, include: directoryInclude });
        await this.record(tx, retired, actorId, 'superseded');
      }
    }
    return updated;
  }

  async refresh(id: string, user: AuthUser) {
    const row = await this.prisma.$transaction(async tx => {
      await this.lock(tx);
      const actor = await this.editorAfterLock(tx, user);
      const current = await this.get(tx, id);
      if (current.sourceKind === 'local') throw new BadRequestException('系统创建的招聘需求不使用钉钉刷新，请通过系统内需求操作办理');
      this.requireSource();
      if (!this.inScope(current)) throw new BadRequestException('不能刷新当前来源范围之外的历史需求');
      if (!current.instanceId) throw new ServiceUnavailableException('钉钉来源实例标识缺失');
      return this.readAndStore(tx, current.instanceId, actor.id, current);
    }, transactionOptions);
    if (!row) throw new ServiceUnavailableException('需求来源刷新失败，旧依据已保留并标记待核对');
    return (await attachRecruitmentDemandSeats(this.prisma, [this.view(row)]))[0];
  }

  async sync(input: SyncRecruitmentDemandsDto, user: AuthUser) {
    await assertRecruitmentEditor(this.prisma, user);
    this.assertSyncRange(input);
    const started = Date.now();
    const run = await this.prisma.$transaction(async tx => {
      await this.lock(tx); const actor = await this.editorAfterLock(tx, user);
      this.requireSource();
      const existing = input.cursor ? await tx.recruitmentDemandSyncRun.findUnique({ where: { id: input.cursor } })
        : input.requestId ? await tx.recruitmentDemandSyncRun.findUnique({ where: { requestId: input.requestId } }) : null;
      if (existing) { this.assertSyncIntent(existing, input, actor.id); return existing; }
      if (input.cursor) throw new NotFoundException('同步批次不存在');
      const scope = this.sourceStatus().scope!;
      const created = await tx.recruitmentDemandSyncRun.create({ data: { requestId: input.requestId ?? randomUUID(), actorId: actor.id,
        ...scope, from: input.from, to: input.to } });
      await this.syncAudit(tx, created, 'start', { state: 'listing' });
      return created;
    }, transactionOptions);

    const ready = await this.discoverSyncRun(run.id, input, user);
    if (!ready) throw new ServiceUnavailableException({ message: '需求目录未完整同步，旧依据已保留并标记待核对，请恢复本次同步', cursor: run.id, requestId: run.requestId });
    const attempted: string[] = [];
    while (attempted.length < maxSyncInstances && Date.now() - started < syncBudgetMs) {
      const itemId = await this.prisma.$transaction(async tx => {
        await this.lock(tx); const actor = await this.editorAfterLock(tx, user);
        const current = await tx.recruitmentDemandSyncRun.findUniqueOrThrow({ where: { id: run.id } });
        this.assertSyncIntent(current, input, actor.id);
        const item = await tx.recruitmentDemandSyncItem.findFirst({ where: { runId: run.id, state: { in: ['pending', 'failed'] }, id: { notIn: attempted } },
          orderBy: [{ state: 'desc' }, { ordinal: 'asc' }] });
        if (!item) return null;
        const row = await this.readAndStore(tx, item.instanceId, actor.id);
        await tx.recruitmentDemandSyncItem.update({ where: { id: item.id }, data: { state: row ? 'succeeded' : 'failed', attempts: item.attempts + 1, lastAttemptAt: new Date() } });
        await this.syncAudit(tx, current, 'item', { ordinal: item.ordinal, state: row ? 'succeeded' : 'failed', attempts: item.attempts + 1 });
        return item.id;
      }, transactionOptions);
      if (!itemId) break;
      attempted.push(itemId);
    }
    return this.prisma.$transaction(async tx => {
      await this.lock(tx); const actor = await this.editorAfterLock(tx, user);
      const current = await tx.recruitmentDemandSyncRun.findUniqueOrThrow({ where: { id: run.id } });
      this.assertSyncIntent(current, input, actor.id);
      const outstanding = await tx.recruitmentDemandSyncItem.findMany({ where: { runId: run.id, state: { in: ['pending', 'failed'] } }, select: { instanceId: true, state: true } });
      const pendingIds = outstanding.filter(item => item.state === 'pending').map(item => item.instanceId);
      for (const row of await tx.recruitmentDemand.findMany({ where: { sourceKind: 'dingtalk', organizationKey: current.organizationKey, processCode: current.processCode,
        instanceId: { in: pendingIds }, sourceState: { notIn: ['withdrawn', 'rejected'] } }, include: directoryInclude })) await this.markIssue(tx, row, actor.id, 'incomplete_sync');
      const synced = await tx.recruitmentDemandSyncItem.count({ where: { runId: run.id, state: 'succeeded' } });
      const failed = outstanding.filter(item => item.state === 'failed').length, remaining = outstanding.length, complete = remaining === 0;
      if (complete && current.state !== 'complete') {
        await tx.recruitmentDemandSyncRun.update({ where: { id: run.id }, data: { state: 'complete', completedAt: new Date() } });
        await this.syncAudit(tx, current, 'complete', { synced });
      }
      return { synced, failed, remaining, complete, cursor: complete ? null : run.id, requestId: current.requestId, limit: maxSyncInstances };
    }, transactionOptions);
  }

  private assertSyncIntent(run: RecruitmentDemandSyncRun, input: SyncRecruitmentDemandsDto, actorId: string) {
    this.requireSource();
    if (run.actorId !== actorId || !this.inScope(run)) throw new ForbiddenException('同步批次不属于当前账号或当前来源范围');
    if (run.from !== input.from || run.to !== input.to || (input.requestId && run.requestId !== input.requestId.toLowerCase())) throw new ConflictException('同步请求已用于其他时间范围或批次，请恢复原请求');
  }

  private async syncAudit(tx: Prisma.TransactionClient, run: RecruitmentDemandSyncRun, action: string, newValue: Prisma.InputJsonObject) {
    await tx.auditLog.create({ data: { userId: run.actorId, action: `recruitment_demand_sync_${action}`, entityType: 'recruitment_demand_sync', entityId: run.id, newValue } });
  }

  private async discoverSyncRun(id: string, input: SyncRecruitmentDemandsDto, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx); const actor = await this.editorAfterLock(tx, user);
      const run = await tx.recruitmentDemandSyncRun.findUniqueOrThrow({ where: { id } });
      this.assertSyncIntent(run, input, actor.id);
      if (run.listSealedAt) return run;
      let listing: { instanceIds: string[]; complete: boolean };
      try { listing = await this.requireSource().listIds({ from: run.from, to: run.to }); }
      catch (error) {
        if (error instanceof BadRequestException && error.message === 'RECRUITMENT_RANGE_INVALID') throw error;
        listing = { instanceIds: [], complete: false };
      }
      const scope = { organizationKey: run.organizationKey, processCode: run.processCode };
      if (!listing.complete || !Array.isArray(listing.instanceIds) || listing.instanceIds.some(value => typeof value !== 'string' || !value || value.length > 200)) {
        for (const row of await tx.recruitmentDemand.findMany({ where: { sourceKind: 'dingtalk', ...scope, sourceState: { notIn: ['withdrawn', 'rejected'] } }, include: directoryInclude })) await this.markIssue(tx, row, actor.id, 'incomplete_sync');
        await tx.recruitmentDemandSyncRun.update({ where: { id }, data: { state: 'listing_failed' } });
        await this.syncAudit(tx, run, 'listing_failed', { state: 'listing_failed' });
        return null;
      }
      const existing = await tx.recruitmentDemand.findMany({ where: { sourceKind: 'dingtalk', ...scope }, orderBy: [{ lastSyncedAt: 'asc' }, { id: 'asc' }], select: { instanceId: true, sourceState: true } });
      const known = new Set(existing.map(row => row.instanceId));
      const ids = [...new Set([...listing.instanceIds.filter(instanceId => !known.has(instanceId)), ...existing.filter(row => row.instanceId && !['withdrawn', 'rejected'].includes(row.sourceState)).map(row => row.instanceId!)])];
      if (ids.length) await tx.recruitmentDemandSyncItem.createMany({ data: ids.map((instanceId, ordinal) => ({ runId: id, instanceId, ordinal })) });
      const ready = await tx.recruitmentDemandSyncRun.update({ where: { id }, data: { state: 'ready', listSealedAt: new Date() } });
      await this.syncAudit(tx, run, 'listed', { total: ids.length });
      return ready;
    }, transactionOptions);
  }

  private assertSyncRange(input: SyncRecruitmentDemandsDto) {
    const invalid = () => new BadRequestException('同步范围须为有效日期或含时区时间，且跨度小于366天');
    const boundary = (value: string, end: boolean) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw invalid();
      const calendar = value.slice(0, 10), midnight = Date.parse(`${calendar}T00:00:00Z`);
      if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== calendar) throw invalid();
      // The upstream contract interprets date-only ranges as whole China calendar days.
      const parsed = Date.parse(value.length === 10 ? `${value}T${end ? '23:59:59.999' : '00:00:00'}+08:00` : value);
      if (!Number.isFinite(parsed)) throw invalid();
      return parsed;
    };
    const from = boundary(input.from, false), to = boundary(input.to, true);
    if (to < from || to - from >= 366 * 86400000) throw invalid();
  }
}
