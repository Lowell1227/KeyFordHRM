import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollDomain, PayrollPolicyConfig } from './payroll-contracts';
import { assertPayrollVersion, lockPayrollAuthorization, lockPayrollSubject, payrollHash } from './payroll-transaction';
import { payrollJson } from './payroll-data.service';
import { normalizePayrollPolicy } from './payroll-policy';
import { payrollParameterEligibleUser, payrollParameterReviewerWhere } from './payroll-parameter-access';
import { payrollParameterDefinition, PayrollParameter, PayrollParameterKind } from './payroll-parameter-definition';
import { normalizeDeductionSettings } from './payroll-deduction-settings';
import { assertFormalPayrollRuleEmployments, assertFormalPayrollScopeAvailable, lockFormalPayrollScope } from './payroll-employment-scope';

type Kind = PayrollParameterKind;
type Parameter = PayrollParameter;
const display = { submittedBy: { select: { id: true, name: true } }, reviewer: { select: { id: true, name: true } },
  deduction: { select: { employee: { select: { name: true, employeeNo: true } } } },
  standard: { select: { employee: { select: { name: true, employeeNo: true } } } } } satisfies Prisma.PayrollParameterReleaseInclude;

@Injectable()
export class PayrollParameterReleasesService {
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollAccessService) {}

  private kind(value: string): Kind {
    if (!['standard', 'rule', 'deduction'].includes(value)) throw new BadRequestException('不支持的工资参数类型');
    return value as Kind;
  }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  private parameter(tx: Prisma.TransactionClient, kind: Kind, id: string): Promise<Parameter | null> {
    return kind === 'standard' ? tx.payrollStandard.findUnique({ where: { id } }) : kind === 'rule' ? tx.payrollPolicy.findUnique({ where: { id } }) : tx.payrollDeductionProfile.findUnique({ where: { id } });
  }
  private async setStatus(tx: Prisma.TransactionClient, kind: Kind, id: string, status: string) {
    const data = { status, ...(status === 'active' ? { activatedAt: new Date() } : {}) };
    if (kind === 'standard') await tx.payrollStandard.update({ where: { id }, data });
    else if (kind === 'rule') await tx.payrollPolicy.update({ where: { id }, data });
    else await tx.payrollDeductionProfile.update({ where: { id }, data });
  }
  private async head(tx: Prisma.TransactionClient, kind: Kind, row: Parameter) {
    const where = { subjectId: row.subjectId, domain: row.domain, status: 'active' };
    if (kind === 'deduction') {
      const profile = row as Prisma.PayrollDeductionProfileGetPayload<{}>;
      return tx.payrollDeductionProfile.findFirst({ where: { ...where, employeeId: profile.employeeId, payDate: profile.payDate }, orderBy: { version: 'desc' } });
    }
    return kind === 'standard' ? tx.payrollStandard.findFirst({ where: { ...where, employeeId: (row as { employeeId: string }).employeeId }, orderBy: { version: 'desc' } })
      : tx.payrollPolicy.findFirst({ where, orderBy: { version: 'desc' } });
  }
  private async manager(tx: Prisma.TransactionClient, submitterId: string) {
    const submitter = await tx.user.findFirst({ where: { id: submitterId, ...payrollParameterEligibleUser }, select: { directManagerId: true } });
    const managerId = submitter?.directManagerId;
    if (!managerId || managerId === submitterId) throw new ConflictException('经办人的直属主管未配置或不能自审，请先维护直属关系');
    const manager = await tx.user.findFirst({ where: { id: managerId, ...payrollParameterEligibleUser }, select: { id: true } });
    if (!manager) throw new ConflictException('直属主管当前不可办理审核，请先核对人员状态');
    return managerId;
  }
  private validate(kind: Kind, row: Parameter) {
    if (kind === 'standard') {
      const value = row as Prisma.PayrollStandardGetPayload<{}>;
      if (value.fixedMonthly === null || !['additional', 'none'].includes(value.performanceMode ?? '') || !value.evidence.trim()) throw new ConflictException('请先补齐固定月薪、另计或不适用结构及确认依据');
    } else if (kind === 'deduction') {
      const profile = row as Prisma.PayrollDeductionProfileGetPayload<{}>;
      normalizeDeductionSettings({ subjectId: profile.subjectId, employeeId: profile.employeeId, payDate: profile.payDate.toISOString().slice(0, 10) }, profile.settings);
    } else {
      const config = normalizePayrollPolicy((row as Prisma.PayrollPolicyGetPayload<{}>).config);
      if (row.domain === 'formal' && !config.employeeScope) throw new ConflictException('正式规则须明确实际发薪人员范围和确认依据');
      if (config.fixedSalaryBasis !== 'monthly_workdays' || config.rounding === null || !config.cutoverMonth
        || !Object.keys(config.workCalendars ?? {}).length) throw new ConflictException('请先补齐工作日日历、舍入规则和启用归属月');
      for (const mapping of Object.values(config.performance)) {
        if (mapping.sourceKind === 'manual') {
          if (!mapping.evidenceRef || !Object.keys(mapping.manualAmounts ?? {}).length) throw new ConflictException('请补齐人工绩效工资金额和确认依据');
        } else if (mapping.cycleIds.length !== 1
          || mapping.sourceKind !== (row.domain === 'validation' ? 'fictional' : 'official')
          || !mapping.coefficientVersion || !mapping.evidenceRef || !Object.keys(mapping.coefficients).length) {
          throw new ConflictException('绩效来源及统一系数表版本、系数和确认依据未完整');
        }
      }
    }
  }
  async submit(kindValue: string, id: string, expectedVersion: number, actor: AuthUser) {
    const kind = this.kind(kindValue);
    return this.transaction(async tx => {
      const metadata = kind === 'standard' ? await tx.payrollStandard.findUnique({ where: { id }, select: { subjectId: true, domain: true } })
        : kind === 'rule' ? await tx.payrollPolicy.findUnique({ where: { id }, select: { subjectId: true, domain: true } })
        : await tx.payrollDeductionProfile.findUnique({ where: { id }, select: { subjectId: true, domain: true } });
      if (!metadata) throw new NotFoundException('工资参数不存在');
      await this.access.assert(tx, actor, metadata.subjectId, 'payroll_edit');
      await this.access.assertDomain(tx, metadata.domain as PayrollDomain);
      await lockPayrollSubject(tx, metadata.subjectId, metadata.domain);
      await lockPayrollAuthorization(tx, metadata.subjectId);
      await this.access.assert(tx, actor, metadata.subjectId, 'payroll_edit');
      const row = (await this.parameter(tx, kind, id))!;
      assertPayrollVersion(row.version, expectedVersion);
      if (row.createdById !== actor.id) throw new ForbiddenException('请复制为自己的草稿后提交主管审核');
      if (!['draft', 'returned'].includes(row.status)) throw new ConflictException('只有草稿或已退回版本可以提交审核');
      this.validate(kind, row);
      if (kind === 'rule' && row.domain === 'formal') await assertFormalPayrollRuleEmployments(tx, row as Prisma.PayrollPolicyGetPayload<{}>);
      const reviewerId = await this.manager(tx, actor.id), head = await this.head(tx, kind, row);
      if (head && (row.version <= head.version || row.effectiveFrom < head.effectiveFrom)) throw new ConflictException('已有更新或更晚生效的发布版本，请核对生效日期并复制新草稿');
      const where = kind === 'standard' ? { standardId: id } : kind === 'rule' ? { ruleId: id } : { deductionId: id };
      const previous = await tx.payrollParameterRelease.findFirst({ where, orderBy: { attempt: 'desc' } });
      const snapshot = payrollParameterDefinition(kind, row);
      const request = await tx.payrollParameterRelease.create({ data: { subjectId: row.subjectId, domain: row.domain, kind,
        ...where, attempt: (previous?.attempt ?? 0) + 1, parameterVersion: row.version, previousParameterId: head?.id ?? null,
        previousHash: head ? payrollHash(payrollParameterDefinition(kind, head)) : null,
        submittedById: actor.id, reviewerId, snapshot, snapshotHash: payrollHash(snapshot) }, include: display });
      await this.setStatus(tx, kind, id, 'pending');
      await this.event(tx, row.subjectId, actor.id, 'parameter_submitted', { releaseId: request.id, kind, parameterId: id });
      return request;
    });
  }
  async list(subjectId: string, actor: AuthUser) {
    return this.transaction(async tx => {
      const domain = await this.access.assertDomain(tx, this.access.maintenancePurpose());
      let editor = false;
      try { await this.access.assert(tx, actor, subjectId, 'payroll_edit'); editor = true; }
      catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
      if (!editor && !await tx.payrollParameterRelease.findFirst({ where: { subjectId, domain,
        ...payrollParameterReviewerWhere(actor.id, subjectId) }, select: { id: true } })) throw new ForbiddenException('没有该主体分配给你的参数审核记录');
      const where = { subjectId, domain, ...(editor ? {} : payrollParameterReviewerWhere(actor.id, subjectId)) };
      const pending = await tx.payrollParameterRelease.findMany({ where: { ...where, status: 'pending' }, include: display, orderBy: { submittedAt: 'desc' } });
      const recent = await tx.payrollParameterRelease.findMany({ where: { ...where, status: { not: 'pending' } }, include: display, orderBy: { submittedAt: 'desc' }, take: 100 });
      const rows = [...pending, ...recent];
      const manualIds = (row: typeof rows[number]) => row.kind === 'rule' ? Object.values(
        (row.snapshot as unknown as { config?: PayrollPolicyConfig })?.config?.performance ?? {},
      ).flatMap(mapping => mapping.sourceKind === 'manual' ? Object.keys(mapping.manualAmounts ?? {}) : []) : [];
      const scopeIds = (row: typeof rows[number]) => row.kind === 'rule'
        ? (row.snapshot as unknown as { config?: PayrollPolicyConfig })?.config?.employeeScope?.employeeIds ?? [] : [];
      const ids = [...new Set(rows.flatMap(row => [...manualIds(row), ...scopeIds(row)]))].sort();
      const employees = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, employeeNo: true } }) : [];
      return rows.map(row => {
        const visible = new Set(manualIds(row));
        const scope = new Set(scopeIds(row));
        return { ...row, ...(visible.size ? { manualEmployees: employees.filter(person => visible.has(person.id)) } : {}),
          ...(scope.size ? { scopeEmployees: employees.filter(person => scope.has(person.id)) } : {}) };
      });
    });
  }
  async decide(id: string, input: { expectedVersion: number; decision: 'approve' | 'return'; note: string }, actor: AuthUser) {
    return this.transaction(async tx => {
      const header = await this.header(tx, id);
      await this.access.assertDomain(tx, header.domain as PayrollDomain);
      // Assignment grants access only to this request, never to salary lists, exports or unrelated parameters.
      if (header.reviewerId !== actor.id || header.submittedById === actor.id) throw new ForbiddenException('只能由该申请指定的直属主管审核，不能自审');
      if (await this.manager(tx, header.submittedById) !== actor.id) throw new ForbiddenException('直属关系已变化，请由经办撤回后重新提交');
      await this.access.assert(tx, { id: header.submittedById }, header.subjectId, 'payroll_edit');
      if (header.domain === 'formal' && header.kind === 'rule') await lockFormalPayrollScope(tx);
      await lockPayrollSubject(tx, header.subjectId, header.domain);
      await lockPayrollAuthorization(tx, header.subjectId);
      await this.access.assert(tx, { id: header.submittedById }, header.subjectId, 'payroll_edit');
      if (await this.manager(tx, header.submittedById) !== actor.id) throw new ForbiddenException('直属关系已变化，请由经办撤回后重新提交');
      const release = (await tx.payrollParameterRelease.findUnique({ where: { id } }))!;
      assertPayrollVersion(release.attempt, input.expectedVersion);
      if (release.status !== 'pending') throw new ConflictException('该申请已处理，请刷新查看结果');
      if (!['approve', 'return'].includes(input.decision) || typeof input.note !== 'string' || input.note.length > 500
        || input.decision === 'return' && !input.note.trim()) throw new BadRequestException('退回须填写原因，办理意见不能超过500字');
      const kind = this.kind(release.kind), parameterId = release.standardId ?? release.ruleId ?? release.deductionId!;
      const row = await this.parameter(tx, kind, parameterId);
      if (!row || row.status !== 'pending' || row.version !== release.parameterVersion
        || payrollHash(payrollParameterDefinition(kind, row)) !== release.snapshotHash) throw new ConflictException('待审参数已变化，请撤回后重新提交');
      if (input.decision === 'approve') {
        this.validate(kind, row);
        if (kind === 'rule' && row.domain === 'formal') await assertFormalPayrollRuleEmployments(tx, row as Prisma.PayrollPolicyGetPayload<{}>);
        const head = await this.head(tx, kind, row);
        if ((head?.id ?? null) !== release.previousParameterId
          || (head ? payrollHash(payrollParameterDefinition(kind, head)) : null) !== release.previousHash) {
          throw new ConflictException('已有其他参数版本发布，请撤回核对后重新提交');
        }
        if (kind === 'rule' && row.domain === 'formal') await assertFormalPayrollScopeAvailable(tx, row as Prisma.PayrollPolicyGetPayload<{}>, release.previousParameterId);
      }
      const status = input.decision === 'approve' ? 'approved' : 'returned';
      const result = await tx.payrollParameterRelease.update({ where: { id }, data: { status, decidedAt: new Date(), note: input.note.trim() }, include: display });
      await this.setStatus(tx, kind, parameterId, status === 'approved' ? 'active' : 'returned');
      await this.event(tx, row.subjectId, actor.id, status === 'approved' ? 'parameter_published' : 'parameter_returned', { releaseId: id, kind, parameterId });
      return result;
    });
  }
  async withdraw(id: string, input: { expectedVersion: number; note: string }, actor: AuthUser) {
    return this.transaction(async tx => {
      const header = await this.header(tx, id);
      await this.access.assert(tx, actor, header.subjectId, 'payroll_edit');
      await this.access.assertDomain(tx, header.domain as PayrollDomain);
      if (header.submittedById !== actor.id) throw new ForbiddenException('只有提交人可以撤回该参数申请');
      await lockPayrollSubject(tx, header.subjectId, header.domain);
      await lockPayrollAuthorization(tx, header.subjectId);
      await this.access.assert(tx, actor, header.subjectId, 'payroll_edit');
      const release = (await tx.payrollParameterRelease.findUnique({ where: { id } }))!;
      assertPayrollVersion(release.attempt, input.expectedVersion);
      if (release.status !== 'pending') throw new ConflictException('只有待审核申请可以撤回');
      if (typeof input.note !== 'string' || !input.note.trim() || input.note.length > 500) throw new BadRequestException('请填写撤回原因');
      await this.setStatus(tx, this.kind(release.kind), release.standardId ?? release.ruleId ?? release.deductionId!, 'draft');
      const result = await tx.payrollParameterRelease.update({ where: { id }, data: { status: 'withdrawn', decidedAt: new Date(), note: input.note.trim() }, include: display });
      await this.event(tx, release.subjectId, actor.id, 'parameter_withdrawn', { releaseId: id }); return result;
    });
  }
  private async header(tx: Prisma.TransactionClient, id: string) {
    const header = await tx.payrollParameterRelease.findUnique({ where: { id }, select: { id: true, subjectId: true, domain: true, kind: true, reviewerId: true, submittedById: true } });
    if (!header) throw new NotFoundException('参数审核申请不存在'); return header;
  }
  private event(tx: Prisma.TransactionClient, subjectId: string, actorId: string, action: string, metadata: object) {
    return tx.payrollEvent.create({ data: { subjectId, actorId, action, metadata: payrollJson(metadata) } });
  }
}
