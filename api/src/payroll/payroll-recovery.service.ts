import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PayrollAttendanceSnapshot, PayrollOpeningBalance } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollDomain } from './payroll-contracts';
import { employmentDays, payrollEmployments, payrollJson, payrollDays } from './payroll-data.service';
import { PayrollAttendanceResult } from './payroll-attendance-normalizer';
import { PayrollPolicyWithScope, readReviewedPayrollScopePolicies } from './payroll-employment-scope';
import { lockPayrollAuthorization, lockPayrollSubject, payrollDecimal, payrollHash } from './payroll-transaction';
import { PayrollCorrectOpeningDto, PayrollRecoverScopeDto } from './dto/payroll-recovery.dto';
import { payrollAttendanceHash } from './payroll-attendance-integrity';

type DayKey = { employeeId: string; workDate: string };
type Payload = PayrollAttendanceResult & { [key: string]: unknown;
  confirmedAbsences?: DayKey[];
  dingtalk?: { absenceCandidates?: DayKey[]; [key: string]: unknown };
  sync?: {
  requestHash: string; complete: boolean; queryComplete: boolean; scope: { employeeIds: string[]; from: string; to: string };
  coverage: Array<DayKey & { complete: boolean }>;
} };
const key = (day: DayKey) => JSON.stringify([day.employeeId, day.workDate]);
const byDay = (a: DayKey, b: DayKey) => key(a).localeCompare(key(b));
const active = ['pending', 'approved'];
const blockedMessage = '该归属月已有在审、批准或已付安排，请先撤回未支付安排，或按既有更正流程处理；不能删除支付或预留';
const hashPattern = /^[a-f0-9]{64}$/;

