import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { assertPayrollGrant, payrollAccess, PayrollActor, PayrollCapability } from './payroll-access';
import { PayrollDomain, PayrollPurpose } from './payroll-contracts';
import { resolve } from 'node:path';
import { payrollParameterReviewerWhere } from './payroll-parameter-access';
import { isISO8601, isUUID } from 'class-validator';

const FORMAL_PENDING = '正式发薪待首月签收';
const PAYROLL_MONTH = /^[2-9]\d{3}-(0[1-9]|1[0-2])$/;

@Injectable()
export class PayrollAccessService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  enabled(): boolean {
    return this.config.get<string>('PAYROLL_ENABLED') === 'true'
      && (this.config.get<string>('HRM_PREVIEW') === 'true' || this.config.get<string>('PAYROLL_FORMAL_ENABLED') === 'true');
  }
  maintenancePurpose(): PayrollPurpose { return this.config.get<string>('HRM_PREVIEW') === 'true' ? 'validation' : 'formal'; }
  async getAccess(actor: PayrollActor) {
    if (!this.enabled() || actor.isAssessorOnly) return payrollAccess(actor, [], false);
    const grants = await this.prisma.payrollGrant.findMany({ where: { userId: actor.id, revokedAt: null,
      user: { status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null, isAssessorOnly: false } }, include: { subject: { select: { name: true } } } });
    const result = payrollAccess(actor, grants, true);
    const reviews = await this.prisma.payrollParameterRelease.findMany({
      where: { ...payrollParameterReviewerWhere(actor.id), domain: this.config.get<string>('HRM_PREVIEW') === 'true' ? 'validation' : 'formal' },
      select: { subjectId: true, subject: { select: { name: true } }, submittedBy: { select: {
        payrollGrants: { where: { revokedAt: null }, select: { subjectId: true, capabilities: true } } } } }, distinct: ['subjectId', 'submittedById'],
    });
    for (const review of reviews) {
      if (!review.submittedBy.payrollGrants.some(grant => grant.subjectId === review.subjectId && grant.capabilities.includes('payroll_edit'))) continue;
      let subject = result.subjects.find(row => row.id === review.subjectId);
      if (!subject) { subject = { id: review.subjectId, name: review.subject.name, capabilities: [] }; result.subjects.push(subject); }
      if (!subject.capabilities.includes('payroll_parameter_review')) subject.capabilities.push('payroll_parameter_review');
    }
    return result;
  }
  async assert(tx: Prisma.TransactionClient | PrismaService, actor: PayrollActor, subjectId: string, capability: PayrollCapability) {
    if (!this.enabled()) throw new ForbiddenException('薪酬功能尚未启用');
    const grants = await tx.payrollGrant.findMany({ where: { userId: actor.id, subjectId, revokedAt: null,
      user: { status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null, isAssessorOnly: false } } });
    assertPayrollGrant(actor, grants, subjectId, capability, true);
  }
  async assertFormalPayrollReady(tx: Prisma.TransactionClient | PrismaService, subjectId: string, month: string): Promise<void> {
    await this.assertDomain(tx, 'formal');
    if (typeof month !== 'string' || !PAYROLL_MONTH.test(month)) throw new ConflictException(FORMAL_PENDING);
    const receipt = await this.formalPayrollReceipt(tx, subjectId);
    if (!receipt || month < receipt.firstMonth) throw new ConflictException(FORMAL_PENDING);
  }
  async readiness(subjectId: string, actor: PayrollActor): Promise<
    { ready: true; firstMonth: string } | { ready: false; reason: string }
  > {
    await this.assertDomain(this.prisma, 'formal');
    const grants = await this.prisma.payrollGrant.findMany({ where: { userId: actor.id, subjectId, revokedAt: null,
      user: { status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null, isAssessorOnly: false } } });
    const allowed = ['payroll_edit', 'payroll_view', 'payroll_review', 'payroll_approve'];
    if (!payrollAccess(actor, grants, true).subjects.some(subject => subject.id === subjectId
      && subject.capabilities.some(capability => allowed.includes(capability)))) {
      throw new ForbiddenException('没有该公司主体的薪酬操作权限');
    }
    const receipt = await this.formalPayrollReceipt(this.prisma, subjectId);
    return receipt ? { ready: true, firstMonth: receipt.firstMonth } : { ready: false, reason: FORMAL_PENDING };
  }
  private async formalPayrollReceipt(tx: Prisma.TransactionClient | PrismaService, subjectId: string): Promise<{ firstMonth: string } | null> {
    if (typeof subjectId !== 'string' || !isUUID(subjectId)) return null;
    const row = await tx.systemConfig.findUnique({ where: { key: `payroll_formal_readiness:${subjectId}` }, select: { value: true } });
    const value = row?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.subjectId !== subjectId || value.state !== 'approved'
      || typeof value.firstMonth !== 'string' || !PAYROLL_MONTH.test(value.firstMonth)
      || typeof value.reference !== 'string' || !value.reference.trim()
      || typeof value.approvedAt !== 'string' || !isISO8601(value.approvedAt, { strict: true, strictSeparator: true })
      || !Number.isFinite(Date.parse(value.approvedAt)) || Date.parse(value.approvedAt) > Date.now()
      || typeof value.approvedById !== 'string' || !isUUID(value.approvedById)) return null;
    // Later employment or role changes do not revoke historical acceptance.
    const signer = await tx.user.findFirst({ where: { id: value.approvedById }, select: { id: true } });
    return signer ? { firstMonth: value.firstMonth } : null;
  }
  async assertDomain(tx: Prisma.TransactionClient | PrismaService, purpose: PayrollPurpose): Promise<PayrollDomain> {
    if (!this.enabled()) throw new ForbiddenException('薪酬功能尚未启用');
    if (purpose === 'formal' || purpose === 'reconciliation') {
      if (this.config.get<string>('PAYROLL_FORMAL_ENABLED') !== 'true' || this.config.get<string>('HRM_PREVIEW') === 'true') {
        throw new ForbiddenException('正式薪酬尚未开放，需先确认正式规则与授权');
      }
      return 'formal';
    }
    if (purpose !== 'trial' && purpose !== 'validation') throw new ForbiddenException('不支持的薪酬用途');
    require(resolve(process.cwd(), 'prisma/preview-guard.cjs')).assertPreviewEnvironment(process.env);
    const marker = await tx.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
    if ((marker?.value as { fictional?: boolean } | null)?.fictional !== true) throw new ForbiddenException('仅允许在虚构预览中核算');
    return 'validation';
  }
}
