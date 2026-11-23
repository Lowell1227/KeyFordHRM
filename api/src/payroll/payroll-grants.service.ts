import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SysRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { isUUID, validateSync } from 'class-validator';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { PAYROLL_GRANT_CAPABILITIES, PayrollGrantQueryDto, PayrollGrantRevokeDto, PayrollGrantSaveDto } from './dto/payroll-grants.dto';
import { lockPayrollSubject } from './payroll-transaction';

const grantSelect = { id: true, subjectId: true, userId: true, capabilities: true, revokedAt: true, grantedById: true, createdAt: true, updatedAt: true,
  subject: { select: { id: true, name: true, isActive: true } }, user: { select: { id: true, name: true, employeeNo: true } } } satisfies Prisma.PayrollGrantSelect;
type Grant = Prisma.PayrollGrantGetPayload<{ select: typeof grantSelect }>;
export type PayrollGrantRow = Omit<Grant, 'createdAt' | 'updatedAt' | 'revokedAt'> & { createdAt: string; updatedAt: string; revokedAt: string | null };
export interface PayrollGrantOptions {
  subjects: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string; employeeNo: string | null }>;
  capabilities: string[];
}
export interface PayrollGrantEventRow {
  id: string; action: string; actor: { id: string; name: string }; createdAt: string; reason: string;
  oldCapabilities: string[]; newCapabilities: string[];
  previousUpdatedAt: string | null; updatedAt: string; previousRevokedAt: string | null; revokedAt: string | null;
}

