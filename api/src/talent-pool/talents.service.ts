import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { paginated, type Paginated } from '@/common/dto/pagination.dto';
import { TALENT_PHONE_EXISTS, TALENT_STATUS_LABELS } from './talent.constants';
import { TalentQueryDto } from './dto/talent-query.dto';
import { CreateTalentDto } from './dto/create-talent.dto';
import { UpdateTalentDto } from './dto/update-talent.dto';
import { createHash } from 'crypto';
import { DeleteTalentDto } from './dto/talent-interview.dto';
import { talentEditVersion } from './talent-edit-version';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { salaryWrite, serializeTalentSalary, talentSalaryWhere } from './talent-salary';
import { talentApplicationFilter } from './talent-application-filter';
import { buildTalentWorkbook, TALENT_EXPORT_MAX_ROWS } from './talents.excel';
import { talentEmploymentStatus, type TalentEmploymentStatus } from './talent-employment';
import { canEditRecruitment, canReadRecruitment, canWriteRecruitment, isCurrentRecruitmentActor, talentOwnerWhere } from './talent-recruitment-policy';
import { talentDemographicsWrite } from './talent-demographics-write';
import { hasHrCapability } from '@/auth/hr-capabilities';

const onboardingSummary = {
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
  select: { id: true, onboardingStatus: true, recordStatus: true, cancelledAt: true },
} satisfies Prisma.EmployeeDataChangeRequestFindManyArgs;

const applicationSummary = {
  orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  select: { id: true, candidateId: true, positionName: true, recruitmentBatch: true, departmentNameSnapshot: true,
    ownerId: true, stage: true, revision: true, expectedEntryDate: true, createdAt: true, updatedAt: true,
    onboardingRequests: onboardingSummary },
} satisfies Prisma.TalentApplicationFindManyArgs;

const listInclude = {
  _count: { select: { files: true } },
  applications: { ...applicationSummary, take: 1 },
  onboardingRequests: onboardingSummary,
} satisfies Prisma.TalentCandidateInclude;

/** 列表查询行（含附件计数）。 */
type CandidateRow = Prisma.TalentCandidateGetPayload<{ include: typeof listInclude }>;
type ApplicationSummary = Prisma.TalentApplicationGetPayload<typeof applicationSummary>;
type OnboardingSummary = Prisma.EmployeeDataChangeRequestGetPayload<typeof onboardingSummary>;

/** 列表项展示候选人当前跟进安排和附件数。 */
export type TalentListItem = Omit<CandidateRow, '_count' | 'applications' | 'onboardingRequests'> & {
  editVersion: string;
  nextFollowUpAt: Date | null;
  fileCount: number;
  ownerName: string | null;
  latestApplication: Omit<ApplicationSummary, 'onboardingRequests'> & { ownerName: string | null; onboardingRequest: OnboardingSummary | null } | null;
  onboardingRequest: OnboardingSummary | null;
  expectSalaryMinYuan: number | null;
  expectSalaryMaxYuan: number | null;
  salaryNeedsReview: boolean;
  employmentStatus: TalentEmploymentStatus | null;
};

const KEYWORD_FIELDS = ['name', 'phone', 'currentCompany', 'currentPosition', 'appliedPosition'] as const;
const listOrder = [{ updatedAt: 'desc' }, { id: 'desc' }] satisfies Prisma.TalentCandidateOrderByWithRelationInput[];

@Injectable()
export class TalentsService {
  constructor(private readonly prisma: PrismaService) {}

  async assertRead(operator: AuthUser) {
    if (!operator?.id) throw new ForbiddenException('无权限查看招聘资料');
    const actor = await this.prisma.user.findUnique({ where: { id: operator.id }, select: {
      id: true, sysRole: true, hrCapabilities: true, status: true,
      archivedAt: true, deletedAt: true, isAssessorOnly: true,
    } });
    if (!actor || !isCurrentRecruitmentActor(actor) || !canReadRecruitment(actor)) throw new ForbiddenException('无权限查看招聘资料');
    return actor;
  }

