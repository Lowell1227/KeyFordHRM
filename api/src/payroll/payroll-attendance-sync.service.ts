import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayrollAttendanceSyncJob, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { DingtalkService } from '@/dingtalk/dingtalk.service';
import { DingtalkAttendanceBinding, DingtalkAttendancePending, DingtalkAttendanceService } from '@/dingtalk/dingtalk-attendance.service';
import { withDingtalkDeadline } from '@/dingtalk/dingtalk-request-deadline';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollDataService } from './payroll-data.service';
import { AttendanceSyncIssue, AttendanceSyncJob, AttendanceSyncStatus, PayrollAttendanceSyncStartDto, PayrollAttendanceSyncRetryDto } from './dto/payroll-attendance-sync.dto';
import { convertDingtalkAttendance, PayrollDingtalkAttendanceOptions, PayrollDingtalkAttendanceSourceState } from './payroll-dingtalk-attendance';
import { payrollScopeEmploymentDays, readFormalPayrollEmployments, readReviewedPayrollScopePolicies } from './payroll-employment-scope';
import { effectivePayrollParameters } from './payroll-parameter-timeline';
import { normalizePayrollWorkCalendar } from './payroll-work-calendar';
import { normalizePayrollPolicy } from './payroll-policy';
import { lockPayrollSubject, payrollDate, payrollHash, payrollMonth } from './payroll-transaction';

type Reader = Prisma.TransactionClient | PrismaService;
type Cell = { employeeId: string; workDate: string; required: boolean; units: string; policyId: string };
type Binding = DingtalkAttendanceBinding & { unionId: string };
type Context = { hash: string; cells: Cell[]; bindings: Binding[]; operator: Binding; corpId: string;
  mappings: Map<string, PayrollDingtalkAttendanceOptions['approvalMappings']>; workflowRead: boolean };
type Claim = { job: PayrollAttendanceSyncJob; actor: AuthUser; context: Context; cells: Cell[]; token: string;
  previous: PayrollDingtalkAttendanceSourceState[]; previousHash: string; snapshotHash: string };
const active = ['queued', 'processing'];
const retriable = ['failed', 'blocked', 'cancelled'];
const leaseMs = 120_000;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
function hash(value: unknown): string {
  const sorted = (value: any): any => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(sorted)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  return payrollHash(sorted(value));
}
const messages: Record<string, string> = {
  ACCESS_BLOCKED: '经办人状态、角色或本主体考勤权限已失效，请重新核对授权',
  CONTEXT_CHANGED: '已审核规则、日历、发薪范围或身份绑定已变化，请重试建立新任务',
  CALENDAR_REQUIRED: '缺少适用的已审核完整月工作日日历，请补齐规则后重试',
  MAPPINGS_REQUIRED: '请在工资规则中明确假勤类别映射并完成审核后重试',
  SCOPE_REQUIRED: '当月没有明确审核的实际发薪人员及有效任职范围，请先核对',
  IDENTITY_REQUIRED: '经办人或发薪员工的有效钉钉身份绑定缺失或冲突，请先核对',
  IDENTITY_UNVERIFIED: '钉钉身份未核验通过，请核对企业、用户绑定、应用权限及IP白名单',
  CONFIGURATION_REQUIRED: '正式钉钉同步配置或已审规则尚不完整，请先核对',
  PRIOR_SNAPSHOT_CHANGED: '当前考勤快照已被其他操作更新，请重新同步，未覆盖已有记录',
  SOURCE_VERSION_NOT_NEWER: '已有更新的考勤来源版本，请重试建立新任务，未覆盖更新记录',
  SOURCE_STATE_CHANGED: '考勤来源索引已变化，请重新同步，未覆盖更新记录',
  UPSTREAM_SCOPE_MISMATCH: '钉钉返回范围与本次任务不一致，已暂停同步，未覆盖已有记录',
  APPROVAL_TYPE_UNMAPPED: '有假勤类别未配置计薪映射，请补充规则并审核后重试',
  UPSTREAM_REJECTED: '钉钉拒绝取数，请核对应用权限及IP白名单后重试',
  WORKFLOW_PERMISSION_UNCONFIRMED: '假勤审批读取权限尚未确认，请核对应用授权',
  APPROVAL_NOT_FINAL: '假勤审批尚未完成，请核对审批终态后重试',
  APPROVAL_REVOKED: '发现撤销的假勤审批，请核对更正后重试',
  DAY_CONVERSION_REQUIRED: '假勤日单位尚无明确换算依据，请先核对',
  DEADLINE_EXCEEDED: '钉钉取数超时，已保留完成部分，可重试继续',
  SYNC_FAILED: '本次同步未完成，已保留完成部分，可重试继续',
};
function issue(code: string, mappingKey?: unknown): AttendanceSyncIssue {
  const safeCode = /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'SYNC_FAILED';
  return { code: safeCode, message: messages[safeCode] ?? '钉钉考勤仍有待核项目，请核对来源及规则后重试',
    ...(typeof mappingKey === 'string' && /^\d{1,3}:[^:\r\n]{1,80}:[^:\r\n]{0,80}$/.test(mappingKey) ? { mappingKey } : {}) };
}
class Blocked extends Error {
  constructor(readonly code: string) { super(code); }
}
class Fenced extends Error {}