@Injectable()
export class PayrollGrantsService {
  constructor(private readonly prisma: PrismaService) {}

  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  private input<T extends object>(type: new () => T, input: unknown): T {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('薪酬授权参数无效');
    const value = plainToInstance(type, input);
    if (validateSync(value, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length) {
      throw new BadRequestException('请核对授权的主体、人员、权限、版本和原因');
    }
    return value;
  }
  private async administrator(tx: Prisma.TransactionClient, actor: AuthUser) {
    if (!actor || !isUUID(actor.id) || actor.isAssessorOnly) throw new ForbiddenException('仅有效系统管理员可维护薪酬授权');
    const current = await tx.user.findUnique({ where: { id: actor.id.toLowerCase() }, select: {
      id: true, sysRole: true, status: true, isAssessorOnly: true, archivedAt: true, deletedAt: true,
    } });
    if (!current || current.sysRole !== SysRole.system_admin || current.status !== 'active' || current.isAssessorOnly || current.archivedAt || current.deletedAt) {
      throw new ForbiddenException('仅有效系统管理员可维护薪酬授权');
    }
    return current;
  }
  private view(row: Grant): PayrollGrantRow {
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null };
  }
  private async lock(tx: Prisma.TransactionClient, subjectId: string, userId: string, actorId: string) {
    // Share both existing domain locks with payroll writers; read state only after waiting.
    await lockPayrollSubject(tx, subjectId, 'formal');
    await lockPayrollSubject(tx, subjectId, 'validation');
    for (const id of [...new Set([userId, actorId.toLowerCase()])].sort()) {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id}::uuid FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT "id" FROM "contract_subjects" WHERE "id" = ${subjectId}::uuid FOR UPDATE`;
  }
  private checkVersion(before: Grant | null, expected: string | null) {
    if (before ? expected !== before.updatedAt.toISOString() : expected !== null) throw new ConflictException('授权记录已更新，请刷新后重试');
  }
  private async audit(tx: Prisma.TransactionClient, before: Grant | null, after: Grant, actor: AuthUser, reason: string, action: 'grant_saved' | 'grant_revoked') {
    await tx.payrollEvent.create({ data: { subjectId: after.subjectId, actorId: actor.id, action, metadata: {
      grantId: after.id, targetUserId: after.userId, reason,
      oldCapabilities: before && !before.revokedAt ? before.capabilities : [], newCapabilities: after.revokedAt ? [] : after.capabilities,
      previousUpdatedAt: before?.updatedAt.toISOString() ?? null, updatedAt: after.updatedAt.toISOString(),
      previousRevokedAt: before?.revokedAt?.toISOString() ?? null, revokedAt: after.revokedAt?.toISOString() ?? null,
    } } });
  }
  private async update(tx: Prisma.TransactionClient, before: Grant, data: Prisma.PayrollGrantUpdateManyMutationInput): Promise<Grant> {
    const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
    const changed = await tx.payrollGrant.updateMany({ where: { id: before.id, updatedAt: before.updatedAt }, data: { ...data, updatedAt } });
    if (changed.count !== 1) throw new ConflictException('授权记录已更新，请刷新后重试');
    return (await tx.payrollGrant.findUnique({ where: { id: before.id }, select: grantSelect }))!;
  }
  private async write<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.transaction(work); }
    catch (error) {
      if (['P2002', 'P2034'].includes((error as { code?: string })?.code ?? '')) throw new ConflictException('授权记录已更新，请刷新后重试');
      throw error;
    }
  }

  async list(input: unknown, actor: AuthUser): Promise<PayrollGrantRow[]> {
    const query = this.input(PayrollGrantQueryDto, input);
    return this.transaction(async tx => {
      await this.administrator(tx, actor);
      const rows = await tx.payrollGrant.findMany({ where: {
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        ...(query.status === 'active' ? { revokedAt: null } : query.status === 'revoked' ? { revokedAt: { not: null } } : {}),
      }, select: grantSelect, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
      return rows.map(row => this.view(row));
    });
  }
  async options(actor: AuthUser): Promise<PayrollGrantOptions> {
    return this.transaction(async tx => {
      await this.administrator(tx, actor);
      const subjects = await tx.contractSubject.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
      const users = await tx.user.findMany({ where: { status: { in: ['active', 'probation'] }, isAssessorOnly: false, deletedAt: null, archivedAt: null },
        select: { id: true, name: true, employeeNo: true }, orderBy: [{ name: 'asc' }, { employeeNo: 'asc' }, { id: 'asc' }] });
      return { subjects, users, capabilities: [...PAYROLL_GRANT_CAPABILITIES] };
    });
  }
  async save(value: unknown, actor: AuthUser): Promise<PayrollGrantRow> {
    const input = this.input(PayrollGrantSaveDto, value);
    return this.write(async tx => {
      await this.administrator(tx, actor);
      await this.lock(tx, input.subjectId, input.userId, actor.id);
      const admin = await this.administrator(tx, actor);
      const subject = await tx.contractSubject.findUnique({ where: { id: input.subjectId }, select: { isActive: true } });
      if (!subject?.isActive) throw new BadRequestException('请选择有效公司目录');
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true, isAssessorOnly: true, deletedAt: true, archivedAt: true } });
      if (!user) throw new NotFoundException('授权人员不存在');
      if (!['active', 'probation'].includes(user.status) || user.isAssessorOnly || user.archivedAt || user.deletedAt) throw new BadRequestException('请选择在职或试用的非评审专用人员');
      const before = await tx.payrollGrant.findUnique({ where: { userId_subjectId: { userId: user.id, subjectId: input.subjectId } }, select: grantSelect });
      this.checkVersion(before, input.expectedUpdatedAt);
      if (user.id === admin.id && (!before || before.revokedAt || input.capabilities.some(capability => !before.capabilities.includes(capability)))) {
        throw new ForbiddenException('不能为自己新增、扩大或恢复薪酬权限');
      }
      const capabilities = PAYROLL_GRANT_CAPABILITIES.filter(capability => input.capabilities.includes(capability));
      const after = before ? await this.update(tx, before, { capabilities, revokedAt: null, grantedById: admin.id })
        : await tx.payrollGrant.create({ data: { subjectId: input.subjectId, userId: user.id, capabilities, grantedById: admin.id, updatedAt: new Date() }, select: grantSelect });
      await this.audit(tx, before, after, actor, input.reason, 'grant_saved');
      return this.view(after);
    });
  }
  async revoke(id: string, value: unknown, actor: AuthUser): Promise<PayrollGrantRow> {
    if (!isUUID(id)) throw new BadRequestException('授权记录标识无效');
    const input = this.input(PayrollGrantRevokeDto, value);
    return this.write(async tx => {
      await this.administrator(tx, actor);
      const identity = await tx.payrollGrant.findUnique({ where: { id: id.toLowerCase() }, select: { subjectId: true, userId: true } });
      if (!identity) throw new NotFoundException('授权记录不存在');
      await this.lock(tx, identity.subjectId, identity.userId, actor.id);
      await this.administrator(tx, actor);
      const before = await tx.payrollGrant.findUnique({ where: { id: id.toLowerCase() }, select: grantSelect });
      if (!before) throw new NotFoundException('授权记录不存在');
      this.checkVersion(before, input.expectedUpdatedAt);
      if (before.revokedAt) throw new ConflictException('授权已撤销，请刷新记录');
      const after = await this.update(tx, before, { revokedAt: new Date() });
      await this.audit(tx, before, after, actor, input.reason, 'grant_revoked');
      return this.view(after);
    });
  }
  async events(id: string, actor: AuthUser): Promise<PayrollGrantEventRow[]> {
    if (!isUUID(id)) throw new BadRequestException('授权记录标识无效');
    return this.transaction(async tx => {
      await this.administrator(tx, actor);
      const grant = await tx.payrollGrant.findUnique({ where: { id: id.toLowerCase() }, select: { id: true, subjectId: true, userId: true } });
      if (!grant) throw new NotFoundException('授权记录不存在');
      const events = await tx.payrollEvent.findMany({ where: { subjectId: grant.subjectId, action: { in: ['grant_saved', 'grant_revoked'] }, AND: [
        { metadata: { path: ['grantId'], equals: grant.id } }, { metadata: { path: ['targetUserId'], equals: grant.userId } },
      ] }, select: { id: true, action: true, actorId: true, createdAt: true, metadata: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const actors = events.length ? await tx.user.findMany({ where: { id: { in: [...new Set(events.map(event => event.actorId))] } }, select: { id: true, name: true } }) : [];
      return events.map(event => {
        const metadata = (event.metadata ?? {}) as Record<string, unknown>;
        const text = (key: string) => typeof metadata[key] === 'string' ? metadata[key] as string : null;
        const caps = (key: string) => Array.isArray(metadata[key]) ? (metadata[key] as unknown[]).filter((cap): cap is string =>
          typeof cap === 'string' && (PAYROLL_GRANT_CAPABILITIES as readonly string[]).includes(cap)) : [];
        return { id: event.id, action: event.action, actor: { id: event.actorId, name: actors.find(person => person.id === event.actorId)?.name ?? '记录不可用' },
          createdAt: event.createdAt.toISOString(), reason: text('reason') ?? '', oldCapabilities: caps('oldCapabilities'), newCapabilities: caps('newCapabilities'),
          previousUpdatedAt: text('previousUpdatedAt'), updatedAt: text('updatedAt') ?? '', previousRevokedAt: text('previousRevokedAt'), revokedAt: text('revokedAt') };
      });
    });
  }
}
