import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { isUUID, validateSync } from 'class-validator';
import { PrismaService } from '@/prisma/prisma.service';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollActor, PayrollCapability } from './payroll-access';
import { PayrollCapture, PayrollSourceReader, PAYROLL_ITEM_CODES } from './payroll-contracts';
import { assertPayrollVersion, lockPayrollSubject, payrollHash, payrollMonth } from './payroll-transaction';
import { assertPayrollNetFresh, assertPayrollNetLines, assertPayrollNetShape, netSnapshotHash } from './payroll-net';
import { parsePayrollReadinessRecord, payrollReadinessRequestHash, PayrollReadinessDecisionDto, PayrollReadinessDetail,
  PayrollReadinessNoteDto, PayrollReadinessRecord, PayrollReadinessRow, PayrollReadinessSubmitDto } from './dto/payroll-readiness.dto';

const REQUEST = 'payroll_readiness_request:';
const RECEIPT = 'payroll_formal_readiness:';
const versionInclude = { lines: true } satisfies Prisma.PayrollVersionInclude;
type Version = Prisma.PayrollVersionGetPayload<{ include: typeof versionInclude }>;
type Batch = Prisma.PayrollBatchGetPayload<{ include: { versions: { include: typeof versionInclude } } }>;
type Scope = { edit: boolean; view: boolean; review: boolean; approve: boolean };
const changed = () => new ConflictException('对账核算版本、工资来源或扣缴已变化，请重新计算并提交首月签收');