@Injectable()
export class PayrollAttendanceSyncService {
  private readonly logger = new Logger(PayrollAttendanceSyncService.name);
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollAccessService, private readonly data: PayrollDataService,
    private readonly gateway: DingtalkAttendanceService, private readonly dingtalk: DingtalkService, private readonly config: ConfigService) {}
  async start(input: PayrollAttendanceSyncStartDto, actor: AuthUser): Promise<AttendanceSyncJob> {
    this.keys(input, ['subjectId', 'month', 'requestId']); this.uuid(input.subjectId); this.uuid(input.requestId); payrollMonth(input.month);
    return this.transaction(async tx => {
      await this.lock(tx, input.subjectId, input.month);
      const current = await this.authorize(tx, actor.id, input.subjectId);
      return this.enqueue(tx, input.subjectId, input.month, input.requestId, current);
    });
  }
  async list(subjectId: string, month: string, actor: AuthUser): Promise<AttendanceSyncJob[]> {
    this.uuid(subjectId); payrollMonth(month);
    await this.authorize(this.prisma, actor.id, subjectId);
    const rows = await this.prisma.payrollAttendanceSyncJob.findMany({ where: { subjectId, month, domain: 'formal' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    return rows.map(row => this.view(row));
  }
  async cancel(id: string, actor: AuthUser): Promise<AttendanceSyncJob> {
    const header = await this.header(id);
    return this.transaction(async tx => {
      await this.lock(tx, header.subjectId, header.month); await this.authorize(tx, actor.id, header.subjectId);
      const row = await tx.payrollAttendanceSyncJob.findUniqueOrThrow({ where: { id } });
      if (row.status === 'cancelled') return this.view(row);
      if (!active.includes(row.status)) throw new ConflictException('当前任务已结束，不能取消');
      return this.view(await tx.payrollAttendanceSyncJob.update({ where: { id }, data: {
        status: 'cancelled', leaseToken: null, leaseUntil: null, finishedAt: new Date(),
      } }));
    });
  }
  async retry(id: string, input: PayrollAttendanceSyncRetryDto, actor: AuthUser): Promise<AttendanceSyncJob> {
    this.keys(input, ['requestId']); this.uuid(input.requestId); const header = await this.header(id);
    return this.transaction(async tx => {
      await this.lock(tx, header.subjectId, header.month);
      const current = await this.authorize(tx, actor.id, header.subjectId);
      const old = await tx.payrollAttendanceSyncJob.findUniqueOrThrow({ where: { id } });
      return this.enqueue(tx, header.subjectId, header.month, input.requestId, current, old);
    });
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async dispatch(): Promise<void> {
    if (this.running || this.config.get<string>('HRM_PREVIEW') === 'true'
      || this.config.get<string>('DINGTALK_ATTENDANCE_SYNC_ENABLED') !== 'true' || !this.access.enabled()) return;
    this.running = true;
    try {
      const deadline = Date.now() + 60_000;
      let chunks = 0;
      const rows = await this.prisma.payrollAttendanceSyncJob.findMany({ where: { domain: 'formal', OR: [
        { status: 'queued' }, { status: 'processing', leaseUntil: { lt: new Date() } },
      ] }, orderBy: { createdAt: 'asc' }, take: 10, select: { id: true } });
      for (const row of rows) {
        // Finish each leased transaction; the budget only prevents claiming another chunk.
        while (chunks < 8 && Date.now() < deadline) {
          const claim = await this.claim(row.id);
          if (!claim) break;
          chunks++;
          const heartbeat = setInterval(() => { void this.prisma.payrollAttendanceSyncJob.updateMany({ where: {
            id: claim.job.id, status: 'processing', leaseToken: claim.token, leaseUntil: { gt: new Date() },
          }, data: { leaseUntil: new Date(Date.now() + leaseMs) } }).catch(() => undefined); }, 30_000);
          heartbeat.unref();
          try { await this.execute(claim); }
          catch (error) { if (!(error instanceof Fenced)) await this.fail(claim, error); break; }
          finally { clearInterval(heartbeat); }
        }
        if (chunks === 8 || Date.now() >= deadline) break;
      }
    } catch {
      // Provider/database errors may contain private identities or tokens; never log the exception.
      this.logger.warn('考勤同步调度中断，已保存任务将按租约恢复');
    } finally { this.running = false; }
  }

  private async enqueue(tx: Prisma.TransactionClient, subjectId: string, month: string, requestId: string, actor: AuthUser, old?: PayrollAttendanceSyncJob) {
    const requestHash = hash({ operation: old ? 'retry' : 'start', subjectId, month, actorId: actor.id, retryOfId: old?.id ?? null });
    const replay = await tx.payrollAttendanceSyncJob.findUnique({ where: { requestId } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw new ConflictException('该请求标识已用于其他同步内容或经办人');
      return this.view(replay);
    }
    if (old && !retriable.includes(old.status)) throw new ConflictException('仅已阻断、失败或取消的任务可以重试');
    if (await tx.payrollAttendanceSyncJob.findFirst({ where: { subjectId, month, domain: 'formal', status: { in: active } } })) throw new ConflictException('该主体当月已有同步任务，请查看进度或先取消');
    let context: Context | undefined, problems: AttendanceSyncIssue[] = [];
    try { context = await this.context(tx, subjectId, month, actor); }
    catch (error) { problems = [this.errorIssue(error)]; }
    const snapshot = await this.snapshot(tx, subjectId, month);
    const cursor = old && context && old.contextHash === context.hash && old.snapshotVersion === (snapshot?.version ?? 0)
      && hash(old.cells) === hash(context.cells) ? old.cursor : 0;
    const row = await tx.payrollAttendanceSyncJob.create({ data: { subjectId, month, domain: 'formal', requestId, requestHash,
      createdById: actor.id, retryOfId: old?.id ?? null, status: context ? 'queued' : 'blocked',
      contextHash: context?.hash ?? null, cells: json(context?.cells ?? []), totalCells: context?.cells.length ?? 0,
      cursor, snapshotVersion: snapshot?.version ?? 0, issues: json(problems), finishedAt: context ? null : new Date() } });
    return this.view(row);
  }
  private async claim(id: string): Promise<Claim | null> {
    return this.transaction(async tx => {
      const header = await tx.payrollAttendanceSyncJob.findUnique({ where: { id } });
      if (!header) return null;
      await this.lock(tx, header.subjectId, header.month);
      const job = await tx.payrollAttendanceSyncJob.findUniqueOrThrow({ where: { id } });
      if (!active.includes(job.status) || job.status === 'processing' && job.leaseUntil && +job.leaseUntil > Date.now()) return null;
      try {
        const actor = await this.authorize(tx, job.createdById, job.subjectId);
        const context = await this.context(tx, job.subjectId, job.month, actor);
        if (context.hash !== job.contextHash || hash(context.cells) !== hash(job.cells)) throw new Blocked('CONTEXT_CHANGED');
        const snapshot = await this.snapshot(tx, job.subjectId, job.month);
        if ((snapshot?.version ?? 0) !== job.snapshotVersion) throw new Blocked('PRIOR_SNAPSHOT_CHANGED');
        const first = context.cells[job.cursor];
        if (!first) throw new Blocked('CONTEXT_CHANGED');
        const cells = [first];
        for (const next of context.cells.slice(job.cursor + 1, job.cursor + 4)) {
          const last = cells[cells.length - 1];
          if (next.employeeId !== first.employeeId || next.policyId !== first.policyId || +payrollDate(next.workDate) - +payrollDate(last.workDate) !== 86400000) break;
          cells.push(next);
        }
        const previous = await this.sources(tx, job, cells);
        if (previous.some(row => row.sourceVersion > job.observationVersion)) throw new Blocked('SOURCE_VERSION_NOT_NEWER');
        const token = randomUUID();
        await tx.payrollAttendanceSyncJob.update({ where: { id }, data: { status: 'processing', leaseToken: token,
          leaseUntil: new Date(Date.now() + leaseMs), attempts: { increment: 1 }, issues: [], pendingCells: 0, finishedAt: null } });
        return { job, actor, context, cells, token, previous, previousHash: hash(previous), snapshotHash: this.snapshotHash(snapshot) };
      } catch (error) {
        await tx.payrollAttendanceSyncJob.update({ where: { id }, data: { status: 'blocked', issues: json([this.errorIssue(error)]),
          leaseToken: null, leaseUntil: null, finishedAt: new Date() } });
        return null;
      }
    });
  }
  private async execute(claim: Claim) {
    await this.verifyIdentities(claim);
    const first = claim.cells[0], last = claim.cells[claim.cells.length - 1];
    const binding = claim.context.bindings.find(row => row.employeeId === first.employeeId)!;
    const publicBinding = ({ employeeId, dingtalkUserId, corpId }: Binding): DingtalkAttendanceBinding => ({ employeeId, dingtalkUserId, corpId });
    const read = await this.gateway.readRange({ month: claim.job.month, from: first.workDate, to: last.workDate,
      organization: { corpId: claim.context.corpId, verified: true }, operator: publicBinding(claim.context.operator),
      bindings: [publicBinding(binding)], workflowInstanceRead: claim.context.workflowRead });
    if (read.month !== claim.job.month || read.scope.from !== first.workDate || read.scope.to !== last.workDate
      || read.scope.employeeIds.length !== 1 || read.scope.employeeIds[0] !== first.employeeId) throw new Blocked('UPSTREAM_SCOPE_MISMATCH');
    const converted = convertDingtalkAttendance(read, { expected: claim.cells.map(({ policyId, ...cell }) => cell),
      observationVersion: claim.job.observationVersion, previous: claim.previous, approvalMappings: claim.context.mappings.get(first.policyId)! });
    const issues = [...new Map(converted.pending.map(entry => {
      const value = issue(entry.code, (entry as DingtalkAttendancePending & { mappingKey?: string }).mappingKey);
      return [hash(value), value] as const;
    })).values()].slice(0, 20);
    await this.data.syncVerified({ subjectId: claim.job.subjectId, month: claim.job.month,
      sourceKey: `dt-job:${hash({ jobId: claim.job.id, cursor: claim.job.cursor, observationVersion: claim.job.observationVersion, source: converted.sourceKey })}`,
      input: converted.input, scope: converted.scope, complete: converted.complete }, claim.actor, async tx => {
      // Lock the fencing row as well as the subject/month. Serializable callbacks reject stale row versions.
      await tx.$queryRaw`SELECT id FROM payroll_attendance_sync_jobs WHERE id = ${claim.job.id}::uuid FOR UPDATE`;
      await this.lock(tx, claim.job.subjectId, claim.job.month);
      const current = await tx.payrollAttendanceSyncJob.findUniqueOrThrow({ where: { id: claim.job.id } });
      if (current.status !== 'processing' || current.leaseToken !== claim.token || !current.leaseUntil || +current.leaseUntil <= Date.now()
        || current.cursor !== claim.job.cursor) throw new Fenced();
      const actor = await this.authorize(tx, current.createdById, current.subjectId);
      const context = await this.context(tx, current.subjectId, current.month, actor);
      if (context.hash !== current.contextHash || context.hash !== claim.context.hash) throw new Blocked('CONTEXT_CHANGED');
      const snapshot = await this.snapshot(tx, current.subjectId, current.month);
      if (this.snapshotHash(snapshot) !== claim.snapshotHash || (snapshot?.version ?? 0) !== current.snapshotVersion) throw new Blocked('PRIOR_SNAPSHOT_CHANGED');
      const previous = await this.sources(tx, current, claim.cells);
      if (hash(previous) !== claim.previousHash) throw new Blocked('SOURCE_STATE_CHANGED');
      for (const source of converted.sourceState) {
        const prior = previous.find(row => row.sourceId === source.sourceId);
        if (source.sourceVersion > current.observationVersion || prior && (source.sourceVersion < prior.sourceVersion ||
          source.sourceVersion === prior.sourceVersion && source.fingerprint !== prior.fingerprint)) throw new Blocked('SOURCE_VERSION_NOT_NEWER');
        const key = { subjectId: current.subjectId, month: current.month, domain: 'formal', sourceId: source.sourceId };
        const data = { employeeId: source.record.employeeId, workDate: payrollDate(source.record.workDate),
          sourceVersion: source.sourceVersion, fingerprint: source.fingerprint, record: json(source.record) };
        await tx.payrollAttendanceSyncSource.upsert({ where: { subjectId_month_domain_sourceId: key }, create: { ...key, ...data }, update: data });
      }
      const cursor = converted.complete ? current.cursor + claim.cells.length : current.cursor;
      const complete = converted.complete && cursor === current.totalCells;
      await tx.payrollAttendanceSyncJob.update({ where: { id: current.id }, data: {
        status: !converted.complete ? 'blocked' : complete ? 'completed' : 'queued', cursor, pendingCells: converted.complete ? 0 : claim.cells.length,
        snapshotVersion: (snapshot?.version ?? 0) + 1, issues: json(issues), leaseToken: null, leaseUntil: null,
        finishedAt: !converted.complete || complete ? new Date() : null,
      } });
      return json({ schema: 1, provider: 'dingtalk', jobId: current.id, observationVersion: current.observationVersion,
        contextHash: context.hash, completedCells: cursor, totalCells: current.totalCells, complete,
        sourceStateHash: hash(converted.sourceState), sourceState: converted.sourceState, issues });
    });
  }

  private async context(tx: Reader, subjectId: string, month: string, actor: AuthUser): Promise<Context> {
    const corpId = this.config.get<string>('DINGTALK_CORP_ID');
    const appKey = this.config.get<string>('DINGTALK_APP_KEY');
    if (!corpId?.trim() || !appKey?.trim()) throw new Blocked('CONFIGURATION_REQUIRED');
    const { policies, releases } = await readReviewedPayrollScopePolicies(tx, subjectId);
    const records = await readFormalPayrollEmployments(tx, subjectId, month);
    const days = payrollScopeEmploymentDays(records, month).filter(row => {
      const record = records.find(record => record.id === row.employment.id);
      return record?.payrollAssignment.workDates.includes(row.workDate);
    });
    if (!days.length) throw new Blocked('SCOPE_REQUIRED');
    const employeeIds = [...new Set([actor.id, ...days.map(row => row.employeeId)])].sort();
    const users = await tx.user.findMany({ where: { id: { in: employeeIds } }, select: { id: true, status: true, deletedAt: true,
      archivedAt: true, dingtalkId: true, dingtalkUnionId: true } });
    const external = await tx.externalIdentityBinding.findMany({ where: { userId: { in: employeeIds }, provider: 'dingtalk' },
      select: { userId: true, externalUserId: true, externalUnionId: true, status: true, endedAt: true } });
    const bindings: Binding[] = employeeIds.map(id => {
      const user = users.find(row => row.id === id), all = external.filter(row => row.userId === id);
      const enabled = all.filter(row => row.status === 'enabled' && row.endedAt === null);
      if (!user || user.deletedAt || user.archivedAt || all.length && enabled.length !== 1) throw new Blocked('IDENTITY_REQUIRED');
      const binding = enabled[0];
      const userId = binding?.externalUserId ?? user.dingtalkId;
      const unionId = binding?.externalUnionId ?? user.dingtalkUnionId;
      if (!userId?.trim() || !unionId?.trim() || binding && (user.dingtalkId && user.dingtalkId !== userId ||
        user.dingtalkUnionId && user.dingtalkUnionId !== unionId || !binding.externalUserId && user.dingtalkUnionId !== unionId)) throw new Blocked('IDENTITY_REQUIRED');
      return { employeeId: id, dingtalkUserId: userId, unionId, corpId };
    });
    if (new Set(bindings.map(row => row.dingtalkUserId)).size !== bindings.length || new Set(bindings.map(row => row.unionId)).size !== bindings.length) throw new Blocked('IDENTITY_REQUIRED');
    const mappings = new Map<string, PayrollDingtalkAttendanceOptions['approvalMappings']>(), calendars = new Map<string, ReturnType<typeof normalizePayrollWorkCalendar>>();
    const links = releases.filter(row => row.ruleId).map(row => ({ parameterId: row.ruleId!, previousParameterId: row.previousParameterId }));
    const cells: Cell[] = [];
    for (const row of days) {
      const selected = effectivePayrollParameters(policies, links, payrollDate(row.workDate));
      if (selected.length !== 1) throw new Blocked('SCOPE_REQUIRED');
      const policy = selected[0];
      if (!calendars.has(policy.id)) {
        const raw = policy.config as unknown as { attendanceMappings?: unknown; workCalendars?: Record<string, unknown> };
        if (raw.attendanceMappings === undefined) throw new Blocked('MAPPINGS_REQUIRED');
        try { calendars.set(policy.id, normalizePayrollWorkCalendar(month, raw.workCalendars?.[month])); }
        catch { throw new Blocked('CALENDAR_REQUIRED'); }
        try { mappings.set(policy.id, normalizePayrollPolicy(policy.config).attendanceMappings!); }
        catch { throw new Blocked('MAPPINGS_REQUIRED'); }
      }
      const calendar = calendars.get(policy.id)!.days.find(day => day.workDate === row.workDate)!;
      cells.push({ employeeId: row.employeeId, workDate: row.workDate, required: new Prisma.Decimal(calendar.units).gt(0), units: calendar.units, policyId: policy.id });
    }
    cells.sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.workDate.localeCompare(b.workDate));
    const workflowRead = this.config.get<string>('DINGTALK_ATTENDANCE_WORKFLOW_READ_CONFIRMED') === 'true';
    const contextHash = hash({ corpId, appKey, workflowRead, operator: { id: actor.id, sysRole: actor.sysRole, deptId: actor.deptId,
      isAssessorOnly: actor.isAssessorOnly, canViewAll: actor.canViewAll, hrCapabilities: [...(actor.hrCapabilities ?? [])].sort() },
      cells, bindings, records: records.map(({ user, ...record }) => record).sort((a, b) => a.id.localeCompare(b.id)),
      policies: policies.filter(row => calendars.has(row.id)).map(row => ({ id: row.id, version: row.version,
        effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, calendar: calendars.get(row.id), mappings: mappings.get(row.id),
        releases: releases.filter(link => link.ruleId === row.id) })).sort((a, b) => a.id.localeCompare(b.id)) });
    return { hash: contextHash, cells, bindings: bindings.filter(row => row.employeeId !== actor.id || days.some(day => day.employeeId === actor.id)),
      operator: bindings.find(row => row.employeeId === actor.id)!, mappings, corpId, workflowRead };
  }
  private async verifyIdentities(claim: Claim) {
    try {
      await withDingtalkDeadline(async signal => {
        const token = await this.dingtalk.getAccessToken(signal);
        const target = claim.context.bindings.find(row => row.employeeId === claim.cells[0].employeeId)!;
        for (const binding of [...new Map([claim.context.operator, target].map(row => [row.employeeId, row])).values()]) {
          const user = await this.dingtalk.fetchUserDetail(binding.dingtalkUserId, token, signal) as Awaited<ReturnType<DingtalkService['fetchUserDetail']>> & { corpId?: string; corp_id?: string };
          // The configured enterprise token must resolve the exact saved user/union pair; the gateway also checks returned corp fields.
          if (user.userid !== binding.dingtalkUserId || user.unionid !== binding.unionId || user.active === false ||
            user.corpId && user.corpId !== binding.corpId || user.corp_id && user.corp_id !== binding.corpId) throw new Blocked('IDENTITY_UNVERIFIED');
        }
      });
    } catch { throw new Blocked('IDENTITY_UNVERIFIED'); }
  }
  private async authorize(tx: Reader, id: string, subjectId: string): Promise<AuthUser> {
    if (this.config.get<string>('HRM_PREVIEW') === 'true' || this.config.get<string>('DINGTALK_ATTENDANCE_SYNC_ENABLED') !== 'true') throw new ForbiddenException('真实钉钉考勤同步尚未开放，预览仅使用虚构数据');
    const user = await tx.user.findUnique({ where: { id }, select: { id: true, name: true, sysRole: true, deptId: true,
      isAssessorOnly: true, canViewAll: true, hrCapabilities: true, status: true, deletedAt: true, archivedAt: true } });
    if (!user || !['active', 'probation'].includes(user.status) || user.deletedAt || user.archivedAt || user.isAssessorOnly) throw new ForbiddenException('当前经办人不可办理同步');
    await this.access.assert(tx, user, subjectId, 'attendance_edit'); await this.access.assertDomain(tx, 'formal');
    return user;
  }
  private sources(tx: Reader, job: PayrollAttendanceSyncJob, cells: Cell[]): Promise<PayrollDingtalkAttendanceSourceState[]> {
    return tx.payrollAttendanceSyncSource.findMany({ where: { subjectId: job.subjectId, month: job.month, domain: 'formal',
      employeeId: { in: [...new Set(cells.map(row => row.employeeId))] }, workDate: { gte: payrollDate(cells[0].workDate), lte: payrollDate(cells[cells.length - 1].workDate) } },
      orderBy: { sourceId: 'asc' } }).then(rows => rows.map(row => ({ sourceId: row.sourceId, sourceVersion: row.sourceVersion,
        fingerprint: row.fingerprint, record: row.record as unknown as PayrollDingtalkAttendanceSourceState['record'] })));
  }
  private async fail(claim: Claim, error: unknown) {
    await this.prisma.payrollAttendanceSyncJob.updateMany({ where: { id: claim.job.id, status: 'processing', leaseToken: claim.token,
      leaseUntil: { gt: new Date() } }, data: { status: error instanceof Blocked || error instanceof ForbiddenException || error instanceof ConflictException ? 'blocked' : 'failed',
      issues: json([this.errorIssue(error)]), leaseToken: null, leaseUntil: null, finishedAt: new Date() } });
  }
  private errorIssue(error: unknown) {
    return issue(error instanceof Blocked ? error.code : error instanceof ForbiddenException ? 'ACCESS_BLOCKED'
      : error instanceof ConflictException || error instanceof BadRequestException ? 'CONFIGURATION_REQUIRED' : 'SYNC_FAILED');
  }
  private snapshot(tx: Reader, subjectId: string, month: string) {
    return tx.payrollAttendanceSnapshot.findFirst({ where: { subjectId, month, domain: 'formal' }, orderBy: { version: 'desc' },
      select: { id: true, version: true, sourceHash: true, payload: true, status: true, review: true, sealedHash: true } });
  }
  private snapshotHash(snapshot: Awaited<ReturnType<PayrollAttendanceSyncService['snapshot']>>) {
    return hash(snapshot ? { id: snapshot.id, version: snapshot.version, sourceHash: snapshot.sourceHash,
      status: snapshot.status, review: snapshot.review, sealedHash: snapshot.sealedHash,
      proof: (snapshot.payload as any)?.dingtalk ?? null } : null);
  }
  private async header(id: string) {
    this.uuid(id); const row = await this.prisma.payrollAttendanceSyncJob.findUnique({ where: { id }, select: { id: true, subjectId: true, month: true } });
    if (!row) throw new NotFoundException('考勤同步任务不存在'); return row;
  }
  private async lock(tx: Prisma.TransactionClient, subjectId: string, month: string) {
    await lockPayrollSubject(tx, subjectId, 'formal');
    await lockPayrollSubject(tx, `${subjectId}:${month}`, 'attendance-sync:formal');
  }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60000 }); }
    catch (error) {
      if ((error as { code?: string })?.code === 'P2002' || (error as { code?: string })?.code === 'P2034') throw new ConflictException('同步任务并发变化，请重新读取后重试');
      throw error;
    }
  }
  private keys(value: unknown, keys: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new BadRequestException('同步请求包含不支持的客户端字段');
  }
  private uuid(value: string) { if (typeof value !== 'string' || !isUUID(value)) throw new BadRequestException('同步任务或请求标识不正确'); }
  private view(row: PayrollAttendanceSyncJob): AttendanceSyncJob {
    return { id: row.id, subjectId: row.subjectId, month: row.month, domain: 'formal', status: row.status as AttendanceSyncStatus,
      observationVersion: row.observationVersion, totalCells: row.totalCells, completedCells: row.cursor,
      pendingCells: row.pendingCells, attempts: row.attempts, issues: Array.isArray(row.issues) ? row.issues.map(value => {
        const entry = value as unknown as AttendanceSyncIssue; return issue(entry.code, entry.mappingKey);
      }) : [issue('SYNC_FAILED')], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null, canCancel: active.includes(row.status), canRetry: retriable.includes(row.status) };
  }
}
