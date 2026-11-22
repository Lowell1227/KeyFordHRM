import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollBatch, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PayrollActor, PayrollCapability } from './payroll-access';
import { PayrollAccessService } from './payroll-access.service';
import { PAYROLL_ITEM_CODES, PayrollCapture, PayrollDomain, PayrollPurpose, PayrollSourceReader } from './payroll-contracts';
import { assertPayrollVersion, lockPayrollSubject, payrollDate, payrollHash, payrollMonth } from './payroll-transaction';
import { assertPayrollFrozenAttendance } from './payroll-data.service';
import { PayrollDeductionsPreviewDto } from './dto/payroll.dto';
import { calculatePayrollDeductions, PayrollTaxDeductions } from './payroll-deductions-calculator';
import { fictionalDeductionsInput } from './payroll-deductions-preview.fixture';

const versionInclude = {
  lines: { include: { settlements: true, reservation: true } },
  decisions: { orderBy: { step: 'asc' as const } }, exports: true,
} satisfies Prisma.PayrollVersionInclude;
const versionScopeSelect = {
  id: true, version: true, status: true, approvalPath: true, reviewerCount: true, approvalStep: true,
  submittedById: true, approvedAt: true, voidedAt: true,
  decisions: { orderBy: { step: 'asc' as const }, select: { step: true, action: true, actorId: true } },
} satisfies Prisma.PayrollVersionSelect;
const batchScopeSelect = {
  id: true, subjectId: true, purpose: true, status: true,
  versions: { orderBy: { version: 'desc' as const }, take: 1, select: versionScopeSelect },
} satisfies Prisma.PayrollBatchSelect;
type Version = Prisma.PayrollVersionGetPayload<{ include: typeof versionInclude }>;
type VersionScope = Prisma.PayrollVersionGetPayload<{ select: typeof versionScopeSelect }>;
type VisibleVersion = Version & { needsUpdate?: boolean };
type Batch = PayrollBatch & { versions: Version[] };
type ExpectedVersion = { expectedVersion: number };
type ReadScope = { full: boolean; review: boolean; approve: boolean; final: boolean };
const Decimal = Prisma.Decimal.clone({ precision: 40 });
const keyOf = (line: { employeeId: string; attributionMonth: string; itemCode: string }) =>
  `${line.employeeId}:${line.attributionMonth}:${line.itemCode}`;

