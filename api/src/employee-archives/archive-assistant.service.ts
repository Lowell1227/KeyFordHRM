import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountType, Prisma, UserStatus } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { EmployeeArchivesService } from './employee-archives.service';
import { approvedEmploymentSourceWhere, shanghaiBusinessDate } from './employment-timeline';

export const ARCHIVE_ASSISTANT_SOURCE = 'archive_assistant_pilot';
const SAMPLE = { employeeName: '【测试】档案助手样例', workLocation: '杭州（测试资料）' };
const SAMPLE_HASH = createHash('sha256').update(JSON.stringify(SAMPLE)).digest('hex');
const TTL = 10 * 60 * 1000;
interface PreviewClaim { v: number; actor: string; event: string; binding: string; sample: string; exp: number }
export interface ArchiveAssistantSource { corpId: string; senderStaffId: string; conversationId: string; deliveryId: string }

@Injectable()
export class ArchiveAssistantService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly archives: EmployeeArchivesService) {}

  private async assertAccess(client: Prisma.TransactionClient | PrismaService, viewer: AuthUser) {
    if (this.config.get<string>('ARCHIVE_ASSISTANT_PILOT_ENABLED') !== 'true') throw new ForbiddenException('档案助手试用尚未启用');
    const actor = await client.user.findUnique({ where: { id: viewer.id } });
    if (!actor || actor.employeeNo !== '312' || actor.accountType !== AccountType.employee || actor.deletedAt || actor.archivedAt
      || ![UserStatus.active, UserStatus.probation].includes(actor.status as any) || !hasHrCapability(actor, 'employee_archive_edit')) {
      throw new ForbiddenException('当前账号不可使用档案助手试用');
    }
    const today = shanghaiBusinessDate();
    const employment = await client.employmentRecord.findFirst({ where: { userId: actor.id, effectiveFrom: { lte: today },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }], AND: [approvedEmploymentSourceWhere] },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], select: { employeeStatus: true } });
    if (!employment || ![UserStatus.active, UserStatus.probation].includes(employment.employeeStatus as any)) throw new ForbiddenException('当前无有效任职');
    const binding = await client.externalIdentityBinding.findFirst({ where: { userId: actor.id, provider: 'dingtalk', status: 'enabled', endedAt: null },
      orderBy: { boundAt: 'desc' }, select: { id: true, externalUserId: true } });
    if (!binding?.externalUserId) throw new ForbiddenException('钉钉身份绑定已失效');
    return { actor, binding };
  }

  private signature(data: string) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new ForbiddenException('档案助手试用配置未就绪');
    return createHmac('sha256', secret).update(data).digest();
  }

  private decode(token: string, viewer: AuthUser): PreviewClaim {
    const invalid = () => new BadRequestException('预览已失效，请在钉钉重新获取');
    if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
    const [data, signed] = token.split('.'), expected = this.signature(data), actual = Buffer.from(signed, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
    let claim: PreviewClaim;
    try { claim = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch { throw invalid(); }
    if (!claim || claim.v !== 1 || claim.actor !== viewer.id || !/^[a-f0-9]{64}$/.test(claim.event)
      || typeof claim.binding !== 'string' || claim.sample !== SAMPLE_HASH || !Number.isSafeInteger(claim.exp)
      || claim.exp <= Date.now() || claim.exp > Date.now() + TTL) throw invalid();
    return claim;
  }

  async prepare(viewer: AuthUser, source: ArchiveAssistantSource): Promise<{ url: string }> {
    const { binding } = await this.assertAccess(this.prisma, viewer);
    if (Object.values(source).some(value => typeof value !== 'string' || !value || value.length > 256)
      || !source.corpId || !source.senderStaffId || !source.conversationId || !source.deliveryId || source.senderStaffId !== binding.externalUserId) {
      throw new ForbiddenException('资料来源身份无效');
    }
    const event = createHash('sha256').update(JSON.stringify([source.corpId, source.senderStaffId, source.conversationId, source.deliveryId])).digest('hex');
    const claim: PreviewClaim = { v: 1, actor: viewer.id, event, binding: binding.id, sample: SAMPLE_HASH, exp: Date.now() + TTL };
    const data = Buffer.from(JSON.stringify(claim)).toString('base64url');
    const token = `${data}.${this.signature(data).toString('base64url')}`;
    return { url: `/archive-assistant/preview/${event}#preview=${token}` };
  }

  private saved(request: { id: string; requestVersion: number; recordStatus: string }, replayed: boolean) {
    return { requestId: request.id, requestVersion: request.requestVersion, recordStatus: request.recordStatus,
      url: `/users?assistantRequestId=${request.id}`, replayed };
  }

  private async received(client: Prisma.TransactionClient | PrismaService, claim: PreviewClaim) {
    const sameEvent = await client.employeeDataChangeRequest.findUnique({ where: { sourceSystem_sourceReference: {
      sourceSystem: ARCHIVE_ASSISTANT_SOURCE, sourceReference: claim.event } } });
    if (sameEvent) {
      if (sameEvent.createdById !== claim.actor) throw new ConflictException('资料来源不一致，请重新核对');
      return sameEvent;
    }
    const alias = await client.employeeDataChangeRequest.findFirst({ where: { sourceSystem: ARCHIVE_ASSISTANT_SOURCE, createdById: claim.actor,
      baseValue: { path: ['assistantEvents'], array_contains: [claim.event] } } });
    if (alias) return alias;
    return client.employeeDataChangeRequest.findFirst({ where: { sourceSystem: ARCHIVE_ASSISTANT_SOURCE, createdById: claim.actor,
      recordStatus: 'draft', archivedAt: null, cancelledAt: null }, orderBy: { createdAt: 'asc' } });
  }

  async preview(token: string, viewer: AuthUser) {
    const claim = this.decode(token, viewer);
    const { binding } = await this.assertAccess(this.prisma, viewer);
    if (binding.id !== claim.binding) throw new ForbiddenException('钉钉身份绑定已变化，请重新获取预览');
    const request = await this.received(this.prisma, claim);
    return { ...SAMPLE, notice: request ? '该资料已接收，请进入原记录查看当前状态' : '尚未保存，正式档案未改变；测试资料仅可保存待核草稿',
      expiresAt: new Date(claim.exp).toISOString(), saved: request ? this.saved(request, true) : null };
  }

  async save(token: string, viewer: AuthUser) {
    const claim = this.decode(token, viewer);
    return this.prisma.$transaction(async tx => {
      // Every pilot writer uses this lock. READ COMMITTED lets a waiter see the preceding committed source.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`archive-assistant:${viewer.id}`}, 0))`;
      const { binding } = await this.assertAccess(tx, viewer);
      if (binding.id !== claim.binding || claim.exp <= Date.now()) throw new ForbiddenException('预览已失效，请重新获取');
      const received = await this.received(tx, claim);
      if (received) {
        const base = received.baseValue && typeof received.baseValue === 'object' && !Array.isArray(received.baseValue)
          ? received.baseValue as Prisma.JsonObject : {};
        const events = Array.isArray(base.assistantEvents) ? base.assistantEvents.filter((event): event is string => typeof event === 'string') : [];
        if (received.sourceReference !== claim.event && !events.includes(claim.event)) {
          if (events.length >= 1000) throw new ConflictException('测试草稿接收次数已达上限，请先归档后重新获取预览');
          const current = await tx.employeeDataChangeRequest.update({ where: { id: received.id }, data: {
            baseValue: { ...base, assistantEvents: [...events, claim.event] } as Prisma.InputJsonValue,
          } });
          return this.saved(current, true);
        }
        return this.saved(received, true);
      }
      const request = await this.archives.saveEmployeeCreateDraftWithClient(tx, {
        name: SAMPLE.employeeName, employee: { workLocation: SAMPLE.workLocation },
      }, viewer, { sourceSystem: ARCHIVE_ASSISTANT_SOURCE, sourceReference: claim.event,
        validationWarnings: [{ field: 'identity', kind: 'identity', message: '虚构测试资料，未绑定真实员工；仅供待核草稿验收' }] });
      return this.saved(request, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
