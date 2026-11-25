import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecruitmentPosting } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { assertRecruitmentEditor } from './talent-recruitment-policy';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import { CreateRecruitmentPostingDto, RecruitmentPostingQueryDto, UpdateRecruitmentPostingDto } from './recruitment-postings.dto';
import type { RecruitmentPostingView } from './recruitment-intakes.types';

export const recruitmentSourceTx = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 };
export async function lockRecruitmentSources(tx: Prisma.TransactionClient, user: AuthUser) {
  // Same order as the demand writer: ledger, then current actor, then business records.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('recruitment-demand-ledger',0))`;
  await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR SHARE`;
  return assertRecruitmentEditor(tx, user);
}
export function sourceFingerprint(value: unknown): string {
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' && !(v instanceof Date)
    ? Object.fromEntries(Object.keys(v).sort().filter(key => v[key] !== undefined).map(key => [key, stable(v[key])])) : v;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export async function sourceOwner(tx: Prisma.TransactionClient, ownerId: string) {
  try { await assertRecruitmentEditor(tx, { id: ownerId } as AuthUser); }
  catch { throw new BadRequestException('请选择当前具备招聘经办权限的负责人'); }
}

@Injectable()
export class RecruitmentPostingsService {
  constructor(private readonly db: PrismaService, private readonly demands: RecruitmentDemandsService) {}

  static normalizeUrl(input: string): string {
    try {
      if (typeof input !== 'string' || input.length > 2000 || /[\u0000-\u0020\u007f]/.test(input)) throw new Error();
      const url = new URL(input);
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw new Error();
      url.hash = '';
      return url.toString();
    } catch { throw new BadRequestException('请填写不含账号密码的完整 HTTPS 职位链接'); }
  }

  private fields(input: CreateRecruitmentPostingDto) {
    if (typeof input.verifiedIdentity !== 'boolean' || (input.active !== undefined && typeof input.active !== 'boolean')) throw new BadRequestException('核对状态须为布尔值');
    const channel = input.channel?.trim().toLowerCase(), name = input.name?.trim();
    const evidence = input.evidence?.trim() || null, externalId = input.externalId?.trim() || null;
    if (!channel || channel.length > 80 || !name || name.length > 200) throw new BadRequestException('请填写渠道及外部职位名称');
    if (input.verifiedIdentity && !evidence) throw new BadRequestException('确认唯一外部职位身份时，请填写核对依据');
    if ((evidence?.length ?? 0) > 2000 || (externalId?.length ?? 0) > 200) throw new BadRequestException('职位身份或核对依据过长');
    return { demandId: input.demandId, channel, name, url: RecruitmentPostingsService.normalizeUrl(input.url), externalId,
      verifiedIdentity: input.verifiedIdentity, evidence, active: input.active ?? true, ownerId: input.ownerId! };
  }

  private async approved(tx: Prisma.TransactionClient, demandId: string, user: AuthUser) {
    // Ledger lock prevents approval withdrawal/synchronization from changing this evidence until commit.
    const view = await this.demands.detail(demandId, user);
    const row = await tx.recruitmentDemand.findUnique({ where: { id: demandId } });
    if (!row || !view.usable || row.revision !== view.revision || row.sourceState !== 'approved' || row.syncIssue) throw new ConflictException('请选择当前有效且已完成核对的获批招聘需求');
  }

  private async event(tx: Prisma.TransactionClient, row: RecruitmentPosting, user: AuthUser, action: string, reason: string | null) {
    const snapshot = { demandId: row.demandId, channel: row.channel, name: row.name, url: row.url, externalId: row.externalId,
      verifiedIdentity: row.verifiedIdentity, active: row.active, ownerId: row.ownerId };
    await tx.recruitmentPostingEvent.create({ data: { postingId: row.id, revision: row.revision, actorId: user.id, action, reason, snapshot } });
    await tx.auditLog.create({ data: { userId: user.id, action, entityType: 'recruitment_posting', entityId: row.id,
      newValue: { revision: row.revision, demandId: row.demandId, changedFields: Object.keys(snapshot) } } });
  }

  private async view(row: RecruitmentPosting, detail = false): Promise<RecruitmentPostingView> {
    const owner = await this.db.user.findUnique({ where: { id: row.ownerId }, select: { name: true } });
    const { id, revision, demandId, channel, name, url, externalId, verifiedIdentity, evidence, active, ownerId } = row;
    const result: RecruitmentPostingView = { id, revision, demandId, channel, name, url, externalId, verifiedIdentity, evidence, active,
      ownerId, ownerName: owner?.name ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    if (detail) {
      const events = await this.db.recruitmentPostingEvent.findMany({ where: { postingId: id }, orderBy: { revision: 'asc' } });
      const names = new Map((await this.db.user.findMany({ where: { id: { in: events.map(event => event.actorId) } }, select: { id: true, name: true } })).map(actor => [actor.id, actor.name]));
      result.events = events.map(event => ({ id: event.id, action: event.action, revision: event.revision, reason: event.reason,
        actorName: names.get(event.actorId) ?? null, createdAt: event.createdAt.toISOString(), snapshot: event.snapshot as Record<string,unknown> }));
    }
    return result;
  }

  async list(query: RecruitmentPostingQueryDto, user: AuthUser) {
    await assertRecruitmentEditor(this.db, user);
    const keyword = query.keyword?.trim();
    const where: Prisma.RecruitmentPostingWhereInput = { ...(query.demandId ? { demandId: query.demandId } : {}), ...(keyword ? { OR:
      ['name', 'channel', 'url', 'externalId'].map(field => ({ [field]: { contains: keyword, mode: 'insensitive' } })) } : {}) };
    const [rows, total] = await this.db.$transaction([this.db.recruitmentPosting.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }), this.db.recruitmentPosting.count({ where })]);
    return { items: await Promise.all(rows.map(row => this.view(row))), total, page: query.page, pageSize: query.pageSize };
  }

  async detail(id: string, user: AuthUser) {
    await assertRecruitmentEditor(this.db, user);
    const row = await this.db.recruitmentPosting.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('外部职位登记不存在');
    return this.view(row, true);
  }

  async create(input: CreateRecruitmentPostingDto, user: AuthUser) {
    try {
      const id = await this.db.$transaction(async tx => {
        await lockRecruitmentSources(tx, user);
        const fields = this.fields({ ...input, ownerId: input.ownerId ?? user.id });
        const fingerprint = sourceFingerprint(fields);
        const existing = await tx.recruitmentPosting.findUnique({ where: { requestId: input.requestId } });
        if (existing) {
          if (existing.createdById !== user.id) throw new ForbiddenException('该新建请求不属于当前经办人');
          if (existing.creationFingerprint !== fingerprint) throw new ConflictException('该新建请求已用于其他内容');
          return existing.id;
        }
        await sourceOwner(tx, fields.ownerId); await this.approved(tx, fields.demandId, user);
        const row = await tx.recruitmentPosting.create({ data: { ...fields, requestId: input.requestId, creationFingerprint: fingerprint, createdById: user.id } });
        await this.event(tx, row, user, 'create_posting', null); return row.id;
      }, recruitmentSourceTx);
      return this.detail(id, user);
    } catch (error) { this.uniqueness(error); }
  }

  async update(id: string, input: UpdateRecruitmentPostingDto, user: AuthUser) {
    try {
      await this.db.$transaction(async tx => {
        await lockRecruitmentSources(tx, user);
        const old = await tx.recruitmentPosting.findUnique({ where: { id } });
        if (!old) throw new NotFoundException('外部职位登记不存在');
        if (old.revision !== input.expectedRevision) throw new ConflictException('外部职位已更新，请保留输入并刷新');
        if (!input.reason?.trim()) throw new BadRequestException('请填写变更原因');
        const fields = this.fields({ ...old, ...input } as CreateRecruitmentPostingDto);
        await sourceOwner(tx, fields.ownerId);
        if (fields.active) await this.approved(tx, fields.demandId, user);
        const row = await tx.recruitmentPosting.update({ where: { id }, data: { ...fields, revision: { increment: 1 }, updatedAt: new Date() } });
        await this.event(tx, row, user, old.demandId !== row.demandId ? 'remap_posting' : 'update_posting', input.reason.trim());
      }, recruitmentSourceTx);
      return this.detail(id, user);
    } catch (error) { this.uniqueness(error); }
  }

  private uniqueness(error: unknown): never {
    if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('该渠道的已核对有效职位已有当前登记，请修改原登记并保留变更依据');
    throw error;
  }
}