@Injectable()
export class PayrollBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PayrollAccessService,
    @Inject('PAYROLL_SOURCE_READER') private readonly sources: PayrollSourceReader,
  ) {}

  async list(subjectId: string, actor: PayrollActor, month?: string) {
    return this.transaction(async tx => {
      const scope = await this.readScope(tx, subjectId, actor);
      if (month !== undefined) payrollMonth(month);
      const where = { subjectId, ...(month !== undefined ? { month } : {}) };
      const candidates = await tx.payrollBatch.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: batchScopeSelect });
      const allowed = candidates.filter(batch => scope.full || batch.versions[0] &&
        (this.assigned(batch.versions[0], actor, scope) || scope.final && this.isEffective(batch, batch.versions[0])));
      if (!allowed.length) return [];
      const domains = new Map<string, PayrollDomain>();
      for (const batch of allowed) domains.set(batch.id, await this.access.assertDomain(tx, batch.purpose as PayrollPurpose));
      const latestIds = allowed.flatMap(batch => batch.versions.map(version => version.id));
      const batches = await tx.payrollBatch.findMany({ where: { ...where, id: { in: allowed.map(batch => batch.id) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { versions: { where: { id: { in: latestIds } }, orderBy: { version: 'desc' }, take: 1, include: versionInclude } } });
      const result: Array<PayrollBatch & { versions: Array<Version & { needsUpdate?: boolean }> }> = [];
      for (const batch of batches) {
        const latest = batch.versions[0];
        result.push({ ...batch, versions: latest ? [await this.withFreshness(tx, batch, latest, domains.get(batch.id)!)] : [] });
      }
      return result;
    });
  }

  async detail(id: string, actor: PayrollActor) {
    return this.transaction(async tx => {
      const header = await this.lookup(tx, id);
      const scope = await this.readScope(tx, header.subjectId, actor);
      const domain = await this.access.assertDomain(tx, header.purpose as PayrollPurpose);
      const metadata = await this.scopeBatch(tx, id, scope.full || scope.review || scope.approve ? 50 : 1);
      const latest = metadata.versions[0], assigned = !!latest && this.assigned(latest, actor, scope);
      if (!scope.full && !assigned && !(scope.final && latest && this.isEffective(metadata, latest))) throw new ForbiddenException('无权查看该工资版本');
      const visible = scope.full ? metadata.versions : assigned ? metadata.versions.filter(v => this.assigned(v, actor, scope)) : [latest];
      const batch = await this.load(tx, id, 50, visible.map(version => version.id));
      const versions: VisibleVersion[] = await Promise.all(batch.versions.map(v => v.id === latest?.id ? this.withFreshness(tx, batch, v, domain) : v));
      const history = await tx.payrollEvent.findMany({ where: { subjectId: batch.subjectId, batchId: id,
        ...(scope.full ? {} : { version: { in: visible.map(version => version.version) } }) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
      const events = scope.full ? history : history.filter(e => e.version !== null && visible.some(v => v.version === e.version));
      return { ...batch, versions, events };
    });
  }

  async create(input: { subjectId: string; month: string; payMonth: string; purpose: PayrollPurpose;
    correctionOfId?: string; additionalMonths?: string[] }, actor: PayrollActor) {
    return this.transaction(async tx => {
      await this.access.assert(tx, actor, input.subjectId, 'payroll_edit');
      const domain = await this.access.assertDomain(tx, input.purpose);
      await lockPayrollSubject(tx, input.subjectId, domain);
      payrollMonth(input.month); payrollMonth(input.payMonth);
      const months = input.additionalMonths ?? [];
      if (!Array.isArray(months) || months.length > 11 || new Set(months).size !== months.length || months.includes(input.month)) {
        throw new BadRequestException('补差归属月最多十一项，且不能重复或包含主归属月');
      }
      months.forEach(payrollMonth);
      if (input.correctionOfId) {
        const original = await tx.payrollBatch.findUnique({ where: { id: input.correctionOfId } });
        if (!original || original.subjectId !== input.subjectId || original.month !== input.month ||
          (original.purpose === 'formal' ? 'formal' : 'validation') !== domain || !['approved', 'voided'].includes(original.status)) {
          throw new BadRequestException('更正原批次必须属于同一主体、归属月和核算环境，且已有批准记录');
        }
      }
      const batch = await tx.payrollBatch.create({ data: { subjectId: input.subjectId, month: input.month, payMonth: input.payMonth,
        purpose: input.purpose, additionalMonths: [...months].sort(), correctionOfId: input.correctionOfId, createdById: actor.id } });
      await this.event(tx, batch, actor, 'created', { correctionOfId: input.correctionOfId ?? null });
      return batch;
    });
  }

  async calculate(id: string, input: ExpectedVersion, actor: PayrollActor) {
    return this.write(id, actor, 'payroll_edit', async (tx, batch, domain) => {
      assertPayrollVersion(batch.version, input.expectedVersion);
      if (!['draft', 'calculated', 'returned', 'withdrawn', 'voided'].includes(batch.status)) throw new ConflictException('请先撤回或作废当前版本后重算');
      const captured = await this.captureForBatch(tx, batch, domain);
      const version = await tx.payrollVersion.create({ data: {
        batchId: id, version: (batch.versions[0]?.version ?? 0) + 1, sourceHash: captured.sourceHash,
        sources: captured.sources, issues: captured.issues, approvalPath: captured.approvalPath, reviewerCount: captured.reviewerCount,
        gross: captured.gross === null ? null : this.money(captured.gross, 18), calculatedById: actor.id,
        lines: { create: captured.lines.map(line => ({ employeeId: line.employeeId, attributionMonth: line.attributionMonth,
          itemCode: line.itemCode, status: line.status, evidence: line.evidence,
          entitlement: line.entitlement === null ? null : this.money(line.entitlement),
          paidBefore: line.paidBefore === null ? null : this.money(line.paidBefore),
          amount: line.amount === null ? null : this.money(line.amount) })) },
      } });
      await this.event(tx, batch, actor, 'calculated', { sourceHash: captured.sourceHash }, version.version);
      return this.advance(tx, batch, 'calculated');
    });
  }

  async deductionsPreview(id: string, input: PayrollDeductionsPreviewDto, actor: PayrollActor) {
    let employeeNames = new Map<string, string>();
    return this.write(id, actor, 'payroll_edit', async (tx, batch, domain) => {
      assertPayrollVersion(batch.version, input.expectedVersion);
      const version = this.latest(batch);
      if (!['calculated', 'pending', 'approved'].includes(batch.status) || batch.status !== version.status || version.voidedAt) {
        throw new ConflictException('仅当前已核算、审批中或已批准的完整版本可以进行虚构扣缴试算');
      }
      this.assertReady(version);
      const groups = new Map<string, Set<string>>(), grossByEmployee = new Map<string, Prisma.Decimal>();
      const keys = new Set<string>(), months = [batch.month, ...batch.additionalMonths];
      const frozen = version.sources as { months?: Array<{ month: string; sources?: {
        subjectId?: string; month?: string; domain?: string;
        employments?: Array<{ userId?: string; contractSubjectId?: string }>;
      } }> } | null;
      const expectedGroups = new Set<string>(), frozenMonths = new Set<string>();
      if (!Array.isArray(frozen?.months) || frozen.months.length !== months.length) {
        throw new ConflictException('冻结来源缺少完整归属月及应核人员范围');
      }
      for (const entry of frozen.months) {
        const scope = entry?.sources;
        if (!months.includes(entry?.month) || frozenMonths.has(entry.month) || scope?.subjectId !== batch.subjectId ||
          scope.month !== entry.month || scope.domain !== domain || !Array.isArray(scope.employments) || !scope.employments.length) {
          throw new ConflictException('冻结来源的主体、月份或应核人员范围不完整');
        }
        frozenMonths.add(entry.month);
        for (const employment of scope.employments) {
          if (!employment || typeof employment.userId !== 'string' || !employment.userId || employment.contractSubjectId !== batch.subjectId) {
            throw new ConflictException('冻结任职范围与工资主体不一致');
          }
          expectedGroups.add(`${employment.userId}:${entry.month}`);
        }
      }
      for (const line of version.lines) {
        const key = keyOf(line), group = `${line.employeeId}:${line.attributionMonth}`;
        if (!employeeNames.has(line.employeeId) || !months.includes(line.attributionMonth) ||
          !(PAYROLL_ITEM_CODES as readonly string[]).includes(line.itemCode) || keys.has(key)) {
          throw new ConflictException('核算版本的员工、归属月或五项工资明细不完整或重复');
        }
        keys.add(key);
        const items = groups.get(group) ?? new Set<string>(); items.add(line.itemCode); groups.set(group, items);
        const entitlement = this.money(line.entitlement!.toString()), paid = this.money(line.paidBefore!.toString());
        const amount = this.money(line.amount!.toString());
        if (!entitlement.minus(paid).eq(amount)) throw new ConflictException('工资应发、已入薪和本批差额不一致');
        grossByEmployee.set(line.employeeId, (grossByEmployee.get(line.employeeId) ?? new Decimal(0)).plus(amount));
      }
      const gross = [...grossByEmployee.values()].reduce((total, amount) => total.plus(amount), new Decimal(0));
      if (groups.size !== expectedGroups.size || [...expectedGroups].some(group => !groups.has(group)) ||
        [...groups.values()].some(items => items.size !== PAYROLL_ITEM_CODES.length) ||
        !gross.eq(this.money(version.gross!.toString(), 18))) throw new ConflictException('完整五项工资明细与核算合计不一致');
      if (batch.status === 'approved') await assertPayrollFrozenAttendance(tx, batch.subjectId, domain, version.sources);
      else await this.assertFresh(tx, batch, version, domain);
      const rows = [...grossByEmployee.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([employeeId, amount], index) => {
        const facts = fictionalDeductionsInput({ subjectId: batch.subjectId, employeeId, month: batch.month,
          payDate: input.payDate, gross: amount.toFixed(2) });
        if (input.mode === 'missing' && index === 0) delete (facts.tax.current as Partial<PayrollTaxDeductions>).specialDeduction;
        return { employeeId, employeeName: employeeNames.get(employeeId)!, ...calculatePayrollDeductions(facts) };
      });
      const sum = (field: 'gross' | 'socialInsurance' | 'housingFund' | 'incomeTax' | 'net') =>
        rows.reduce((total, row) => total.plus(row[field]!), new Decimal(0)).toFixed(2);
      return { batchId: batch.id, batchVersion: batch.version, calculationVersion: version.version, calculationVersionId: version.id,
        subjectId: batch.subjectId, sourceHash: version.sourceHash, payDate: input.payDate, payMonth: batch.payMonth, mode: input.mode,
        basis: 'fictional' as const, approvalStatus: 'not_submitted' as const, rows,
        totals: rows.every(row => row.status === 'ready') ? { gross: sum('gross'), socialInsurance: sum('socialInsurance'),
          housingFund: sum('housingFund'), incomeTax: sum('incomeTax'), net: sum('net') } : null };
    }, Prisma.TransactionIsolationLevel.ReadCommitted, async (tx, header) => {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['expectedVersion', 'payDate', 'mode'].includes(key)) ||
        !['complete', 'missing'].includes(input.mode) || typeof input.payDate !== 'string') {
        throw new BadRequestException('虚构试算仅接受批次版本、明确发薪日和完整参数或缺项检查模式');
      }
      const metadata = await tx.payrollBatch.findUnique({ where: { id }, select: { version: true, payMonth: true,
        versions: { orderBy: { version: 'desc' }, take: 1, select: { lines: { select: { employeeId: true } } } } } });
      if (!metadata) throw new NotFoundException('工资批次不存在');
      assertPayrollVersion(metadata.version, input.expectedVersion);
      payrollDate(input.payDate);
      if (input.payDate.slice(0, 7) !== metadata.payMonth) throw new BadRequestException('试算发薪日必须属于该批次发放月');
      const employeeIds = [...new Set(metadata.versions[0]?.lines.map(line => line.employeeId) ?? [])];
      if (!employeeIds.length) throw new ConflictException('请先完成包含全部员工五项明细的工资核算');
      employeeNames = await this.deductionsPreviewEmployees(tx, header.subjectId, employeeIds);
    });
  }

  private async deductionsPreviewEmployees(tx: Prisma.TransactionClient, subjectId: string, employeeIds: string[]) {
    const marker = async (key: string) => (await tx.systemConfig.findUnique({ where: { key } }))?.value as
      { fictional?: boolean; state?: string; subjectIds?: unknown; employeeIds?: unknown } | null | undefined;
    const local = await marker('local_preview_fixture_v1'), base = await marker('payroll_preview_fixture_v1');
    if (local?.fictional !== true || base?.fictional !== true) throw new ForbiddenException('仅允许已登记的虚构薪酬预览');
    const dedicated = await marker('payroll_deductions_preview_fixture_v1');
    const fixtures = [base, ...(dedicated?.fictional === true && dedicated.state === 'ready' ? [dedicated] : [])];
    if (!fixtures.some(({ subjectIds, employeeIds: registered }) => Array.isArray(subjectIds) && subjectIds.includes(subjectId) &&
      Array.isArray(registered) && employeeIds.every(id => registered.includes(id)))) {
      throw new ForbiddenException('主体及全部工资人员必须在同一虚构预览夹具中明确登记');
    }
    const subject = await tx.contractSubject.findUnique({ where: { id: subjectId }, select: { name: true } });
    const employees = await tx.user.findMany({ where: { id: { in: employeeIds } },
      select: { id: true, name: true, employeeNo: true, dingtalkId: true, dingtalkUnionId: true } });
    if (!subject?.name.includes('虚构') || employees.length !== employeeIds.length || employees.some(employee =>
      !employee.name.includes('虚构') || !/^(PAY-DEMO-|PAY-DEDUCT-)/.test(employee.employeeNo ?? '') ||
      employee.dingtalkId || employee.dingtalkUnionId)) throw new ForbiddenException('虚构预览登记与实际主体或员工记录不匹配');
    return new Map(employees.map(employee => [employee.id, employee.name]));
  }

  async submit(id: string, input: ExpectedVersion, actor: PayrollActor) {
    return this.write(id, actor, 'payroll_edit', async (tx, batch, domain) => {
      assertPayrollVersion(batch.version, input.expectedVersion);
      const version = this.latest(batch);
      if (batch.purpose === 'trial') throw new ConflictException('试算批次不能提交正式审批或最终导出');
      if (batch.status !== 'calculated' || version.status !== 'calculated') throw new ConflictException('请重算产生新版本后再提交');
      this.assertReady(version);
      await this.assertPath(tx, batch, version, actor.id);
      await this.assertFresh(tx, batch, version, domain);
      await this.assertPaidBefore(tx, batch, version, domain);
      const claimLines = version.lines.filter(line => line.status === 'ready');
      if (claimLines.length) {
        const conflicts = await tx.payrollReservation.findMany({ where: { subjectId: batch.subjectId, domain,
          OR: claimLines.map(({ employeeId, attributionMonth, itemCode }) => ({ employeeId, attributionMonth, itemCode })) }, take: 1,
          select: { line: { select: { version: { select: { batchId: true } } } } } });
        if (conflicts.length) {
          const original = await this.lookup(tx, conflicts[0].line.version.batchId);
          // payroll_edit already permits full subject reads; the reservation FK alone does not bind its batch to that scope.
          const visible = original.subjectId === batch.subjectId && (domain === 'formal'
            ? original.purpose === 'formal' : ['trial', 'validation'].includes(original.purpose));
          throw new ConflictException({ message: '工资归属项已有有效支付安排，请核对原批次',
            ...(visible ? { data: { batchId: original.id } } : {}) });
        }
        await tx.payrollReservation.createMany({ data: claimLines.map(line => ({ subjectId: batch.subjectId,
          employeeId: line.employeeId, domain, attributionMonth: line.attributionMonth, itemCode: line.itemCode, lineId: line.id })) });
      }
      await tx.payrollVersion.update({ where: { id: version.id }, data: { status: 'pending', submittedById: actor.id,
        submittedAt: new Date(), approvalStep: 0 } });
      await this.event(tx, batch, actor, 'submitted', {}, version.version);
      return this.advance(tx, batch, 'pending');
    });
  }

  async decide(id: string, input: ExpectedVersion & { decision: 'approve' | 'return'; note: string }, actor: PayrollActor) {
    return this.transaction(async tx => {
      const header = await this.lookup(tx, id);
      if (!await this.has(tx, header.subjectId, actor, 'payroll_review') && !await this.has(tx, header.subjectId, actor, 'payroll_approve')) {
        throw new ForbiddenException('没有该主体的工资复核或审批权限');
      }
      const domain = await this.access.assertDomain(tx, header.purpose as PayrollPurpose);
      await lockPayrollSubject(tx, header.subjectId, domain);
      const metadata = await this.scopeBatch(tx, id), step = metadata.versions[0];
      if (!step) throw new ConflictException('请先完成工资核算');
      const capability = step.approvalStep < step.reviewerCount ? 'payroll_review' : 'payroll_approve';
      await this.access.assert(tx, actor, header.subjectId, capability);
      if (!step.submittedById || step.approvalPath[step.approvalStep] !== actor.id || actor.id === step.submittedById) throw new ForbiddenException('请由当前指定的复核或审批人办理');
      const batch = await this.load(tx, id), version = this.latest(batch);
      assertPayrollVersion(batch.version, input.expectedVersion);
      if (batch.status !== 'pending' || version.status !== 'pending' || batch.purpose === 'trial') throw new ConflictException('当前批次不在审批中');
      if (version.approvalPath[version.approvalStep] !== actor.id || actor.id === version.submittedById) throw new ForbiddenException('请由当前指定的复核或审批人办理');
      if (!['approve', 'return'].includes(input.decision)) throw new BadRequestException('审批动作不正确');
      const note = this.text(input.note, 500, input.decision === 'return');
      if (input.decision === 'approve') {
        this.assertReady(version);
        await this.assertPath(tx, batch, version, version.submittedById!);
        await this.assertFresh(tx, batch, version, domain);
      }
      await tx.payrollDecision.create({ data: { versionId: version.id, step: version.approvalStep, actorId: actor.id, action: input.decision, note } });
      const nextStep = version.approvalStep + 1;
      const status = input.decision === 'return' ? 'returned' : nextStep === version.approvalPath.length ? 'approved' : 'pending';
      await tx.payrollVersion.update({ where: { id: version.id }, data: { status,
        ...(input.decision === 'approve' ? { approvalStep: nextStep } : {}), ...(status === 'approved' ? { approvedAt: new Date() } : {}) } });
      if (status === 'returned') await this.release(tx, version.lines);
      if (status === 'approved') await this.release(tx, version.lines.filter(line => line.amount?.isZero()));
      await this.event(tx, batch, actor, input.decision === 'return' ? 'returned' : status === 'approved' ? 'approved' : 'reviewed',
        { step: version.approvalStep, note }, version.version);
      return this.advance(tx, batch, status);
    });
  }

  async withdraw(id: string, input: ExpectedVersion & { note: string }, actor: PayrollActor) {
    return this.write(id, actor, 'payroll_edit', async (tx, batch) => {
      assertPayrollVersion(batch.version, input.expectedVersion);
      const version = this.latest(batch), note = this.text(input.note, 500);
      if (batch.status !== 'pending' || version.status !== 'pending') throw new ConflictException('仅审批中的版本可以撤回');
      await tx.payrollVersion.update({ where: { id: version.id }, data: { status: 'withdrawn' } });
      await this.release(tx, version.lines);
      await this.event(tx, batch, actor, 'withdrawn', { note }, version.version);
      return this.advance(tx, batch, 'withdrawn');
    });
  }

  async voidApproved(id: string, input: ExpectedVersion & { note: string; confirmedUnpaid: boolean }, actor: PayrollActor) {
    return this.write(id, actor, 'payroll_settle', async (tx, batch) => {
      assertPayrollVersion(batch.version, input.expectedVersion);
      const version = this.effective(batch), note = this.text(input.note, 200);
      if (version.lines.some(line => line.settlements.length > 0)) throw new ConflictException('已有确认入薪，不能作废；请办理差额');
      if (version.exports.length > 0 && input.confirmedUnpaid !== true) throw new ConflictException('已导出版本须先核对财务未付款，并明确确认未付款凭证');
      await tx.payrollVersion.update({ where: { id: version.id }, data: { status: 'voided', voidedAt: new Date() } });
      await this.release(tx, version.lines);
      await this.event(tx, batch, actor, 'voided', { reference: note, confirmedUnpaid: input.confirmedUnpaid === true }, version.version);
      return this.advance(tx, batch, 'voided');
    });
  }

  async settle(id: string, input: ExpectedVersion & { lineId: string; amount: string; reference: string; requestId: string }, actor: PayrollActor) {
    return this.write(id, actor, 'payroll_settle', async (tx, batch, domain) => {
      const version = this.effective(batch);
      const reference = this.text(input.reference, 200), amount = this.money(input.amount);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) throw new BadRequestException('入薪请求标识不正确');
      const requestHash = payrollHash({ batchId: id, versionId: version.id, lineId: input.lineId, amount: amount.toFixed(2), reference, actorId: actor.id });
      const existing = await tx.payrollSettlement.findUnique({ where: { requestId: input.requestId } });
      // An exact replay remains successful after its own write advanced the batch token.
      if (existing) {
        if (existing.requestHash !== requestHash || existing.confirmedById !== actor.id || existing.lineId !== input.lineId) throw new ConflictException('该入薪请求已用于其他内容或确认人');
        const { versions: _versions, ...record } = batch;
        return record;
      }
      await assertPayrollFrozenAttendance(tx, batch.subjectId, domain, version.sources);
      assertPayrollVersion(batch.version, input.expectedVersion);
      const line = this.payableLine(version, input.lineId);
      const paid = line.settlements.reduce((total, payment) => total.plus(payment.amount), new Decimal(0));
      const remainder = new Decimal(line.amount!).minus(paid);
      if (amount.isZero() || amount.isPositive() !== remainder.isPositive() || amount.abs().gt(remainder.abs())) throw new ConflictException('确认金额方向不符或超过本行未结余额');
      await tx.payrollSettlement.create({ data: { lineId: line.id, requestId: input.requestId, requestHash,
        amount, reference, confirmedById: actor.id } });
      if (amount.eq(remainder)) await this.release(tx, [line]);
      await this.event(tx, batch, actor, 'settled', { lineId: line.id, requestId: input.requestId, reference }, version.version);
      return this.advance(tx, batch, 'approved');
    }, Prisma.TransactionIsolationLevel.ReadCommitted);
  }

  async cancelRemainder(id: string, input: ExpectedVersion & { lineId: string; reference: string }, actor: PayrollActor) {
    return this.write(id, actor, 'payroll_settle', async (tx, batch) => {
      assertPayrollVersion(batch.version, input.expectedVersion);
      const version = this.effective(batch), line = this.payableLine(version, input.lineId);
      const reference = this.text(input.reference, 200);
      await this.release(tx, [line]);
      await this.event(tx, batch, actor, 'remainder_cancelled', { lineId: line.id, reference }, version.version);
      return this.advance(tx, batch, 'approved');
    });
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel.Serializable): Promise<T> {
    try {
      return await this.prisma.$transaction(work, { isolationLevel, maxWait: 5000, timeout: 60000 });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'P2002') throw new ConflictException('工资归属项已被其他批次占用，或该操作已提交；请重新读取并核对原批次');
      if (code === 'P2034') throw new ConflictException('并发操作冲突，未保存本次操作；请读取最新版本后人工重试');
      throw error;
    }
  }

  private write<T>(id: string, actor: PayrollActor, capability: PayrollCapability,
    work: (tx: Prisma.TransactionClient, batch: Batch, domain: PayrollDomain) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel.Serializable,
    previewGuard?: (tx: Prisma.TransactionClient, header: Pick<PayrollBatch, 'id' | 'subjectId' | 'purpose'>) => Promise<void>) {
    return this.transaction(async tx => {
      const header = await this.lookup(tx, id);
      await this.access.assert(tx, actor, header.subjectId, capability);
      if (previewGuard && header.purpose === 'formal') throw new ForbiddenException('扣缴试算仅限虚构预览，不接受正式批次');
      const domain = await this.access.assertDomain(tx, header.purpose as PayrollPurpose);
      await lockPayrollSubject(tx, header.subjectId, domain);
      if (isolationLevel === Prisma.TransactionIsolationLevel.ReadCommitted) {
        const current = await this.lookup(tx, id);
        if (current.subjectId !== header.subjectId || current.purpose !== header.purpose) throw new ConflictException('批次归属已变化，请重新读取');
        await this.access.assert(tx, actor, current.subjectId, capability);
        await this.access.assertDomain(tx, current.purpose as PayrollPurpose);
      }
      if (previewGuard) await previewGuard(tx, header);
      if (capability === 'payroll_settle') {
        const metadata = await this.scopeBatch(tx, id);
        if (!metadata.versions[0] || !this.isEffective(metadata, metadata.versions[0])) throw new ConflictException('仅当前有效且全部审批完成的版本可以办理入薪或作废');
      }
      const batch = await this.load(tx, id);
      return work(tx, batch, domain);
    }, isolationLevel);
  }

  private async lookup(tx: Prisma.TransactionClient, id: string) {
    const batch = await tx.payrollBatch.findUnique({ where: { id }, select: { id: true, subjectId: true, purpose: true } });
    if (!batch) throw new NotFoundException('工资批次不存在');
    return batch;
  }

  private async scopeBatch(tx: Prisma.TransactionClient, id: string, take = 1) {
    const batch = await tx.payrollBatch.findUnique({ where: { id }, select: { ...batchScopeSelect,
      versions: { ...batchScopeSelect.versions, take } } });
    if (!batch) throw new NotFoundException('工资批次不存在');
    return batch;
  }

  private async load(tx: Prisma.TransactionClient, id: string, take = 1, versionIds?: string[]): Promise<Batch> {
    const batch = await tx.payrollBatch.findUnique({ where: { id },
      include: { versions: { ...(versionIds ? { where: { id: { in: versionIds } } } : {}), orderBy: { version: 'desc' }, take, include: versionInclude } } });
    if (!batch) throw new NotFoundException('工资批次不存在');
    return batch;
  }

  private latest(batch: Batch): Version {
    if (!batch.versions[0]) throw new ConflictException('请先完成工资核算');
    return batch.versions[0];
  }

  private effective(batch: Batch): Version {
    const version = this.latest(batch);
    if (!this.isEffective(batch, version)) {
      throw new ConflictException('仅当前有效且全部复核审批完成的版本可以办理入薪或作废');
    }
    return version;
  }

  private isEffective(batch: Pick<PayrollBatch, 'purpose' | 'status'>, version: VersionScope): boolean {
    return batch.purpose !== 'trial' && batch.status === 'approved' && version.status === 'approved' && !!version.approvedAt && !version.voidedAt &&
      version.approvalStep === version.approvalPath.length && version.reviewerCount >= 1 && version.reviewerCount < version.approvalPath.length &&
      version.decisions.length === version.approvalPath.length && version.decisions.every((decision, step) =>
        decision.step === step && decision.action === 'approve' && decision.actorId === version.approvalPath[step]);
  }

  private payableLine(version: Version, lineId: string) {
    const line = version.lines.find(l => l.id === lineId);
    if (!line) throw new BadRequestException('工资行不属于当前批准版本');
    if (line.amount === null || line.status !== 'ready' || !line.reservation) throw new ConflictException('该工资行没有有效的未结支付安排');
    return line;
  }

  private async readScope(tx: Prisma.TransactionClient, subjectId: string, actor: PayrollActor): Promise<ReadScope> {
    const has = (capability: PayrollCapability) => this.has(tx, subjectId, actor, capability);
    const full = await has('payroll_view') || await has('payroll_edit');
    const review = !full && await has('payroll_review'), approve = !full && await has('payroll_approve');
    const final = !full && (await has('payroll_export') || await has('payroll_settle'));
    if (!full && !review && !approve && !final) throw new ForbiddenException('没有该主体的工资查看、指定审批或最终结果权限');
    return { full, review, approve, final };
  }

  private async has(tx: Prisma.TransactionClient, subjectId: string, actor: PayrollActor, capability: PayrollCapability): Promise<boolean> {
    try { await this.access.assert(tx, actor, subjectId, capability); return true; }
    catch (error) { if (error instanceof ForbiddenException) return false; throw error; }
  }

  private assigned(version: Pick<VersionScope, 'approvalPath' | 'reviewerCount' | 'submittedById'>, actor: PayrollActor, scope: ReadScope): boolean {
    if (!version.submittedById) return false;
    return scope.review && version.approvalPath.slice(0, version.reviewerCount).includes(actor.id) ||
      scope.approve && version.approvalPath.slice(version.reviewerCount).includes(actor.id);
  }

  private async withFreshness(tx: Prisma.TransactionClient, batch: PayrollBatch, version: Version, domain: PayrollDomain): Promise<VisibleVersion> {
    if (version.status !== 'pending' && version.status !== 'approved') return version;
    try {
      if (version.status === 'approved') await assertPayrollFrozenAttendance(tx, batch.subjectId, domain, version.sources);
      else await this.assertFresh(tx, batch, version, domain);
      return { ...version, needsUpdate: false };
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      return { ...version, needsUpdate: true };
    }
  }

  private async captureForBatch(tx: Prisma.TransactionClient, batch: PayrollBatch, domain: PayrollDomain): Promise<PayrollCapture> {
    const months = [batch.month, ...batch.additionalMonths].sort();
    const captures: Array<{ month: string; capture: PayrollCapture }> = [];
    for (const month of months) {
      let capture: PayrollCapture;
      try { capture = await this.sources.capture(tx, batch.subjectId, month, domain); }
      catch { throw new ConflictException('工资来源暂不可用，请核对后重新取数；未按零金额处理'); }
      this.validateCapture(capture, month);
      const first = captures[0]?.capture;
      if (first && (first.reviewerCount !== capture.reviewerCount || JSON.stringify(first.approvalPath) !== JSON.stringify(capture.approvalPath))) {
        throw new ConflictException('各归属月复核审批路径不一致，请分批核算');
      }
      captures.push({ month, capture });
    }
    const first = captures[0].capture;
    return { sourceHash: payrollHash(captures.map(({ month, capture }) => ({ month, sourceHash: capture.sourceHash }))),
      sources: { months: captures.map(({ month, capture }) => ({ month, sources: capture.sources })) },
      issues: captures.flatMap(({ capture }) => capture.issues), lines: captures.flatMap(({ capture }) => capture.lines),
      approvalPath: [...first.approvalPath], reviewerCount: first.reviewerCount,
      gross: captures.some(({ capture }) => capture.gross === null) ? null :
        captures.reduce((total, { capture }) => total.plus(this.money(capture.gross!, 18)), new Decimal(0)).toFixed(2) };
  }

  private validateCapture(capture: PayrollCapture, month: string) {
    if (!capture || !/^[a-f0-9]{64}$/i.test(capture.sourceHash) || !Array.isArray(capture.lines) || capture.lines.length > 10000 ||
      !Array.isArray(capture.issues) || capture.issues.some(issue => typeof issue !== 'string') ||
      !Array.isArray(capture.approvalPath) || capture.approvalPath.some(id => typeof id !== 'string' || !id) || !Number.isInteger(capture.reviewerCount)) {
      throw new ConflictException('工资来源返回不完整，不能保存核算结果');
    }
    const keys = new Set<string>(); let total = new Decimal(0), complete = capture.lines.length > 0;
    for (const line of capture.lines) {
      if (!line.employeeId || line.attributionMonth !== month || !(PAYROLL_ITEM_CODES as readonly string[]).includes(line.itemCode) ||
        keys.has(keyOf(line)) || typeof line.status !== 'string' || !line.status || line.evidence === undefined || line.evidence === null) {
        throw new ConflictException('工资来源存在重复或错误的员工、归属月、工资项目或依据');
      }
      keys.add(keyOf(line));
      const amounts = [line.entitlement, line.paidBefore, line.amount];
      for (const value of amounts) if (value !== null) this.money(value);
      if (amounts.some(value => value === null)) {
        complete = false;
        if (line.status === 'ready') throw new ConflictException('完整工资行缺少金额来源');
      } else {
        if (!this.money(line.entitlement!).minus(this.money(line.paidBefore!)).eq(this.money(line.amount!))) throw new ConflictException('工资应发、已入薪和本批差额不一致');
        total = total.plus(this.money(line.amount!));
      }
      if (line.status === 'not_applicable' && !this.notApplicable(line)) throw new ConflictException('不适用工资项必须具有明确依据，且三个金额均为零');
      if (line.status !== 'ready' && !this.notApplicable(line)) complete = false;
    }
    if (capture.gross !== null && (!complete || !total.eq(this.money(capture.gross, 18)))) throw new ConflictException('工资合计与完整工资行不一致');
    if ((!complete || capture.gross === null) && capture.issues.length === 0) capture.issues.push('工资来源尚不完整，请处理待核项目');
  }

  private money(value: string, digits = 16): Prisma.Decimal {
    if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d{1,2})?$/.test(value)) throw new ConflictException('金额必须是精确到分的有效十进制数');
    const amount = new Decimal(value);
    if (!amount.isFinite() || amount.abs().gte(new Decimal(10).pow(digits - 2))) throw new ConflictException('金额超出允许范围');
    return amount;
  }

  private assertReady(version: Version) {
    if (!Array.isArray(version.issues) || version.issues.length > 0 || !version.lines.length || version.gross === null ||
      version.lines.some(line => line.status !== 'ready' && !this.notApplicable(line) || line.entitlement === null || line.paidBefore === null || line.amount === null)) {
      throw new ConflictException('工资来源或规则尚待核对，不能以部分成功提交或审批');
    }
  }

  private notApplicable(line: { status: string; entitlement: string | Prisma.Decimal | null; paidBefore: string | Prisma.Decimal | null;
    amount: string | Prisma.Decimal | null; evidence: unknown }): boolean {
    return line.status === 'not_applicable' && line.evidence !== null && typeof line.evidence === 'object' &&
      (line.evidence as { applicability?: unknown }).applicability === 'not_applicable' &&
      [line.entitlement, line.paidBefore, line.amount].every(value => value !== null && new Decimal(value).isZero());
  }

  private async assertPath(tx: Prisma.TransactionClient, batch: PayrollBatch, version: Version, submitter: string) {
    if (version.reviewerCount < 1 || version.reviewerCount >= version.approvalPath.length ||
      new Set(version.approvalPath).size !== version.approvalPath.length || version.approvalPath.includes(submitter)) {
      throw new ConflictException('必须配置独立复核人及审批人，不得重复或自行复核审批');
    }
    for (const [step, id] of version.approvalPath.entries()) await this.access.assert(tx, { id }, batch.subjectId,
      step < version.reviewerCount ? 'payroll_review' : 'payroll_approve');
  }

  private async assertFresh(tx: Prisma.TransactionClient, batch: PayrollBatch, version: Version, domain: PayrollDomain) {
    const current = await this.captureForBatch(tx, batch, domain);
    if (current.sourceHash !== version.sourceHash || current.issues.length > 0 || current.gross === null ||
      current.reviewerCount !== version.reviewerCount || JSON.stringify(current.approvalPath) !== JSON.stringify(version.approvalPath)) {
      throw new ConflictException('工资来源已更新或待核，暂停审批；请退回或撤回后重算并重新提交');
    }
  }

  private async assertPaidBefore(tx: Prisma.TransactionClient, batch: PayrollBatch, version: Version, domain: PayrollDomain) {
    const keys = version.lines.map(({ employeeId, attributionMonth, itemCode }) => ({ employeeId, attributionMonth, itemCode }));
    const openings = await tx.payrollOpeningBalance.findMany({ where: { subjectId: batch.subjectId, domain, OR: keys } });
    const payments = await tx.payrollSettlement.findMany({ where: { line: {
      version: { batch: { subjectId: batch.subjectId, purpose: domain === 'formal' ? 'formal' : { in: ['trial', 'validation'] } } }, OR: keys,
    } }, include: { line: { select: { employeeId: true, attributionMonth: true, itemCode: true } } } });
    const totals = new Map<string, Prisma.Decimal>();
    for (const opening of openings) {
      if (opening.amount === null || !opening.confirmedAt || !opening.confirmedById || !opening.reference?.trim()) throw new ConflictException('期初入薪金额和凭证尚未确认');
      totals.set(keyOf(opening), new Decimal(opening.amount));
    }
    for (const line of version.lines) if (!totals.has(keyOf(line))) throw new ConflictException('每个工资归属项均须明确确认期初金额和凭证，零金额也不能省略');
    for (const payment of payments) {
      const key = keyOf(payment.line);
      totals.set(key, totals.get(key)!.plus(payment.amount));
    }
    for (const line of version.lines) if (!line.paidBefore!.eq(totals.get(keyOf(line))!)) {
      throw new ConflictException('累计已入薪金额已变化，请重新核算差额');
    }
  }

  private text(value: string, max: number, required = true): string {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new BadRequestException('请填写有效的办理依据或财务凭证');
    return value.trim();
  }

  private release(tx: Prisma.TransactionClient, lines: Array<{ id: string }>) {
    return tx.payrollReservation.deleteMany({ where: { lineId: { in: lines.map(line => line.id) } } });
  }

  private advance(tx: Prisma.TransactionClient, batch: PayrollBatch, status: string) {
    return tx.payrollBatch.update({ where: { id: batch.id }, data: { status, version: { increment: 1 } } });
  }

  private event(tx: Prisma.TransactionClient, batch: PayrollBatch, actor: PayrollActor, action: string,
    metadata: Prisma.InputJsonValue, version?: number) {
    return tx.payrollEvent.create({ data: { subjectId: batch.subjectId, batchId: batch.id, version, actorId: actor.id, action, metadata } });
  }
}