@Injectable()
export class PayrollRecoveryService {
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollAccessService) {}

  async scopeDiff(id: string, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const row = await this.attendance(tx, id, actor, false);
      const diff = await this.diff(tx, row, false);
      return { ...diff, blockedReason: payrollAttendanceHash(row.payload) !== row.sourceHash
        ? '该考勤版本的完整性待核对，请先重新同步，再办理范围恢复'
        : !diff.current.length ? '当月没有已审发薪范围，请先补齐工资规则并审核'
        : await this.hasArrangements(tx, row.subjectId, row.domain, row.month) ? blockedMessage : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async recoverScope(id: string, input: PayrollRecoverScopeDto, actor: AuthUser) {
    this.validateRequest(input);
    if (!Number.isSafeInteger(input.snapshotVersion) || input.snapshotVersion < 1 || !hashPattern.test(input.snapshotHash ?? '')
      || !hashPattern.test(input.scopeHash ?? '')) throw new BadRequestException('请重新读取考勤及发薪范围版本');
    return this.prisma.$transaction(async tx => {
      const row = await this.attendance(tx, id, actor, true), requestHash = payrollHash({ id, snapshotVersion: input.snapshotVersion,
        snapshotHash: input.snapshotHash, scopeHash: input.scopeHash, reason: input.reason.trim(), requestId: input.requestId });
      const replay = await this.replay(tx, row.subjectId, actor.id, 'attendance_scope_recovered', input.requestId, requestHash);
      if (replay) {
        const result = await tx.payrollAttendanceSnapshot.findUnique({ where: { id: String(replay.snapshotId) } });
        if (!result || result.subjectId !== row.subjectId || result.domain !== row.domain) throw new ConflictException('恢复回执缺失，请核对历史');
        return result;
      }
      const latest = await tx.payrollAttendanceSnapshot.findFirst({ where: { subjectId: row.subjectId, domain: row.domain, month: row.month }, orderBy: { version: 'desc' } });
      const diff = await this.diff(tx, row);
      if (latest?.id !== id || row.version !== input.snapshotVersion || row.sourceHash !== input.snapshotHash || diff.scopeHash !== input.scopeHash) {
        throw new ConflictException('考勤或已审发薪范围已变化，请重新查看差异后再恢复');
      }
      if (!diff.current.length) throw new ConflictException('当月没有已审发薪范围，请先补齐工资规则并审核');
      if (!diff.added.length && !diff.removed.length) throw new ConflictException('当前考勤与已审发薪范围一致，无需恢复');
      if (await this.hasArrangements(tx, row.subjectId, row.domain, row.month)) throw new ConflictException(blockedMessage);
      const prior = this.payload(row), valid = new Set(diff.current.flatMap(person => person.workDates.map(workDate => key({ employeeId: person.employeeId, workDate }))));
      const retained = prior.days.filter(day => valid.has(key(day)));
      const oldCoverage = new Map((prior.sync?.coverage ?? []).map(day => [key(day), day.complete === true]));
      const existing = new Set(retained.map(key));
      const coverage = diff.current.flatMap(person => person.workDates.map(workDate => ({ employeeId: person.employeeId, workDate,
        complete: existing.has(key({ employeeId: person.employeeId, workDate })) && oldCoverage.get(key({ employeeId: person.employeeId, workDate })) === true }))).sort(byDay);
      const issues = prior.issues.filter(issue => valid.has(key(issue)) && issue.code !== 'SYNC_INCOMPLETE');
      for (const day of coverage) if (!day.complete) issues.push({ employeeId: day.employeeId, workDate: day.workDate,
        code: 'SYNC_INCOMPLETE', message: '恢复后的新增或未完整日期待补同步，不能封账' });
      const retainedMap = new Map(retained.map(day => [key(day), day]));
      const days = coverage.map(day => {
        const previous = retainedMap.get(key(day));
        return { ...(previous ?? { employeeId: day.employeeId, workDate: day.workDate, units: null, required: null, records: [] }),
          issues: issues.filter(issue => key(issue) === key(day)).map(issue => issue.code) };
      });
      const monthDays = payrollDays(row.month);
      const recovery = { previousSnapshotId: row.id, previousSourceHash: row.sourceHash, previousVersion: row.version,
        previousReview: row.review, previousSealedHash: row.sealedHash, scopeHash: diff.scopeHash, scopeEvidence: diff.scopeEvidence,
        removed: diff.removed.map(({ employeeId, workDate }) => ({ employeeId, workDate })),
        added: diff.added.map(({ employeeId, workDate }) => ({ employeeId, workDate })), reason: input.reason.trim(), requestId: input.requestId, actorId: actor.id };
      const facts = { ...(prior.confirmedAbsences === undefined ? {} : { confirmedAbsences: prior.confirmedAbsences.filter(day => valid.has(key(day))) }),
        ...(prior.dingtalk ? { dingtalk: { ...prior.dingtalk, ...(prior.dingtalk.absenceCandidates === undefined ? {}
          : { absenceCandidates: prior.dingtalk.absenceCandidates.filter(day => valid.has(key(day))) }) } } : {}) };
      const payload = { ...prior, ...facts, days, issues, version: payrollHash({ days, issues, coverage, recovery, facts }), recovery,
        sync: { ...prior.sync, requestHash, queryComplete: false, complete: coverage.every(day => day.complete), coverage,
          scope: { employeeIds: diff.current.map(person => person.employeeId), from: monthDays[0], to: monthDays[monthDays.length - 1] } } };
      const review = Array.isArray(row.review) ? row.review.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)
        && diff.current.some(person => (entry.employeeId === undefined || entry.employeeId === person.employeeId)
          && (entry.workDate === undefined || typeof entry.workDate === 'string' && person.workDates.includes(entry.workDate)))) : [];
      const result = await tx.payrollAttendanceSnapshot.create({ data: { subjectId: row.subjectId, domain: row.domain, month: row.month,
        version: row.version + 1, status: 'draft', sourceKey: `scope-recovery:${input.requestId}`, sourceHash: payrollAttendanceHash(payload),
        payload: payrollJson(payload), review: payrollJson(review), createdById: actor.id } });
      await tx.payrollEvent.create({ data: { subjectId: row.subjectId, actorId: actor.id, action: 'attendance_scope_recovered',
        metadata: payrollJson({ ...recovery, requestHash, snapshotId: result.id, sourceHash: result.sourceHash }) } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async openingHistory(id: string, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const row = await this.opening(tx, id, actor), current = this.openingValue(row);
      const events = await tx.payrollEvent.findMany({ where: { subjectId: row.subjectId, action: 'opening_corrected',
        metadata: { path: ['openingId'], equals: row.id } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return { openingId: id, subjectId: row.subjectId, employeeId: row.employeeId, month: row.attributionMonth, itemCode: row.itemCode,
        current, currentHash: payrollHash(current), versions: events.map(event => {
          const metadata = event.metadata as Record<string, Prisma.JsonValue>;
          return { id: event.id, actorId: event.actorId, createdAt: event.createdAt, reason: metadata.reason,
            before: metadata.before, after: metadata.after, beforeHash: metadata.beforeHash, afterHash: metadata.afterHash };
        }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async correctOpening(id: string, input: PayrollCorrectOpeningDto, actor: AuthUser) {
    this.validateRequest(input);
    if (!hashPattern.test(input.expectedHash ?? '') || !input.reference?.trim() || input.reference.trim().length > 200) throw new BadRequestException('请提供当前版本和更正确认凭证');
    const amount = payrollDecimal(input.amount, false, true)!;
    if (amount.decimalPlaces() > 2) throw new BadRequestException('历史已付金额最多两位小数');
    return this.prisma.$transaction(async tx => {
      const row = await this.opening(tx, id, actor), requestHash = payrollHash({ id, expectedHash: input.expectedHash,
        amount: amount.toFixed(2), reference: input.reference.trim(), reason: input.reason.trim(), requestId: input.requestId });
      const replay = await this.replay(tx, row.subjectId, actor.id, 'opening_corrected', input.requestId, requestHash);
      if (replay) {
        if (replay.openingId !== row.id) throw new ConflictException('更正回执不匹配');
        return { opening: this.rowFromValue(replay.after), currentHash: String(replay.afterHash) };
      }
      const before = this.openingValue(row), beforeHash = payrollHash(before);
      if (input.expectedHash !== beforeHash) throw new ConflictException('历史已付登记已更新，请重新读取后更正');
      if (!row.confirmedAt || !row.confirmedById || row.amount === null) throw new ConflictException('请先走原期初确认流程，不可通过更正补造确认');
      if (await this.hasArrangements(tx, row.subjectId, row.domain, row.attributionMonth, { employeeId: row.employeeId, itemCode: row.itemCode })) throw new ConflictException(blockedMessage);
      if (row.amount.equals(amount) && row.reference === input.reference.trim()) throw new BadRequestException('原值与新值一致，无需更正');
      const result = await tx.payrollOpeningBalance.update({ where: { id }, data: { amount, reference: input.reference.trim(), confirmedAt: new Date(), confirmedById: actor.id } });
      const after = this.openingValue(result), afterHash = payrollHash(after);
      await tx.payrollEvent.create({ data: { subjectId: row.subjectId, actorId: actor.id, action: 'opening_corrected', metadata: payrollJson({
        openingId: id, requestId: input.requestId, requestHash, reason: input.reason.trim(), before, after, beforeHash, afterHash }) } });
      // Frozen batch sources are immutable; existing source-hash checks require recalculation before submission.
      return { opening: result, currentHash: afterHash };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private validateRequest(input: { requestId: string; reason: string }) {
    if (!isUUID(input.requestId) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500) throw new BadRequestException('请填写更正原因和有效请求标识');
  }
  private payload(row: PayrollAttendanceSnapshot, verifyIntegrity = true): Payload {
    const value = row.payload as unknown as Payload;
    if (!value || !Array.isArray(value.days) || !Array.isArray(value.issues) || value.month !== row.month
      || value.days.some(day => !day || typeof day.employeeId !== 'string' || !payrollDays(row.month).includes(day.workDate) || !Array.isArray(day.records) || !Array.isArray(day.issues))
      || new Set(value.days.map(key)).size !== value.days.length || verifyIntegrity && payrollAttendanceHash(value) !== row.sourceHash) throw new ConflictException('原考勤来源或结构不完整，或为旧版，请先重新同步并核对历史证据');
    if (value.dingtalk !== undefined && (!value.dingtalk || typeof value.dingtalk !== 'object' || Array.isArray(value.dingtalk))) throw new ConflictException('原考勤取数依据不完整，请先核对历史证据');
    for (const facts of [value.confirmedAbsences, value.dingtalk?.absenceCandidates]) {
      if (facts !== undefined && (!Array.isArray(facts) || facts.some(day => !day || typeof day.employeeId !== 'string' || !payrollDays(row.month).includes(day.workDate)))) {
        throw new ConflictException('原缺勤核定依据不完整，请先核对历史证据');
      }
    }
    return value;
  }
  private async attendance(tx: Prisma.TransactionClient, id: string, actor: AuthUser, writing: boolean) {
    const header = await tx.payrollAttendanceSnapshot.findUnique({ where: { id } });
    if (!header) throw new NotFoundException('考勤版本不存在');
    await this.access.assert(tx, actor, header.subjectId, 'attendance_edit');
    await this.access.assertDomain(tx, header.domain as PayrollDomain);
    await lockPayrollSubject(tx, header.subjectId, header.domain);
    await lockPayrollAuthorization(tx, header.subjectId);
    await this.access.assert(tx, actor, header.subjectId, 'attendance_edit');
    if (writing) await this.access.assert(tx, actor, header.subjectId, 'attendance_seal');
    await this.access.assertDomain(tx, header.domain as PayrollDomain);
    const row = await tx.payrollAttendanceSnapshot.findUnique({ where: { id } });
    if (!row || row.subjectId !== header.subjectId || row.domain !== header.domain) throw new ConflictException('考勤版本已变化，请重新读取');
    return row;
  }
  private async diff(tx: Prisma.TransactionClient, row: PayrollAttendanceSnapshot, verifyIntegrity = true) {
    const prior = this.payload(row, verifyIntegrity), records = await payrollEmployments(tx, row.subjectId, row.month, row.domain as PayrollDomain);
    const eligible = employmentDays(records, row.subjectId, row.month);
    const currentKeys = new Set(eligible.map(key)), oldKeys = new Set(prior.days.map(key));
    const people = await tx.user.findMany({ where: { id: { in: [...new Set([...eligible.map(day => day.employeeId), ...prior.days.map(day => day.employeeId)])] } }, select: { id: true, name: true } });
    const names = new Map(people.map(person => [person.id, person.name]));
    const named = (day: DayKey) => ({ employeeId: day.employeeId, name: names.get(day.employeeId) ?? '历史人员', workDate: day.workDate });
    const current = [...new Set(eligible.map(day => day.employeeId))].sort().map(employeeId => ({ employeeId, name: names.get(employeeId) ?? '待核人员',
      workDates: eligible.filter(day => day.employeeId === employeeId).map(day => day.workDate).sort() }));
    const reviewed = row.domain === 'formal' ? await readReviewedPayrollScopePolicies(tx, row.subjectId) : null;
    const scopeEvidence = { employments: records.map(record => ({ id: record.id, employeeId: record.userId, effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo, entryDate: record.entryDate, leaveDate: record.leaveDate, employeeStatus: record.employeeStatus })).sort((a, b) => a.id.localeCompare(b.id)),
      rules: reviewed ? reviewed.policies.map(policy => ({ id: policy.id, version: policy.version, effectiveFrom: policy.effectiveFrom, effectiveTo: policy.effectiveTo,
        employeeScope: (policy.config as unknown as PayrollPolicyWithScope).employeeScope ?? null,
        approvedHash: reviewed.releases.find(release => release.ruleId === policy.id)!.snapshotHash })).sort((a, b) => a.id.localeCompare(b.id)) : [] };
    return { snapshotId: row.id, subjectId: row.subjectId, month: row.month, snapshotVersion: row.version, snapshotHash: row.sourceHash,
      scopeEvidence: payrollJson(scopeEvidence), scopeHash: payrollHash({ subjectId: row.subjectId, domain: row.domain, month: row.month, scopeEvidence,
        days: eligible.map(day => ({ employeeId: day.employeeId, workDate: day.workDate, employmentId: day.employment.id })).sort(byDay) }),
      current, added: eligible.filter(day => !oldKeys.has(key(day))).sort(byDay).map(named),
      removed: prior.days.filter(day => !currentKeys.has(key(day))).sort(byDay).map(named), retainedDays: prior.days.filter(day => currentKeys.has(key(day))).length };
  }
  private async opening(tx: Prisma.TransactionClient, id: string, actor: AuthUser) {
    const header = await tx.payrollOpeningBalance.findUnique({ where: { id } });
    if (!header) throw new NotFoundException('历史已付登记不存在');
    await this.access.assert(tx, actor, header.subjectId, 'payroll_settle');
    await this.access.assertDomain(tx, header.domain as PayrollDomain);
    await lockPayrollSubject(tx, header.subjectId, header.domain);
    await lockPayrollAuthorization(tx, header.subjectId);
    await this.access.assert(tx, actor, header.subjectId, 'payroll_settle');
    await this.access.assertDomain(tx, header.domain as PayrollDomain);
    const row = await tx.payrollOpeningBalance.findUnique({ where: { id } });
    if (!row || row.subjectId !== header.subjectId || row.domain !== header.domain) throw new ConflictException('登记已变化，请重新读取');
    return row;
  }
  private openingValue(row: PayrollOpeningBalance) {
    return { id: row.id, subjectId: row.subjectId, employeeId: row.employeeId, domain: row.domain, attributionMonth: row.attributionMonth,
      itemCode: row.itemCode, amount: row.amount?.toFixed(2) ?? null, reference: row.reference,
      confirmedAt: row.confirmedAt?.toISOString() ?? null, confirmedById: row.confirmedById };
  }
  private rowFromValue(value: Prisma.JsonValue | undefined): PayrollOpeningBalance {
    const row = value as unknown as ReturnType<PayrollRecoveryService['openingValue']>;
    if (!row?.id || !row.confirmedAt || row.amount === null) throw new ConflictException('历史更正回执缺失');
    return { ...row, amount: new Prisma.Decimal(row.amount), confirmedAt: new Date(row.confirmedAt) };
  }
  private async replay(tx: Prisma.TransactionClient, subjectId: string, actorId: string, action: string, requestId: string, requestHash: string) {
    const event = await tx.payrollEvent.findFirst({ where: { subjectId, action, metadata: { path: ['requestId'], equals: requestId } } });
    if (!event) return null;
    const metadata = event.metadata as Record<string, Prisma.JsonValue>;
    if (event.actorId !== actorId || metadata.requestHash !== requestHash) throw new ConflictException('同一请求标识已有不同内容或操作人，请重新核对');
    return metadata;
  }
  private async hasArrangements(tx: Prisma.TransactionClient, subjectId: string, domain: string, month: string, item?: { employeeId: string; itemCode: string }) {
    const purpose = { in: domain === 'formal' ? ['formal', 'reconciliation'] : ['validation', 'trial'] };
    if (await tx.payrollReservation.findFirst({ where: { subjectId, domain, attributionMonth: month, ...item }, select: { lineId: true } })) return true;
    const line = { attributionMonth: month, ...item };
    if (await tx.payrollLine.findFirst({ where: { ...line, version: { batch: { subjectId, purpose } }, OR: [
      { settlements: { some: {} } }, { version: { status: { in: active } } }, { version: { batch: { status: { in: active } } } },
      { version: { netPayments: { some: item ? { employeeId: item.employeeId } : {} } } },
    ] }, select: { id: true } })) return true;
    return !!await tx.payrollBatch.findFirst({ where: { subjectId, purpose, AND: [
      { OR: [{ month }, { additionalMonths: { has: month } }, { versions: { some: { lines: { some: line } } } }] },
      { OR: [{ status: { in: active } }, { versions: { some: { status: { in: active } } } }, { versions: { some: { netPayments: { some: {} } } } }] },
      ...(item ? [{ versions: { some: { lines: { some: line } } } }] : []),
    ] }, select: { id: true } });
  }
}