@Injectable()
export class PayrollReadinessService {
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollAccessService,
    @Inject('PAYROLL_SOURCE_READER') private readonly sources: PayrollSourceReader) {}

  async list(subjectId: string, actor: PayrollActor): Promise<PayrollReadinessRow[]> {
    this.uuid(subjectId);
    return this.transaction(async tx => {
      await this.access.assertDomain(tx, 'reconciliation');
      const scope = await this.scope(tx, subjectId, actor);
      const records = await tx.systemConfig.findMany({ where: { key: { startsWith: REQUEST }, AND: [
        { value: { path: ['subjectId'], equals: subjectId } },
        ...(!scope.edit && !scope.view ? [{ value: { path: ['approvalPath'], array_contains: [actor.id] } }] : []),
      ] }, orderBy: [{ updatedAt: 'desc' }, { key: 'desc' }] });
      return records.map(row => parsePayrollReadinessRecord(row.value, row.key.slice(REQUEST.length)))
        .filter(record => record.subjectId === subjectId && this.visible(record, actor, scope)).map(record => this.row(record));
    });
  }

  async submit(raw: PayrollReadinessSubmitDto, actor: PayrollActor): Promise<PayrollReadinessDetail> {
    const input = this.input(PayrollReadinessSubmitDto, raw); this.actor(actor);
    return this.transaction(async tx => {
      const header = await tx.payrollBatch.findUnique({ where: { id: input.batchId }, select: { subjectId: true, purpose: true } });
      if (!header) throw new NotFoundException('对账批次不存在');
      await this.access.assertDomain(tx, 'reconciliation');
      await this.access.assert(tx, actor, header.subjectId, 'payroll_edit');
      await lockPayrollSubject(tx, header.subjectId, 'formal');
      await this.access.assert(tx, actor, header.subjectId, 'payroll_edit');
      await this.access.assertDomain(tx, 'reconciliation');
      const batch = await this.batch(tx, input.batchId);
      if (batch.subjectId !== header.subjectId) throw changed();
      const identity = { id: input.requestId, batchId: input.batchId, batchVersion: input.expectedVersion,
        firstMonth: input.firstMonth, reference: input.reference, submittedById: actor.id };
      const existing = await tx.systemConfig.findUnique({ where: { key: REQUEST + input.requestId } });
      if (existing) {
        const previous = parsePayrollReadinessRecord(existing.value, input.requestId);
        if (previous.subjectId !== batch.subjectId || previous.requestHash !== payrollReadinessRequestHash(identity)) {
          throw new ConflictException('该签收请求标识已用于其他内容或经办人');
        }
        return this.detailFor(tx, previous, actor);
      }
      assertPayrollVersion(batch.version, input.expectedVersion);
      if (batch.purpose !== 'reconciliation' || batch.status !== 'calculated' || input.firstMonth < batch.month) throw changed();
      const receipt = await tx.systemConfig.findUnique({ where: { key: RECEIPT + batch.subjectId } });
      if ((receipt?.value as { state?: string } | null)?.state === 'approved') throw new ConflictException('本主体已有签收，请先由原最终签收人明确撤销后再提交');
      const pending = await tx.systemConfig.findMany({ where: { key: { startsWith: REQUEST }, AND: [
        { value: { path: ['subjectId'], equals: batch.subjectId } },
      ] } });
      if (pending.some(row => parsePayrollReadinessRecord(row.value, row.key.slice(REQUEST.length)).status === 'pending')) {
        throw new ConflictException('本主体已有首月签收在办理，请先完成、退回或撤回');
      }
      const version = batch.versions[0];
      if (!version) throw changed();
      await this.path(tx, batch.subjectId, version, actor.id);
      await this.fresh(tx, batch, version);
      await this.access.assert(tx, actor, batch.subjectId, 'payroll_edit');
      await this.path(tx, batch.subjectId, version, actor.id);
      const record: PayrollReadinessRecord = { schema: 1, ...identity, subjectId: batch.subjectId,
        versionId: version.id, calculationVersion: version.version, version: 1, month: batch.month,
        sourceHash: version.sourceHash, netHash: netSnapshotHash(version.netSnapshot), status: 'pending',
        approvalStep: 0, approvalPath: [...version.approvalPath], reviewerCount: version.reviewerCount,
        submittedAt: new Date().toISOString(), approvedAt: null, closedAt: null, closedById: null, closeNote: null, decisions: [],
        requestHash: payrollReadinessRequestHash(identity) };
      parsePayrollReadinessRecord(record, record.id);
      await tx.systemConfig.create({ data: { key: REQUEST + record.id, value: this.json(record), updatedBy: actor.id } });
      await this.event(tx, record, actor, 'readiness_submitted', null);
      return this.detailFor(tx, record, actor);
    });
  }

  async detail(id: string, actor: PayrollActor): Promise<PayrollReadinessDetail> {
    this.uuid(id); this.actor(actor);
    return this.transaction(async tx => {
      await this.access.assertDomain(tx, 'reconciliation');
      return this.detailFor(tx, await this.record(tx, id), actor);
    });
  }

  async decide(id: string, raw: PayrollReadinessDecisionDto, actor: PayrollActor): Promise<PayrollReadinessDetail> {
    const input = this.input(PayrollReadinessDecisionDto, raw);
    if (input.decision === 'return' && !input.note) throw new BadRequestException('退回时请填写核对说明');
    return this.write(id, actor, async (tx, record) => {
      assertPayrollVersion(record.version, input.expectedVersion);
      if (record.status !== 'pending') throw new ConflictException('该签收请求已处理，请刷新查看');
      if (record.approvalPath[record.approvalStep] !== actor.id || record.submittedById === actor.id) throw new ForbiddenException('仅当前指定的独立复核或签收人可以办理');
      await this.access.assert(tx, actor, record.subjectId, record.approvalStep < record.reviewerCount ? 'payroll_review' : 'payroll_approve');
      if (input.decision === 'approve') {
        await this.access.assert(tx, { id: record.submittedById }, record.subjectId, 'payroll_edit');
        const batch = await this.batch(tx, record.batchId), version = batch.versions[0];
        if (!version || batch.subjectId !== record.subjectId || batch.month !== record.month) throw changed();
        this.frozen(record, version);
        await this.path(tx, record.subjectId, version, record.submittedById);
        await this.fresh(tx, batch, version);
        await this.access.assert(tx, { id: record.submittedById }, record.subjectId, 'payroll_edit');
        await this.path(tx, record.subjectId, version, record.submittedById);
      }
      const now = new Date().toISOString();
      const next: PayrollReadinessRecord = { ...record, version: record.version + 1,
        decisions: [...record.decisions, { step: record.approvalStep, actorId: actor.id, decision: input.decision, note: input.note, decidedAt: now }] };
      if (input.decision === 'return') {
        next.status = 'returned'; next.closedAt = now; next.closedById = actor.id; next.closeNote = input.note;
      } else {
        next.approvalStep++;
        if (next.approvalStep === next.approvalPath.length) {
          next.status = 'approved'; next.approvedAt = now;
          const key = RECEIPT + record.subjectId, current = await tx.systemConfig.findUnique({ where: { key } });
          if ((current?.value as { state?: string } | null)?.state === 'approved') throw new ConflictException('本主体签收状态已变化，请先核对现有签收');
          const value = { subjectId: record.subjectId, state: 'approved', firstMonth: record.firstMonth, reference: record.reference,
            approvedAt: now, approvedById: actor.id, requestId: record.id };
          await tx.systemConfig.upsert({ where: { key }, create: { key, value, updatedBy: actor.id }, update: { value, updatedBy: actor.id } });
        }
      }
      await this.save(tx, next, actor);
      await this.event(tx, next, actor, input.decision === 'return' ? 'readiness_returned' : next.status === 'approved' ? 'readiness_approved' : 'readiness_reviewed', record.version);
      return this.detailFor(tx, next, actor);
    });
  }

  async withdraw(id: string, raw: PayrollReadinessNoteDto, actor: PayrollActor): Promise<PayrollReadinessDetail> {
    const input = this.input(PayrollReadinessNoteDto, raw);
    return this.write(id, actor, async (tx, record) => {
      if (record.submittedById !== actor.id) throw new ForbiddenException('仅原经办人可以撤回首月签收');
      await this.access.assert(tx, actor, record.subjectId, 'payroll_edit');
      assertPayrollVersion(record.version, input.expectedVersion);
      if (record.status !== 'pending') throw new ConflictException('仅办理中的签收请求可以撤回');
      const next: PayrollReadinessRecord = { ...record, version: record.version + 1, status: 'withdrawn',
        closedAt: new Date().toISOString(), closedById: actor.id, closeNote: input.note };
      await this.save(tx, next, actor); await this.event(tx, next, actor, 'readiness_withdrawn', record.version);
      return this.detailFor(tx, next, actor);
    });
  }

  async revoke(id: string, raw: PayrollReadinessNoteDto, actor: PayrollActor): Promise<PayrollReadinessDetail> {
    const input = this.input(PayrollReadinessNoteDto, raw);
    return this.write(id, actor, async (tx, record) => {
      if (record.approvalPath.at(-1) !== actor.id) throw new ForbiddenException('仅原最终签收人可以明确撤销签收');
      await this.access.assert(tx, actor, record.subjectId, 'payroll_approve');
      assertPayrollVersion(record.version, input.expectedVersion);
      if (record.status !== 'approved') throw new ConflictException('仅当前已批准的签收可以撤销');
      const key = RECEIPT + record.subjectId, current = await tx.systemConfig.findUnique({ where: { key } });
      const receipt = current?.value as Record<string, Prisma.JsonValue> | null;
      if (!receipt || receipt.subjectId !== record.subjectId || receipt.state !== 'approved' || receipt.requestId !== record.id
        || receipt.approvedById !== actor.id || receipt.firstMonth !== record.firstMonth || receipt.approvedAt !== record.approvedAt) throw changed();
      const now = new Date().toISOString();
      const next: PayrollReadinessRecord = { ...record, version: record.version + 1, status: 'revoked', closedAt: now, closedById: actor.id, closeNote: input.note };
      await tx.systemConfig.update({ where: { key }, data: { value: { ...receipt, state: 'revoked', revokedAt: now,
        revokedById: actor.id, revokeNote: input.note }, updatedBy: actor.id } });
      await this.save(tx, next, actor); await this.event(tx, next, actor, 'readiness_revoked', record.version);
      return this.detailFor(tx, next, actor);
    });
  }

  private async fresh(tx: Prisma.TransactionClient, batch: Batch, version: Version) {
    if (batch.purpose !== 'reconciliation' || batch.status !== 'calculated' || version.status !== 'calculated' || version.voidedAt
      || !Array.isArray(version.issues) || version.issues.length || !version.lines.length) throw changed();
    assertPayrollNetShape(version.netSnapshot);
    assertPayrollNetLines(version.netSnapshot, version.lines, version.gross);
    if (version.payDate?.toISOString().slice(0, 10) !== version.netSnapshot.payDate) throw changed();
    for (const line of version.lines) {
      const amounts = [line.entitlement, line.paidBefore, line.amount];
      if (amounts.some(amount => amount === null || !amount.isFinite()) || !line.entitlement!.minus(line.paidBefore!).eq(line.amount!)) throw changed();
      if (line.status !== 'ready' && !(line.status === 'not_applicable' && (line.evidence as { applicability?: string } | null)?.applicability === 'not_applicable'
        && amounts.every(amount => amount!.isZero()))) throw changed();
    }
    const months = [batch.month, ...batch.additionalMonths].sort();
    if (new Set(months).size !== months.length || months.length > 12) throw changed();
    const captures: Array<{ month: string; capture: PayrollCapture }> = [];
    for (const month of months) {
      payrollMonth(month);
      let capture: PayrollCapture;
      try { capture = await this.sources.capture(tx, batch.subjectId, month, 'formal'); } catch { throw changed(); }
      const source = capture?.sources as { subjectId?: string; month?: string; domain?: string } | null;
      if (!capture || !/^[a-f0-9]{64}$/.test(capture.sourceHash) || !Array.isArray(capture.issues) || capture.issues.length || capture.gross === null
        || source?.subjectId !== batch.subjectId || source.month !== month || source.domain !== 'formal'
        || capture.reviewerCount !== version.reviewerCount || netSnapshotHash(capture.approvalPath) !== netSnapshotHash(version.approvalPath)) throw changed();
      captures.push({ month, capture });
    }
    if (payrollHash(captures.map(({ month, capture }) => ({ month, sourceHash: capture.sourceHash }))) !== version.sourceHash
      || netSnapshotHash({ months: captures.map(({ month, capture }) => ({ month, sources: capture.sources })) }) !== netSnapshotHash(version.sources)
      || !version.gross || !captures.reduce((sum, { capture }) => sum.plus(capture.gross!), new Prisma.Decimal(0)).eq(version.gross)) throw changed();
    const canonical = (lines: Array<{ employeeId: string; attributionMonth: string; itemCode: string; status: string;
      entitlement: Prisma.Decimal | string | null; paidBefore: Prisma.Decimal | string | null; amount: Prisma.Decimal | string | null; evidence: unknown }>) =>
      lines.map(line => ({ employeeId: line.employeeId, attributionMonth: line.attributionMonth, itemCode: line.itemCode, status: line.status,
        entitlement: line.entitlement === null ? null : new Prisma.Decimal(line.entitlement).toFixed(2),
        paidBefore: line.paidBefore === null ? null : new Prisma.Decimal(line.paidBefore).toFixed(2),
        amount: line.amount === null ? null : new Prisma.Decimal(line.amount).toFixed(2), evidence: line.evidence }))
        .sort((a, b) => `${a.employeeId}:${a.attributionMonth}:${a.itemCode}`.localeCompare(`${b.employeeId}:${b.attributionMonth}:${b.itemCode}`));
    const currentLines = captures.flatMap(({ capture }) => capture.lines);
    if (!currentLines.length || currentLines.some(line => !(PAYROLL_ITEM_CODES as readonly string[]).includes(line.itemCode))
      || netSnapshotHash(canonical(currentLines)) !== netSnapshotHash(canonical(version.lines))) throw changed();
    await assertPayrollNetFresh(tx, batch, version.netSnapshot, 'formal', version.id);
  }

  private async path(tx: Prisma.TransactionClient, subjectId: string, version: Version, submitter: string) {
    if (version.reviewerCount < 1 || version.reviewerCount >= version.approvalPath.length || version.approvalPath.length > 20
      || new Set(version.approvalPath).size !== version.approvalPath.length || version.approvalPath.includes(submitter)) throw changed();
    for (const [step, id] of version.approvalPath.entries()) await this.access.assert(tx, { id }, subjectId,
      step < version.reviewerCount ? 'payroll_review' : 'payroll_approve');
  }
  private frozen(record: PayrollReadinessRecord, version: Version) {
    if (version.id !== record.versionId || version.batchId !== record.batchId || version.version !== record.calculationVersion
      || version.sourceHash !== record.sourceHash || netSnapshotHash(version.netSnapshot) !== record.netHash
      || version.reviewerCount !== record.reviewerCount || netSnapshotHash(version.approvalPath) !== netSnapshotHash(record.approvalPath)) throw changed();
  }
  private async detailFor(tx: Prisma.TransactionClient, record: PayrollReadinessRecord, actor: PayrollActor): Promise<PayrollReadinessDetail> {
    const scope = await this.scope(tx, record.subjectId, actor);
    if (!this.visible(record, actor, scope)) throw new ForbiddenException('没有该首月签收请求的查看权限');
    const version = await tx.payrollVersion.findUnique({ where: { id: record.versionId }, include: versionInclude });
    if (!version) throw changed();
    this.frozen(record, version);
    assertPayrollNetShape(version.netSnapshot);
    assertPayrollNetLines(version.netSnapshot, version.lines, version.gross);
    const actors = await tx.user.findMany({ where: { id: { in: [...new Set([record.submittedById, ...record.approvalPath])] } }, select: { id: true, name: true } });
    return { request: this.row(record), netSnapshot: version.netSnapshot,
      lines: version.lines.map(line => ({ id: line.id, employeeId: line.employeeId, attributionMonth: line.attributionMonth, itemCode: line.itemCode,
        status: line.status, entitlement: line.entitlement?.toFixed(2) ?? null, paidBefore: line.paidBefore?.toFixed(2) ?? null,
        amount: line.amount?.toFixed(2) ?? null, evidence: line.evidence })), actors,
      canDecide: record.status === 'pending' && record.approvalPath[record.approvalStep] === actor.id
        && (record.approvalStep < record.reviewerCount ? scope.review : scope.approve),
      canWithdraw: record.status === 'pending' && record.submittedById === actor.id && scope.edit,
      canRevoke: record.status === 'approved' && record.approvalPath.at(-1) === actor.id && scope.approve };
  }
  private visible(record: PayrollReadinessRecord, actor: PayrollActor, scope: Scope) {
    return scope.edit || scope.view || scope.review && record.approvalPath.slice(0, record.reviewerCount).includes(actor.id)
      || scope.approve && record.approvalPath.slice(record.reviewerCount).includes(actor.id);
  }
  private async scope(tx: Prisma.TransactionClient, subjectId: string, actor: PayrollActor): Promise<Scope> {
    this.actor(actor);
    const has = async (capability: PayrollCapability) => {
      try { await this.access.assert(tx, actor, subjectId, capability); return true; }
      catch (error) { if (error instanceof ForbiddenException) return false; throw error; }
    };
    const scope = { edit: await has('payroll_edit'), view: await has('payroll_view'), review: await has('payroll_review'), approve: await has('payroll_approve') };
    if (!Object.values(scope).some(Boolean)) throw new ForbiddenException('没有本主体首月签收办理或指定查看权限');
    return scope;
  }
  private async write<T>(id: string, actor: PayrollActor, work: (tx: Prisma.TransactionClient, record: PayrollReadinessRecord) => Promise<T>) {
    this.uuid(id); this.actor(actor);
    return this.transaction(async tx => {
      await this.access.assertDomain(tx, 'reconciliation');
      const header = await this.record(tx, id);
      const scope = await this.scope(tx, header.subjectId, actor);
      if (!this.visible(header, actor, scope)) throw new ForbiddenException('没有该首月签收请求的办理权限');
      await lockPayrollSubject(tx, header.subjectId, 'formal');
      await this.access.assertDomain(tx, 'reconciliation');
      const record = await this.record(tx, id);
      if (record.subjectId !== header.subjectId) throw changed();
      return work(tx, record);
    });
  }
  private async record(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.systemConfig.findUnique({ where: { key: REQUEST + id } });
    if (!row) throw new NotFoundException('首月签收请求不存在');
    return parsePayrollReadinessRecord(row.value, id);
  }
  private async batch(tx: Prisma.TransactionClient, id: string): Promise<Batch> {
    const batch = await tx.payrollBatch.findUnique({ where: { id }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: versionInclude } } });
    if (!batch) throw new NotFoundException('对账批次不存在');
    return batch;
  }
  private row(record: PayrollReadinessRecord): PayrollReadinessRow {
    const { schema: _schema, requestHash: _hash, batchVersion: _batchVersion, ...row } = record;
    return row;
  }
  private async save(tx: Prisma.TransactionClient, record: PayrollReadinessRecord, actor: PayrollActor) {
    parsePayrollReadinessRecord(record, record.id);
    await tx.systemConfig.update({ where: { key: REQUEST + record.id }, data: { value: this.json(record), updatedBy: actor.id, updatedAt: new Date() } });
  }
  private event(tx: Prisma.TransactionClient, record: PayrollReadinessRecord, actor: PayrollActor, action: string, beforeVersion: number | null) {
    return tx.payrollEvent.create({ data: { subjectId: record.subjectId, batchId: record.batchId, version: record.calculationVersion, actorId: actor.id, action,
      metadata: { requestId: record.id, beforeVersion, afterVersion: record.version, status: record.status, approvalStep: record.approvalStep,
        versionId: record.versionId, sourceHash: record.sourceHash, netHash: record.netHash, firstMonth: record.firstMonth,
        note: record.closeNote ?? record.decisions.at(-1)?.note ?? null } } });
  }
  private input<T extends object>(type: ClassConstructor<T>, raw: unknown): T {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('签收办理参数不正确');
    const input = plainToInstance(type, raw);
    if (validateSync(input, { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException('签收办理参数不完整或包含不允许的字段');
    return input;
  }
  private uuid(id: string) { if (typeof id !== 'string' || !isUUID(id)) throw new BadRequestException('签收请求或主体标识不正确'); }
  private actor(actor: PayrollActor) { if (!actor || typeof actor.id !== 'string' || !isUUID(actor.id) || actor.isAssessorOnly) throw new ForbiddenException('请使用当前已授权的薪酬账号办理'); }
  private json(value: object): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)); }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }).catch(error => {
      if (error?.code === 'P2002' || error?.code === 'P2034') throw new ConflictException('签收记录已被其他操作更新，请刷新后重试');
      throw error;
    });
  }
}
