import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollDomain } from './payroll-contracts';
import { normalizeAttendance, PayrollAttendanceInput, PayrollAttendanceResult } from './payroll-attendance-normalizer';
import { lockPayrollAuthorization, lockPayrollSubject, payrollHash } from './payroll-transaction';
import { payrollAttendanceHash } from './payroll-attendance-integrity';

export interface AbsenceCandidate {
  employeeId: string; workDate: string; proofHash: string; hours: string;
  intervals: Array<{ startsAt: string; endsAt: string }>;
}
export interface ConfirmedPayrollAbsence extends AbsenceCandidate {
  id: string; reference: string; proposedById: string; proposedAt: string; approvedById: string; approvedAt: string;
  records: PayrollAttendanceInput['records']; note: string;
}
type Proposal = AbsenceCandidate & { kind: 'absence_proposed'; id: string; reference: string; actorId: string; at: string };
type Payload = PayrollAttendanceResult & {
  dingtalk?: { schema?: number; provider?: string; absenceCandidates?: AbsenceCandidate[]; [key: string]: unknown };
  confirmedAbsences?: ConfirmedPayrollAbsence[];
  sync?: { requestHash: string; scope: { employeeIds: string[]; from: string; to: string }; queryComplete: boolean;
    complete: boolean; coverage: Array<{ employeeId: string; workDate: string; complete: boolean }> };
};
type Snapshot = { id: string; subjectId: string; domain: string; month: string; version: number; status: string;
  sourceHash: string; payload: Payload; review: unknown };
const D = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_DOWN });
const cleanNote = (value: string, required = false) => {
  if (typeof value !== 'string' || value.length > 500 || required && !value.trim()) throw new BadRequestException('请填写有效的核定依据或办理原因');
  return value.trim();
};
const reviews = (row: Snapshot): Array<Record<string, any>> => Array.isArray(row.review) ? row.review : [];
const key = (row: { employeeId: string; workDate: string }) => `${row.employeeId}:${row.workDate}`;