  private async assertWriter(tx: Prisma.TransactionClient, operator: AuthUser, permission: 'edit' | 'manage' = 'manage') {
    if (!operator?.id) throw new ForbiddenException('无权限维护人才资料');
    // Hold the current actor while writing; permission revocation then has a defined order.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${operator.id}::uuid FOR SHARE`;
    const actor = await tx.user.findUnique({ where: { id: operator.id }, select: {
      id: true, sysRole: true, hrCapabilities: true, status: true,
      archivedAt: true, deletedAt: true, isAssessorOnly: true,
    } });
    if (!actor || !(permission === 'edit' ? canEditRecruitment(actor) : canWriteRecruitment(actor))) throw new ForbiddenException('当前无权限维护人才资料，请保留输入并联系管理员');
  }

  async list(query: TalentQueryDto, operator?: AuthUser): Promise<Paginated<TalentListItem>> {
    if (operator) await this.assertRead(operator);
    const { where, applicationWhere } = this.buildFilters(query, operator);
    const { total, items } = await this.prisma.$transaction(async tx => {
      const total = await tx.talentCandidate.count({ where });
      const page = await tx.talentCandidate.findMany({
        where,
        orderBy: listOrder,
        skip: query.skip,
        take: query.take,
        include: { ...listInclude, applications: { ...listInclude.applications, where: applicationWhere } },
      });
      return { total, items: await this.attachNextFollowUp(page, tx) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const summaries = await this.attachEmployment(await this.attachRecruitmentSummaries(items));
    const rows = summaries.map(({ _count, applications: _applications, ...item }, index) => ({
      ...serializeTalentSalary(item),
      editVersion: talentEditVersion(items[index]),
      fileCount: _count.files,
    }));
    return paginated(rows as TalentListItem[], total, query);
  }

  async applicationPositions(operator?: AuthUser): Promise<string[]> {
    if (operator) await this.assertRead(operator);
    const rows = await this.prisma.talentApplication.findMany({ where: { candidate: { deletedAt: null } },
      select: { positionName: true }, distinct: ['positionName'], orderBy: { positionName: 'asc' } });
    return rows.map(row => row.positionName);
  }

  /** One row per matching application; candidates without applications retain one row without application filters. */
  async exportApplications(query: TalentQueryDto, operator: AuthUser): Promise<StreamableFile> {
    const actor = await this.assertRead(operator);
    if (!hasHrCapability(actor, 'employee_archive_edit') && !hasHrCapability(actor, 'employee_archive_review')) {
      throw new ForbiddenException('无权限导出人才应聘记录');
    }
    const { where, applicationWhere, responsibilityScope } = this.buildFilters(query, operator);
    const items = await this.prisma.$transaction(async tx => {
      const applicationCount = await tx.talentApplication.count({ where: { candidate: where, ...applicationWhere } });
      const withoutApplications = applicationWhere ? 0 : await tx.talentCandidate.count({ where: { AND: [where, { applications: { none: {} } }] } });
      if (applicationCount + withoutApplications > TALENT_EXPORT_MAX_ROWS) throw new BadRequestException(`导出超过${TALENT_EXPORT_MAX_ROWS}行，请缩小筛选范围`);
      const rows = await tx.talentCandidate.findMany({ where, orderBy: listOrder, select: {
        id: true, name: true, phone: true, ownerId: true, createdById: true, status: true, convertedUserId: true, sourceChannel: true, tags: true,
        appliedPosition: true, currentCompany: true, currentPosition: true, yearsOfExperience: true, education: true,
        school: true, major: true, expectCity: true, expectSalaryMin: true, expectSalaryMax: true, expectSalaryUnit: true, updatedAt: true,
        applications: { ...applicationSummary, where: applicationWhere, select: { ...applicationSummary.select,
          events: { where: { action: 'reserve' }, select: { reserveReasons: true } },
        } },
      } });
      return this.attachNextFollowUp(rows.map(row => ({ ...row, applications: row.applications.map(({ events, ...application }) => ({
        ...application, reserveReasons: [...new Set((events ?? []).flatMap(event => event.reserveReasons))],
      })) })), tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const candidates = await this.attachEmployment(await this.attachRecruitmentSummaries(items));
    const rowCount = candidates.reduce((count, item) => count + Math.max(1, item.applications.length), 0);
    const workbook = buildTalentWorkbook(candidates);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.prisma.auditLog.create({ data: { userId: operator.id, action: 'export_talent_applications', entityType: 'talent_application_export',
      newValue: { candidateCount: candidates.length, rowCount, filters: {
        keywordApplied: Boolean(query.keyword), applicationPositionApplied: Boolean(query.applicationPosition), applicationStage: query.applicationStage ?? null,
        status: query.status ?? null, source: query.source ?? null, tag: query.tag ?? null,
        salaryFilterApplied: [query.salaryMin, query.salaryMax, query.salaryMinYuan, query.salaryMaxYuan].some(value => value != null),
        dueOnly: Boolean(query.dueOnly), staleOnly: Boolean(query.staleOnly), mineOnly: responsibilityScope === 'talent', responsibilityScope,
      } } } });
    const filename = encodeURIComponent(`人才应聘记录-${new Date().toISOString().slice(0, 10)}.xlsx`);
    return new StreamableFile(buffer, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="talent-applications.xlsx"; filename*=UTF-8''${filename}` });
  }

  private buildFilters(query: TalentQueryDto, operator?: AuthUser) {
    const where: Prisma.TalentCandidateWhereInput = { deletedAt: null };
    const and: Prisma.TalentCandidateWhereInput[] = [];
    if (query.keyword) {
      where.OR = KEYWORD_FIELDS.map((field) => ({
        [field]: { contains: query.keyword, mode: 'insensitive' },
      })) as Prisma.TalentCandidateWhereInput[];
    }
    if (query.status) where.status = query.status;
    if (query.source) where.sourceChannel = query.source;
    if (query.tag) where.tags = { has: query.tag };
    const responsibilityScope = query.responsibilityScope ?? (query.mineOnly ? 'talent' : 'all');
    if (responsibilityScope !== 'all' && !operator?.id) throw new BadRequestException('筛选我的负责范围需要当前登录人');
    const applicationWhere = talentApplicationFilter(query, responsibilityScope === 'application' ? operator?.id : undefined);
    if (applicationWhere) and.push({ applications: { some: applicationWhere } });
    const salary = talentSalaryWhere(query);
    if (salary) and.push(salary);
    if (query.dueOnly) and.push({ OR: [
      { followUps: { none: {} } },
      { followUps: { some: { planStatus: 'pending' } } },
    ] });
    if (query.staleOnly) and.push(this.staleWhere());
    if (query.staleOnly) {
      and.push({ status: { notIn: ['hired', 'rejected'] } });
      and.push({ OR: [
        { applications: { none: {} } },
        { applications: { some: { stage: { notIn: ['hired', 'rejected', 'declined', 'withdrawn'] } } } },
      ] });
    }
    if (responsibilityScope === 'talent' && operator) {
      and.push({ OR: [{ ownerId: operator.id }, { ownerId: null, createdById: operator.id }] });
    }
    if (and.length > 0) where.AND = and;
    return { where, applicationWhere, responsibilityScope };
  }

  private staleWhere(): Prisma.TalentCandidateWhereInput {
    const boundary = new Date();
    boundary.setMonth(boundary.getMonth() - 18);
    const day = boundary.toISOString().slice(0, 10);
    return {
      OR: [
        { lastFollowUpAt: { lt: new Date(day) } },
        { AND: [{ lastFollowUpAt: null }, { createdAt: { lt: new Date(`${day}T00:00:00.000Z`) } }] },
      ],
    };
  }

  /** 仅查询本页或本次导出人才的当前安排。 */
  private async attachNextFollowUp<T extends { id: string }>(items: T[], client: Prisma.TransactionClient): Promise<Array<T & { nextFollowUpAt: Date | null }>> {
    if (items.length === 0) return items.map((item) => ({ ...item, nextFollowUpAt: null }));
    const rows = await client.$queryRaw<Array<{ candidate_id: string; next_follow_up_at: Date | null }>>`
      SELECT candidate_id, next_follow_up_at
      FROM talent_follow_ups
      WHERE plan_status = 'pending' AND candidate_id IN (${Prisma.join(items.map(item => Prisma.sql`${item.id}::uuid`))})
    `;
    const byId = new Map(rows.map((row) => [row.candidate_id, row.next_follow_up_at]));
    return items.map((item) => ({ ...item, nextFollowUpAt: byId.get(item.id) ?? null }));
  }

  async detail(id: string, operator?: AuthUser) {
    const actor = operator ? await this.assertRead(operator) : undefined;
    const candidate = await this.prisma.talentCandidate.findFirst({
      where: { id, deletedAt: null },
      include: {
        files: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        followUps: { orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] },
        shares: { orderBy: { createdAt: 'desc' } },
        applications: applicationSummary,
        onboardingRequests: onboardingSummary,
      },
    });
    if (!candidate) throw new NotFoundException('候选人不存在或已删除');
    const shares = actor && !canWriteRecruitment(actor) ? [] : candidate.shares;
    const recipientIds = [...new Set(shares.flatMap((share) => share.recipientIds))];
    const recipients = recipientIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(recipients.map((user) => [user.id, user.name]));
    const [summary] = await this.attachEmployment(await this.attachRecruitmentSummaries([candidate]));
    return {
      ...serializeTalentSalary(summary),
      editVersion: talentEditVersion(candidate),
      shares: shares.map((share) => ({
        ...share,
        recipientNames: share.recipientIds.map((recipientId) => nameById.get(recipientId) ?? '已删除用户'),
      })),
    };
  }

  private async attachEmployment<T extends { convertedUserId?: string | null; status?: string }>(items: T[]) {
    const ids = [...new Set(items.map(item => item.convertedUserId).filter((id): id is string => Boolean(id)))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } },
      select: { id: true, status: true, deletedAt: true, archivedAt: true } }) : [];
    const employees = new Map(users.map(user => [user.id, user]));
    return items.map(item => ({ ...item, employmentStatus: !item.convertedUserId && item.status === 'hired'
      ? 'unknown' as const : talentEmploymentStatus(item.convertedUserId, employees.get(item.convertedUserId ?? '')) }));
  }

  private async attachRecruitmentSummaries<T extends {
    ownerId?: string | null; createdById?: string;
    applications?: ApplicationSummary[]; onboardingRequests?: OnboardingSummary[];
  }>(items: T[]) {
    const ownerIds = [...new Set(items.flatMap(item => [item.ownerId ?? item.createdById,
      ...(item.applications ?? []).map(application => application.ownerId)]).filter((id): id is string => Boolean(id)))];
    const owners = ownerIds.length ? await this.prisma.user.findMany({
      where: { id: { in: ownerIds } }, select: { id: true, name: true },
    }) : [];
    const names = new Map(owners.map(owner => [owner.id, owner.name]));
    return items.map(({ onboardingRequests, applications: sourceApplications, ...item }) => {
      const ownerId = item.ownerId ?? item.createdById ?? null;
      const applications = (sourceApplications ?? []).map(({ onboardingRequests: requests, ...application }) => ({
        ...application, ownerName: names.get(application.ownerId) ?? null, onboardingRequest: requests?.[0] ?? null,
      }));
      return { ...item, ownerId, ownerName: ownerId ? names.get(ownerId) ?? null : null,
        applications, latestApplication: applications[0] ?? null, onboardingRequest: onboardingRequests?.[0] ?? null };
    });
  }

  async checkPhone(phone: string, operator?: AuthUser) {
    if (operator) await this.assertRead(operator);
    const normalized = phone.trim();
    if (!/^1\d{10}$/.test(normalized)) throw new BadRequestException('手机号格式不正确');
    const existing = await this.prisma.talentCandidate.findFirst({
      where: { phone: normalized, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (!existing) return { exists: false };
    return {
      exists: true,
      candidate: { ...existing, statusLabel: TALENT_STATUS_LABELS[existing.status as keyof typeof TALENT_STATUS_LABELS] ?? existing.status },
    };
  }

  async create(input: CreateTalentDto, operator: AuthUser) {
    if (input.status === 'hired' || input.userId) {
      throw new BadRequestException('新建记录不能直接标记为已入职，请先入库再办理');
    }
    const salary = salaryWrite(input);
    const duplicate = await this.findByPhone(input.phone);
    if (duplicate) this.throwPhoneExists(duplicate.id, duplicate.name);
    try {
      const candidate = await this.prisma.$transaction(async tx => {
        return this.createInTransaction(tx, input, operator);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      return { ...serializeTalentSalary(candidate), editVersion: talentEditVersion(candidate) };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.findByPhone(input.phone);
        if (existing) this.throwPhoneExists(existing.id, existing.name);
      }
      throw error;
    }
  }

  /** Explicit client reuse for source confirmation; never opens a nested transaction. */
  async createInTransaction(tx: Prisma.TransactionClient, input: CreateTalentDto, operator: AuthUser) {
        if (input.status === 'hired' || input.userId) throw new BadRequestException('新建记录不能直接标记为已入职，请先入库再办理');
        const salary = salaryWrite(input);
        await this.assertWriter(tx, operator, 'edit');
        const ownerId = input.ownerId ?? operator.id;
        await this.assertOwner(ownerId, tx);
        const education = await this.resolveEducation(input, tx);
        return tx.talentCandidate.create({
        data: {
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          gender: input.gender ?? 'unknown',
          birthYear: input.birthYear ?? null,
          ...talentDemographicsWrite(input),
          currentCompany: input.currentCompany || null,
          currentPosition: input.currentPosition || null,
          yearsOfExperience: input.yearsOfExperience ?? null,
          education: input.education || null,
          ...education,
          ownerId,
          school: input.school || null,
          major: input.major || null,
          expectCity: input.expectCity || null,
          ...salary,
          sourceChannel: input.sourceChannel,
          appliedPosition: input.appliedPosition || null,
          status: input.status ?? 'new',
          tags: input.tags ?? [],
          note: input.note || null,
          createdById: operator.id,
        },
        });
  }

  async update(id: string, input: UpdateTalentDto, operator: AuthUser) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Share the arrival/deletion row lock before reading any validation inputs.
        await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${id}::uuid FOR UPDATE`;
        await this.assertWriter(tx, operator, 'edit');
        const before = await tx.talentCandidate.findFirst({ where: { id, deletedAt: null },
          include: { files: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
            followUps: { orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] } } });
        if (!before) throw new NotFoundException('候选人不存在或已删除');
        if (!input.editVersion || input.editVersion !== talentEditVersion(before)) {
          throw new ConflictException({ message: '人才资料已更新，请保留当前输入，重新加载最新资料后再修改',
            data: { reason: 'TALENT_EDIT_CONFLICT' } });
        }
        if (input.status !== undefined) this.assertStatusTransition(before.status, input.status);
        if (input.userId !== undefined || (input.status === 'hired' && before.status !== 'hired')) {
          throw new BadRequestException('请通过入离职办理并确认到岗，不支持手动关联员工');
        }
        const salary = salaryWrite(input, before);
        const nextPhone = input.phone ?? before.phone;
        if (nextPhone !== before.phone) {
          const duplicate = await this.findByPhone(nextPhone, tx);
          if (duplicate) this.throwPhoneExists(duplicate.id, duplicate.name);
        }
        const { status, userId: _ignoredUserId, editVersion: _editVersion, ...rest } = input;
        const ownerChanged = input.ownerId !== undefined && input.ownerId !== (before.ownerId ?? before.createdById);
        if (ownerChanged) await this.assertOwner(input.ownerId!, tx);
        const education = await this.resolveEducation(input, tx, before);
        const data: Prisma.TalentCandidateUncheckedUpdateInput = {
          ...this.buildUpdateData(rest, operator, before),
          ...salary,
          ...education,
          ...(ownerChanged ? { ownerId: input.ownerId } : {}),
          ...(status !== undefined ? { status } : {}),
        };
        const changedFields = Object.keys(data).filter(field => field !== 'updatedById'
          && JSON.stringify(data[field] ?? null) !== JSON.stringify(before[field] ?? null)).sort();
        if (!changedFields.length) return { ...serializeTalentSalary(before), editVersion: talentEditVersion(before) };
        const candidate = await tx.talentCandidate.update({
          where: { id },
          data: { ...data, updatedAt: new Date(Math.max(Date.now(), (before.updatedAt?.getTime() ?? 0) + 1)) },
          include: { files: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
            followUps: { orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] } },
        });
        await tx.auditLog.create({ data: { userId: operator.id, action: 'update_talent_candidate',
          entityType: 'talent_candidate', entityId: id, newValue: { changedFields } } });
        return { ...serializeTalentSalary(candidate), editVersion: talentEditVersion(candidate) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (this.isUniqueViolation(error) && input.phone !== undefined) {
        const existing = await this.findByPhone(input.phone);
        if (existing) this.throwPhoneExists(existing.id, existing.name);
      }
      throw error;
    }
  }

  /** 软删除：列表/详情/分享全部不可见，手机号可复用，不删对象存储。 */
  async remove(id: string, operator: AuthUser, input: DeleteTalentDto = {}) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${id}::uuid FOR UPDATE`;
      await this.assertWriter(tx, operator);
      const before = await tx.talentCandidate.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('候选人不存在或已删除');
      if (before.deletedAt) return { id, deleted: true };
      const impact = await this.readDeleteImpact(tx, id, before);
      if (input.impactVersion !== impact.version || (impact.requiresForce && input.force !== true)) {
        throw new ConflictException({ message: '请核对最新关联影响后再次确认删除', data: { reason: 'TALENT_DELETE_IMPACT_CHANGED', impact } });
      }
      await tx.talentCandidate.update({ where: { id }, data: { deletedAt: new Date(), updatedById: operator.id } });
      await tx.auditLog.create({ data: {
        userId: operator.id, action: 'delete_talent_candidate', entityType: 'talent_candidate', entityId: id,
        oldValue: { status: before.status },
        newValue: { deleted: true, forced: input.force === true, impactVersion: impact.version,
          interviewIds: impact.interviews.map((row) => row.id), requestIds: impact.requests.map((row) => row.id) },
      } });
      return { id, deleted: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async deleteImpact(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${id}::uuid FOR UPDATE`;
      const candidate = await tx.talentCandidate.findUnique({ where: { id } });
      if (!candidate || candidate.deletedAt) throw new NotFoundException('候选人不存在或已删除');
      return this.readDeleteImpact(tx, id, candidate);
    });
  }

  private async readDeleteImpact(tx: Prisma.TransactionClient, id: string, candidate: { updatedAt: Date; status: string }) {
    const interviews = await tx.talentInterview.findMany({ where: { candidateId: id, status: 'scheduled' },
      select: { id: true, status: true, version: true, startsAt: true }, orderBy: { id: 'asc' } });
    const requests = await tx.employeeDataChangeRequest.findMany({ where: { talentCandidateId: id, archivedAt: null, cancelledAt: null,
      onboardingStatus: { in: ['draft', 'submitted', 'pending_entry'] } },
      select: { id: true, recordStatus: true, onboardingStatus: true, requestVersion: true, updatedAt: true }, orderBy: { id: 'asc' } });
    const version = createHash('sha256').update(JSON.stringify({ id, updatedAt: candidate.updatedAt, status: candidate.status, interviews, requests })).digest('hex');
    return { candidateId: id, version, interviews, requests, requiresForce: interviews.length + requests.length > 0 };
  }

  /** 供 T4/T5 复用：取未软删候选人，不存在抛 404。 */
  async findActive(id: string) {
    const candidate = await this.prisma.talentCandidate.findFirst({ where: { id, deletedAt: null } });
    if (!candidate) throw new NotFoundException('候选人不存在或已删除');
    return candidate;
  }

  // ── 状态流转与转员工（T4） ─────────────────────────────────────────────────

  /** 已入职为终态（需求 §8）：只允许维护其他资料，不允许回退状态。 */
  private assertStatusTransition(from: string, to: string) {
    if (from === 'hired' && to !== 'hired') {
      throw new ConflictException('已入职为终态，不能回退状态；请保留当前输入，刷新后修改其他资料');
    }
  }

  /** Legacy endpoint retained with an explicit business error; arrival confirmation owns linkage. */
  async convert(id: string, userId: string, operator: AuthUser, extra?: Omit<UpdateTalentDto, 'status' | 'userId'>) {
    throw new BadRequestException('请通过入离职办理并确认到岗，不支持手动关联员工');
  }

  private buildUpdateData(input: Omit<UpdateTalentDto, 'status' | 'userId'>, operator: AuthUser,
    before: { birthYear?: number | null; birthMonth?: number | null; reportedAge?: number | null; reportedAgeRecordedAt?: Date | null }): Prisma.TalentCandidateUpdateInput {
    return {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email || null } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      ...(input.birthYear !== undefined ? { birthYear: input.birthYear } : {}),
      ...talentDemographicsWrite(input, before),
      ...(input.currentCompany !== undefined ? { currentCompany: input.currentCompany || null } : {}),
      ...(input.currentPosition !== undefined ? { currentPosition: input.currentPosition || null } : {}),
      ...(input.yearsOfExperience !== undefined ? { yearsOfExperience: input.yearsOfExperience } : {}),
      ...(input.education !== undefined ? { education: input.education || null } : {}),
      ...(input.school !== undefined ? { school: input.school || null } : {}),
      ...(input.major !== undefined ? { major: input.major || null } : {}),
      ...(input.expectCity !== undefined ? { expectCity: input.expectCity || null } : {}),
      ...(input.sourceChannel !== undefined ? { sourceChannel: input.sourceChannel } : {}),
      ...(input.appliedPosition !== undefined ? { appliedPosition: input.appliedPosition || null } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.note !== undefined ? { note: input.note || null } : {}),
      updatedById: operator.id,
    };
  }

  private async assertOwner(id: string, tx: Prisma.TransactionClient) {
    const owner = id && await tx.user.findFirst({
      where: { ...talentOwnerWhere(), id }, select: { id: true },
    });
    if (!owner) throw new BadRequestException('负责人须为当前在职或试用、具备招聘经办权限的人员');
  }

  private async resolveEducation(input: Pick<CreateTalentDto, 'education' | 'educationReferenceDataId'>,
    tx: Prisma.TransactionClient, before?: { educationReferenceDataId: string | null; education: string | null }) {
    const id = input.educationReferenceDataId;
    if (before && (id === undefined || id === before.educationReferenceDataId)
      && (input.education === undefined || input.education === before.education)) return {};
    if (id == null && input.education === undefined) return id === null ? { educationReferenceDataId: null } : {};
    const name = input.education?.trim();
    if (id == null && !name) return { educationReferenceDataId: null, education: null };
    const option = await tx.personnelReferenceData.findFirst({
      where: { kind: 'education', isActive: true, ...(id ? { id } : { name }) }, select: { id: true, name: true },
    });
    if (!option) {
      const message = '请选择有效的学历基础资料';
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message,
        data: { fieldErrors: { educationReferenceDataId: message } } });
    }
    return { educationReferenceDataId: option.id, education: option.name };
  }

  // ── 简历文件（T3） ─────────────────────────────────────────────────────────

  countFiles(candidateId: string): Promise<number> {
    return this.prisma.talentResumeFile.count({ where: { candidateId } });
  }

  createFileRecord(candidateId: string, data: {
    objectKey: string; fileName: string; mimeType: string; fileSize: number;
    sortOrder: number; uploadedById: string;
  }) {
    return this.prisma.talentResumeFile.create({ data: { candidateId, ...data } });
  }

  findFile(candidateId: string, fileId: string) {
    return this.prisma.talentResumeFile.findFirst({ where: { id: fileId, candidateId } });
  }

  async deleteFileRecord(fileId: string, operator: AuthUser) {
    const reference = await this.prisma.talentResumeFile.findUnique({ where: { id: fileId }, select: { candidateId: true } });
    if (!reference) throw new NotFoundException('简历文件不存在');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${reference.candidateId}::uuid FOR UPDATE`;
      await this.assertWriter(tx, operator, 'edit');
      const candidate = await tx.talentCandidate.findFirst({ where: { id: reference.candidateId, deletedAt: null }, select: { id: true } });
      if (!candidate) throw new NotFoundException('候选人不存在或已删除');
      const file = await tx.talentResumeFile.findUnique({ where: { id: fileId } });
      if (!file || file.candidateId !== reference.candidateId) throw new NotFoundException('简历文件不存在');
      await tx.talentResumeFile.delete({ where: { id: fileId } });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'delete_talent_resume_file',
          entityType: 'talent_resume_file',
          entityId: fileId,
          oldValue: file
            ? { candidateId: file.candidateId, objectKey: file.objectKey, fileName: file.fileName } as Prisma.InputJsonValue
            : undefined,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async findByPhone(phone: string, client: Prisma.TransactionClient = this.prisma) {
    return client.talentCandidate.findFirst({
      where: { phone: phone.trim(), deletedAt: null },
      select: { id: true, name: true },
    });
  }

  private throwPhoneExists(existingId: string, existingName: string): never {
    throw new ConflictException({
      message: `该手机号已在库：${existingName}`,
      data: { reason: TALENT_PHONE_EXISTS, existingId, existingName },
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
