import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

/** 列表查询行（含附件计数）。 */
type CandidateRow = Prisma.TalentCandidateGetPayload<{ include: { _count: { select: { files: true } } } }>;

/** 列表项：候选人 + 最新一条非空「下次跟进日期」+ 附件数（需求 §4.3 / §5.1）。 */
export type TalentListItem = Omit<CandidateRow, '_count'> & {
  nextFollowUpAt: Date | null;
  fileCount: number;
};

const KEYWORD_FIELDS = ['name', 'phone', 'currentCompany', 'currentPosition', 'appliedPosition'] as const;

@Injectable()
export class TalentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: TalentQueryDto): Promise<Paginated<TalentListItem>> {
    const where = await this.buildWhere(query);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.talentCandidate.count({ where }),
      this.prisma.talentCandidate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: { _count: { select: { files: true } } },
      }),
    ]);
    const withDue = await this.attachNextFollowUp(items.map(({ _count, ...item }) => ({
      ...item,
      fileCount: _count.files,
    })));
    return paginated(withDue as TalentListItem[], total, query);
  }

  private async buildWhere(query: TalentQueryDto): Promise<Prisma.TalentCandidateWhereInput> {
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
    if (query.salaryMin !== undefined) and.push({ expectSalaryMax: { gte: query.salaryMin } });
    if (query.salaryMax !== undefined) and.push({ expectSalaryMin: { lte: query.salaryMax } });
    if (query.dueOnly) and.push({ id: { in: await this.dueCandidateIds() } });
    if (query.staleOnly) and.push(this.staleWhere());
    if (and.length > 0) where.AND = and;
    return where;
  }

  /** 「仅看待跟进」：最新一条非空 next_follow_up_at ≤ 今天的候选人（软删范围外）。 */
  private async dueCandidateIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT candidate_id AS id FROM (
        SELECT candidate_id, next_follow_up_at,
               ROW_NUMBER() OVER (PARTITION BY candidate_id ORDER BY occurred_at DESC) AS rn
        FROM talent_follow_ups
        WHERE next_follow_up_at IS NOT NULL
      ) latest
      WHERE rn = 1 AND next_follow_up_at <= CURRENT_DATE
    `;
    return rows.map((row) => row.id);
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

  /** 给列表项补「最新一条非空下次跟进日期」。 */
  private async attachNextFollowUp<T extends { id: string }>(items: T[]): Promise<Array<T & { nextFollowUpAt: Date | null }>> {
    if (items.length === 0) return items.map((item) => ({ ...item, nextFollowUpAt: null }));
    const rows = await this.prisma.$queryRaw<Array<{ candidate_id: string; next_follow_up_at: Date | null }>>`
      SELECT DISTINCT ON (candidate_id) candidate_id, next_follow_up_at
      FROM talent_follow_ups
      WHERE next_follow_up_at IS NOT NULL AND candidate_id::text IN (${Prisma.join(items.map((item) => item.id))})
      ORDER BY candidate_id, occurred_at DESC
    `;
    const byId = new Map(rows.map((row) => [row.candidate_id, row.next_follow_up_at]));
    return items.map((item) => ({ ...item, nextFollowUpAt: byId.get(item.id) ?? null }));
  }

  async detail(id: string) {
    const candidate = await this.prisma.talentCandidate.findFirst({
      where: { id, deletedAt: null },
      include: {
        files: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        followUps: { orderBy: { occurredAt: 'desc' } },
        shares: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!candidate) throw new NotFoundException('候选人不存在或已删除');
    const recipientIds = [...new Set(candidate.shares.flatMap((share) => share.recipientIds))];
    const recipients = recipientIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(recipients.map((user) => [user.id, user.name]));
    return {
      ...candidate,
      shares: candidate.shares.map((share) => ({
        ...share,
        recipientNames: share.recipientIds.map((recipientId) => nameById.get(recipientId) ?? '已删除用户'),
      })),
    };
  }

  async checkPhone(phone: string) {
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
    this.assertSalaryRange(input.expectSalaryMin, input.expectSalaryMax);
    const duplicate = await this.findByPhone(input.phone);
    if (duplicate) this.throwPhoneExists(duplicate.id, duplicate.name);
    try {
      return await this.prisma.talentCandidate.create({
        data: {
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          gender: input.gender ?? 'unknown',
          birthYear: input.birthYear ?? null,
          currentCompany: input.currentCompany || null,
          currentPosition: input.currentPosition || null,
          yearsOfExperience: input.yearsOfExperience ?? null,
          education: input.education || null,
          school: input.school || null,
          major: input.major || null,
          expectCity: input.expectCity || null,
          expectSalaryMin: input.expectSalaryMin ?? null,
          expectSalaryMax: input.expectSalaryMax ?? null,
          sourceChannel: input.sourceChannel,
          appliedPosition: input.appliedPosition || null,
          status: input.status ?? 'new',
          tags: input.tags ?? [],
          note: input.note || null,
          createdById: operator.id,
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.findByPhone(input.phone);
        if (existing) this.throwPhoneExists(existing.id, existing.name);
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateTalentDto, operator: AuthUser) {
    const before = await this.prisma.talentCandidate.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('候选人不存在或已删除');
    if (input.status !== undefined) this.assertStatusTransition(before.status, input.status);
    if (input.userId !== undefined || (input.status === 'hired' && before.status !== 'hired')) {
      throw new BadRequestException('请通过入离职办理并确认到岗，不支持手动关联员工');
    }
    const min = input.expectSalaryMin !== undefined ? input.expectSalaryMin : before.expectSalaryMin;
    const max = input.expectSalaryMax !== undefined ? input.expectSalaryMax : before.expectSalaryMax;
    this.assertSalaryRange(min, max);
    const nextPhone = input.phone ?? before.phone;
    if (nextPhone !== before.phone) {
      const duplicate = await this.findByPhone(nextPhone);
      if (duplicate) this.throwPhoneExists(duplicate.id, duplicate.name);
    }
    const { status, userId: _ignoredUserId, ...rest } = input;
    const data: Prisma.TalentCandidateUpdateInput = {
      ...this.buildUpdateData(rest, operator),
      ...(status !== undefined ? { status } : {}),
    };
    try {
      return await this.prisma.talentCandidate.update({
        where: { id },
        data,
        include: { files: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }, followUps: { orderBy: { occurredAt: 'desc' } } },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.findByPhone(nextPhone);
        if (existing) this.throwPhoneExists(existing.id, existing.name);
      }
      throw error;
    }
  }

  /** 软删除：列表/详情/分享全部不可见，手机号可复用，不删对象存储。 */
  async remove(id: string, operator: AuthUser, input: DeleteTalentDto = {}) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${id}::uuid FOR UPDATE`;
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
    });
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

  /** 已入职为终态（需求 §8）：不允许回退，如需更正请删除后重新入库。 */
  private assertStatusTransition(from: string, to: string) {
    if (from === 'hired' && to !== 'hired') {
      throw new BadRequestException('已入职为终态，如需更正请删除记录后重新入库');
    }
  }

  /** Legacy endpoint retained with an explicit business error; arrival confirmation owns linkage. */
  async convert(id: string, userId: string, operator: AuthUser, extra?: Omit<UpdateTalentDto, 'status' | 'userId'>) {
    throw new BadRequestException('请通过入离职办理并确认到岗，不支持手动关联员工');
  }

  private buildUpdateData(input: Omit<UpdateTalentDto, 'status' | 'userId'>, operator: AuthUser): Prisma.TalentCandidateUpdateInput {
    return {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email || null } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      ...(input.birthYear !== undefined ? { birthYear: input.birthYear } : {}),
      ...(input.currentCompany !== undefined ? { currentCompany: input.currentCompany || null } : {}),
      ...(input.currentPosition !== undefined ? { currentPosition: input.currentPosition || null } : {}),
      ...(input.yearsOfExperience !== undefined ? { yearsOfExperience: input.yearsOfExperience } : {}),
      ...(input.education !== undefined ? { education: input.education || null } : {}),
      ...(input.school !== undefined ? { school: input.school || null } : {}),
      ...(input.major !== undefined ? { major: input.major || null } : {}),
      ...(input.expectCity !== undefined ? { expectCity: input.expectCity || null } : {}),
      ...(input.expectSalaryMin !== undefined ? { expectSalaryMin: input.expectSalaryMin } : {}),
      ...(input.expectSalaryMax !== undefined ? { expectSalaryMax: input.expectSalaryMax } : {}),
      ...(input.sourceChannel !== undefined ? { sourceChannel: input.sourceChannel } : {}),
      ...(input.appliedPosition !== undefined ? { appliedPosition: input.appliedPosition || null } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.note !== undefined ? { note: input.note || null } : {}),
      updatedById: operator.id,
    };
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
    const file = await this.prisma.talentResumeFile.findUnique({ where: { id: fileId } });
    await this.prisma.$transaction([
      this.prisma.talentResumeFile.delete({ where: { id: fileId } }),
      this.prisma.auditLog.create({
        data: {
          userId: operator.id,
          action: 'delete_talent_resume_file',
          entityType: 'talent_resume_file',
          entityId: fileId,
          oldValue: file
            ? { candidateId: file.candidateId, objectKey: file.objectKey, fileName: file.fileName } as Prisma.InputJsonValue
            : undefined,
        },
      }),
    ]);
  }

  private assertSalaryRange(min?: number | null, max?: number | null) {
    if (min != null && max != null && min > max) {
      throw new BadRequestException('期望薪资下限不能高于上限');
    }
  }

  private async findByPhone(phone: string) {
    return this.prisma.talentCandidate.findFirst({
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