@Injectable()
export class PayrollAbsenceService {
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollAccessService) {}

  async detail(id: string, actor: AuthUser) {
    const row = await this.prisma.payrollAttendanceSnapshot.findUnique({ where: { id } }) as unknown as Snapshot | null;
    if (!row) throw new NotFoundException('考勤版本不存在');
    await this.access.assertDomain(this.prisma, row.domain as PayrollDomain);
    try { await this.access.assert(this.prisma, actor, row.subjectId, 'attendance_edit'); }
    catch (error) { if (!(error instanceof ForbiddenException)) throw error; await this.access.assert(this.prisma, actor, row.subjectId, 'attendance_seal'); }
    const actorIds = [...new Set(reviews(row).flatMap(entry => typeof entry.actorId === 'string' ? [entry.actorId] : []))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
    return { snapshotId: row.id, version: row.version, actors, review: reviews(row),
      candidates: row.payload.dingtalk?.absenceCandidates ?? [], confirmed: row.payload.confirmedAbsences ?? [] };
  }

  async propose(id: string, input: { expectedVersion: number; employeeId: string; workDate: string; reference: string; requestId: string }, actor: AuthUser) {
    return this.transaction(async tx => {
      const row = await this.row(tx, id, actor, 'attendance_edit');
      const reference = cleanNote(input.reference, true);
      const previous = reviews(row).find(entry => entry.kind === 'absence_proposed' && entry.id === input.requestId);
      if (previous) {
        if (previous.actorId !== actor.id || previous.employeeId !== input.employeeId || previous.workDate !== input.workDate || previous.reference !== reference) {
          throw new ConflictException('同一核定请求的内容已变化');
        }
        return row;
      }
      await this.latest(tx, row, input.expectedVersion);
      if (!/^[a-f0-9-]{36}$/i.test(input.requestId)) throw new BadRequestException('核定请求标识不正确');
      const candidate = this.candidate(row, input.employeeId, input.workDate);
      if ((row.payload.confirmedAbsences ?? []).some(entry => key(entry) === key(candidate)) || reviews(row).some(entry =>
        entry.kind === 'absence_proposed' && key(entry as Proposal) === key(candidate)
        && !reviews(row).some(decision => decision.proposalId === entry.id && ['absence_returned', 'absence_revoked'].includes(decision.kind)))) {
        throw new ConflictException('该人日已有核定或待核申请，请先办理原申请');
      }
      const proposal: Proposal = { ...candidate, kind: 'absence_proposed', id: input.requestId, reference, actorId: actor.id, at: new Date().toISOString() };
      const updated = await tx.payrollAttendanceSnapshot.update({ where: { id }, data: { review: this.json([...reviews(row), proposal]) } });
      await this.event(tx, row, actor, 'absence_proposed', { proposalId: proposal.id, employeeId: candidate.employeeId, workDate: candidate.workDate, reference });
      return updated as unknown as Snapshot;
    });
  }

  async decide(id: string, proposalId: string, input: { expectedVersion: number; decision: 'approve' | 'return' | 'revoke'; note: string }, actor: AuthUser) {
    return this.transaction(async tx => {
      const row = await this.row(tx, id, actor, 'attendance_seal');
      if (!['approve', 'return', 'revoke'].includes(input.decision)) throw new BadRequestException('不支持的核定操作');
      const note = cleanNote(input.note, input.decision !== 'approve');
      const sourceKey = `absence-${input.decision}:${proposalId}`;
      const cached = await tx.payrollAttendanceSnapshot.findUnique({ where: { subjectId_domain_month_sourceKey: {
        subjectId: row.subjectId, domain: row.domain, month: row.month, sourceKey } } }) as unknown as Snapshot | null;
      if (cached) {
        const decision = reviews(cached).find(entry => entry.proposalId === proposalId && entry.decision === input.decision);
        if (decision?.actorId !== actor.id || decision.note !== note) throw new ConflictException('核定已由其他请求办理，请刷新查看');
        return cached;
      }
      await this.latest(tx, row, input.expectedVersion);
      const oldFacts = row.payload.confirmedAbsences ?? [];
      const confirmed = oldFacts.find(entry => entry.id === proposalId);
      if (input.decision === 'revoke' && !confirmed) throw new ConflictException('当前版本没有该有效核定');
      const proposal: Proposal | undefined = input.decision === 'revoke'
        ? { ...confirmed!, kind: 'absence_proposed', actorId: confirmed!.proposedById, at: confirmed!.proposedAt }
        : reviews(row).find(entry => entry.kind === 'absence_proposed' && entry.id === proposalId) as Proposal | undefined;
      if (!proposal) throw new NotFoundException('缺勤核定申请不存在');
      if (input.decision !== 'revoke' && reviews(row).some(entry => entry.proposalId === proposalId && entry.kind === 'absence_returned')) throw new ConflictException('该申请已退回，请重新提出核定');
      const decision = { kind: `absence_${input.decision === 'approve' ? 'confirmed' : input.decision === 'return' ? 'returned' : 'revoked'}`,
        decision: input.decision, proposalId, employeeId: proposal.employeeId, workDate: proposal.workDate,
        actorId: actor.id, at: new Date().toISOString(), note };
      if (input.decision === 'return') {
        if (row.payload.confirmedAbsences?.some(entry => entry.id === proposalId)) throw new ConflictException('已核定的记录请使用撤销核定');
        const updated = await tx.payrollAttendanceSnapshot.update({ where: { id }, data: { review: this.json([...reviews(row), decision]) } });
        await this.event(tx, row, actor, 'absence_returned', { proposalId, note });
        return updated as unknown as Snapshot;
      }
      let facts: ConfirmedPayrollAbsence[];
      if (input.decision === 'revoke') {
        facts = oldFacts.filter(entry => entry.id !== proposalId);
      } else {
        const candidate = this.candidate(row, proposal.employeeId, proposal.workDate);
        if (candidate.proofHash !== proposal.proofHash || payrollHash(candidate.intervals) !== payrollHash(proposal.intervals)) {
          throw new ConflictException('排班或来源已变化，请重新核对并提出申请');
        }
        if (oldFacts.some(entry => key(entry) === key(candidate))) throw new ConflictException('该人日已经核定');
        const records = candidate.intervals.map((interval, index) => ({ ...interval, employeeId: candidate.employeeId, workDate: candidate.workDate,
          sourceId: `hr-absence:${proposalId}:${index}`, sourceVersion: 1, type: 'absence' as const, state: 'effective' as const,
          hours: new D(Date.parse(interval.endsAt) - Date.parse(interval.startsAt)).div(3600000).toFixed(), unit: 'hour' as const }));
        facts = [...oldFacts, { ...candidate, id: proposalId, reference: proposal.reference, proposedById: proposal.actorId,
          proposedAt: proposal.at, approvedById: actor.id, approvedAt: decision.at, note, records }];
      }
      const payload = this.rebuild(row.payload, facts, proposal, input.decision === 'approve');
      const created = await tx.payrollAttendanceSnapshot.create({ data: { subjectId: row.subjectId, domain: row.domain, month: row.month,
        version: row.version + 1, sourceKey, sourceHash: payrollAttendanceHash(payload), payload: this.json(payload),
        review: this.json([...reviews(row), decision]), createdById: actor.id } });
      const effective = input.decision === 'revoke' ? confirmed! : facts.find(entry => entry.id === proposalId)!;
      await this.event(tx, row, actor, input.decision === 'approve' ? 'absence_confirmed' : 'absence_revoked', {
        proposalId, fromSnapshotId: row.id, snapshotId: created.id, reference: effective.reference, proofHash: effective.proofHash,
        sourceIds: effective.records.map(record => record.sourceId), note });
      return created as unknown as Snapshot;
    });
  }

  private candidate(row: Snapshot, employeeId: string, workDate: string): AbsenceCandidate {
    const proof = row.payload.dingtalk;
    const candidate = proof?.schema === 1 && proof.provider === 'dingtalk'
      ? proof.absenceCandidates?.find(entry => entry.employeeId === employeeId && entry.workDate === workDate) : undefined;
    const day = row.payload.days?.find(entry => entry.employeeId === employeeId && entry.workDate === workDate);
    if (!candidate || !day || day.required !== true || !/^[a-f0-9]{64}$/.test(candidate.proofHash)
      || !candidate.intervals?.length || candidate.intervals.length > 12 || !/^\d+(?:\.\d+)?$/.test(candidate.hours) || !new D(candidate.hours).gt(0)) {
      throw new ConflictException('缺少可核验的排班及完整查询证据，请先重新同步；不能仅凭缺卡核定缺勤');
    }
    let priorEnd = 0, hours = new D(0);
    for (const interval of candidate.intervals) {
      const from = Date.parse(interval.startsAt), to = Date.parse(interval.endsAt);
      if (![interval.startsAt, interval.endsAt].every(value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value))
        || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 48 * 3600000 || from < priorEnd) {
        throw new ConflictException('缺勤排班区间证据不完整或存在重叠，请核对来源');
      }
      priorEnd = to; hours = hours.plus(new D(to - from).div(3600000));
    }
    if (hours.minus(candidate.hours).abs().gt('1e-30')) throw new ConflictException('排班区间和缺勤时长不一致');
    return structuredClone(candidate);
  }

  private rebuild(prior: Payload, facts: ConfirmedPayrollAbsence[], target: Proposal, approved: boolean): Payload {
    if (!prior.sync?.coverage?.length) throw new ConflictException('原考勤缺少覆盖证据，请先重新同步');
    const manualIds = new Set((prior.confirmedAbsences ?? []).flatMap(entry => entry.records.map(record => record.sourceId)));
    const normalized = normalizeAttendance({ month: prior.month,
      expected: prior.days.filter(day => day.units !== null && day.required !== null).map(day => ({ employeeId: day.employeeId,
        workDate: day.workDate, units: day.units!, required: day.required! })),
      records: [...prior.days.flatMap(day => day.records.filter(record => !manualIds.has(record.sourceId))),
        ...facts.flatMap(entry => entry.records)] as PayrollAttendanceInput['records'] });
    if (approved && normalized.days.find(day => key(day) === key(target))?.issues.length) throw new ConflictException('核定区间与当前考勤冲突，请先核对原始来源');
    const repaired = new Set(['MISSING_RECORD', 'MISSING_REGULAR_COVERAGE', 'SYNC_INCOMPLETE']);
    for (const issue of prior.issues) if (!(key(issue) === key(target) && repaired.has(issue.code))
      && !normalized.issues.some(entry => key(entry) === key(issue) && entry.code === issue.code)) normalized.issues.push(issue);
    const coverage = prior.sync.coverage.map(day => key(day) === key(target) ? { ...day, complete: approved } : { ...day });
    for (const day of coverage.filter(entry => !entry.complete)) if (!normalized.issues.some(issue => key(issue) === key(day) && issue.code === 'SYNC_INCOMPLETE')) {
      normalized.issues.push({ ...day, code: 'SYNC_INCOMPLETE', message: '该人日仍需完整同步和核对' });
    }
    for (const day of normalized.days) day.issues = normalized.issues.filter(issue => key(issue) === key(day)).map(issue => issue.code);
    const complete = coverage.every(day => day.complete) && !normalized.issues.length;
    return { ...normalized, ...(prior.dingtalk ? { dingtalk: prior.dingtalk } : {}), confirmedAbsences: facts,
      sync: { ...prior.sync, coverage, complete, queryComplete: complete, requestHash: payrollHash({ prior: prior.sync.requestHash, facts }) } };
  }

  private async row(tx: Prisma.TransactionClient, id: string, actor: AuthUser, capability: 'attendance_edit' | 'attendance_seal'): Promise<Snapshot> {
    const header = await tx.payrollAttendanceSnapshot.findUnique({ where: { id }, select: { id: true, subjectId: true, domain: true } });
    if (!header) throw new NotFoundException('考勤版本不存在');
    await this.access.assert(tx, actor, header.subjectId, capability); await this.access.assertDomain(tx, header.domain as PayrollDomain);
    await lockPayrollSubject(tx, header.subjectId, header.domain); await lockPayrollAuthorization(tx, header.subjectId);
    await this.access.assert(tx, actor, header.subjectId, capability);
    const row = await tx.payrollAttendanceSnapshot.findUnique({ where: { id } });
    if (!row || row.subjectId !== header.subjectId || row.domain !== header.domain) throw new ConflictException('考勤版本已变化，请刷新');
    return row as unknown as Snapshot;
  }
  private async latest(tx: Prisma.TransactionClient, row: Snapshot, expected: number) {
    const latest = await tx.payrollAttendanceSnapshot.findFirst({ where: { subjectId: row.subjectId, domain: row.domain, month: row.month }, orderBy: { version: 'desc' } });
    if (row.status !== 'draft' || row.version !== expected || latest?.id !== row.id) throw new ConflictException('请在最新未封账版本办理核定');
    if (payrollAttendanceHash(row.payload) !== row.sourceHash) throw new ConflictException('考勤内容与来源凭据不一致或为旧版，请先重新同步，不能直接核定缺勤');
  }
  private json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)); }
  private event(tx: Prisma.TransactionClient, row: Snapshot, actor: AuthUser, action: string, metadata: object) {
    return tx.payrollEvent.create({ data: { subjectId: row.subjectId, actorId: actor.id, action, metadata: this.json({ ...metadata, fromSnapshotId: row.id }) } });
  }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60000 });
  }
}
