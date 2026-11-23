import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PayrollAttendanceSyncService } from './payroll-attendance-sync.service';
import { PayrollAccessService } from './payroll-access.service';
import { PayrollDataService } from './payroll-data.service';
import { payrollHash } from './payroll-transaction';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { payrollCalendarDays } from './payroll-work-calendar';
import { convertDingtalkAttendance, PayrollDingtalkAttendanceSourceState } from './payroll-dingtalk-attendance';
import { PayrollAbsenceService } from './payroll-absence.service';

const subjectId = '20000000-0000-4000-8000-000000000001', employeeId = '20000000-0000-4000-8000-000000000002';
const operatorId = '20000000-0000-4000-8000-000000000003', otherSubject = '20000000-0000-4000-8000-000000000004';
const month = '2035-11', actor = { id: operatorId } as any;
const date = (text: string) => new Date(`${text}T00:00:00.000Z`);
function match(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((entry: any) => match(row, entry));
    if (key === 'OR') return value.some((entry: any) => match(row, entry));
    if (key.includes('_') && value && typeof value === 'object') return match(row, value);
    const current = row?.[key];
    if (value == null || typeof value !== 'object' || value instanceof Date) return current instanceof Date ? +current === +value : current === value;
    if ('in' in value) return value.in.includes(current);
    if ('not' in value) return current !== value.not;
    for (const [op, compare] of Object.entries(value) as any) {
      if (op === 'gt' && !(current > compare) || op === 'gte' && !(current >= compare)
        || op === 'lt' && !(current < compare) || op === 'lte' && !(current <= compare)) return false;
    }
    if (['gt', 'gte', 'lt', 'lte'].some(op => op in value)) return true;
    return current != null && match(current, value);
  });
}
function select(row: any, fields?: any): any {
  if (!row) return null;
  if (!fields) return structuredClone(row);
  return Object.fromEntries(Object.entries(fields).filter(([, yes]) => yes).map(([key, value]: [string, any]) =>
    [key, value === true ? structuredClone(row[key]) : select(row[key], value.select)]));
}
function fixture() {
  const user = (id: string, key: string) => ({ id, name: 'Fictional', sysRole: 'employee', deptId: null,
    isAssessorOnly: false, canViewAll: false, hrCapabilities: [], status: 'active', deletedAt: null, archivedAt: null,
    employeeNo: `FAKE-${id}`, dingtalkId: `private-${key}`, dingtalkUnionId: `private-union-${key}` });
  const policy: any = { id: randomUUID(), subjectId, domain: 'formal', status: 'active', version: 1,
    effectiveFrom: date('2035-11-01'), effectiveTo: date('2035-11-30'), config: {
      employeeScope: { employeeIds: [employeeId], evidenceRef: 'fictional-payer-assignment' },
      workCalendars: { [month]: { sourceVersion: 'fictional-calendar-v1', evidenceRef: 'fictional-calendar',
        days: payrollCalendarDays(month).map(workDate => ({ workDate, units: workDate <= '2035-11-06' ? '1' : '0' })) } },
      attendanceMappings: {}, rounding: 'item_half_up', monthlyUnits: {}, normalHourly: null, paidHourly: {},
      overtime: { hourlyBase: null, weekday: null, restday: null, holiday: null }, reviewers: [], approvers: [], cutoverMonth: month, performance: {},
    } };
  const state: any = { jobs: [], sources: [], snapshots: [], events: [], users: [user(operatorId, 'operator'), user(employeeId, 'target')], bindings: [],
    policies: [policy], releases: [{ ruleId: policy.id, subjectId, domain: 'formal', kind: 'rule', status: 'approved', parameterVersion: 1,
      previousParameterId: null, snapshotHash: payrollHash(payrollParameterDefinition('rule', policy)) }],
    grants: [{ userId: operatorId, subjectId, revokedAt: null, capabilities: ['attendance_edit'] }],
    // Deliberately different contract subject: the approved payer scope, not the contract, authorizes this job.
    employments: [{ id: randomUUID(), userId: employeeId, contractSubjectId: otherSubject, effectiveFrom: date('2035-11-01'), effectiveTo: date('2035-11-06'),
      entryDate: date('2035-11-01'), leaveDate: null, employeeStatus: 'active', employeeNo: 'FAKE-001', createdAt: date('2035-11-01'), sourceRequestId: null }],
    failSnapshot: false };
  const cfg: Record<string, string> = { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false',
    DINGTALK_ATTENDANCE_SYNC_ENABLED: 'true', DINGTALK_ATTENDANCE_WORKFLOW_READ_CONFIRMED: 'true', DINGTALK_CORP_ID: 'fictional-corp', DINGTALK_APP_KEY: 'fictional-app' };
  const config = { get: (key: string) => cfg[key] } as ConfigService;
  let observation = 0;
  const rows = (name: string) => state[name].map((row: any) => name === 'grants' ? { ...row, user: state.users.find((user: any) => user.id === row.userId) }
    : name === 'employments' ? { ...row, user: state.users.find((user: any) => user.id === row.userId) } : row);
  const model = (name: string) => {
    const find = ({ where, select: fields, orderBy, take }: any = {}) => {
      let result = rows(name).filter((row: any) => match(row, where));
      if (orderBy) for (const order of [...(Array.isArray(orderBy) ? orderBy : [orderBy])].reverse()) {
        const [key, direction]: any = Object.entries(order)[0];
        result.sort((a: any, b: any) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'desc' ? -1 : 1));
      }
      return (take ? result.slice(0, take) : result).map((row: any) => select(row, fields));
    };
    const create = async ({ data }: any) => {
      if (name === 'snapshots' && state.failSnapshot) throw new Error('fictional database failure');
      if (name === 'jobs' && state.jobs.some((row: any) => row.requestId === data.requestId ||
        ['queued', 'processing'].includes(data.status ?? 'queued') && ['queued', 'processing'].includes(row.status) && row.subjectId === data.subjectId && row.month === data.month && row.domain === data.domain)) throw { code: 'P2002' };
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(),
        ...(name === 'snapshots' ? { status: 'draft', review: [] } : {}),
        ...(name === 'jobs' ? { observationVersion: ++observation, status: 'queued', cursor: 0, pendingCells: 0, attempts: 0, leaseToken: null, leaseUntil: null, finishedAt: null } : {}), ...structuredClone(data) };
      state[name].push(row); return structuredClone(row);
    };
    const apply = (row: any, data: any) => { for (const [key, value] of Object.entries(data) as any) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : structuredClone(value); row.updatedAt = new Date(); };
    return { findMany: jest.fn(async (query?: any) => find(query)), findFirst: jest.fn(async (query?: any) => find(query)[0] ?? null),
      findUnique: jest.fn(async (query?: any) => find(query)[0] ?? null), create: jest.fn(create),
      findUniqueOrThrow: jest.fn(async (query?: any) => { const row = find(query)[0]; if (!row) throw new Error('missing fixture row'); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = state[name].find((row: any) => match(row, where)); if (!row) throw new Error('missing fixture row'); apply(row, data); return structuredClone(row); }),
      updateMany: jest.fn(async ({ where, data }: any) => { const selected = state[name].filter((row: any) => match(row, where)); selected.forEach((row: any) => apply(row, data)); return { count: selected.length }; }),
      upsert: jest.fn(async ({ where, create: data, update }: any) => { const row = state[name].find((row: any) => match(row, where)); if (!row) return create({ data }); apply(row, update); return structuredClone(row); }) };
  };
  const tx: any = { $queryRaw: jest.fn(async () => []), user: model('users'), payrollGrant: model('grants'), employmentRecord: model('employments'),
    externalIdentityBinding: model('bindings'), payrollPolicy: model('policies'), payrollParameterRelease: model('releases'),
    payrollAttendanceSyncJob: model('jobs'), payrollAttendanceSyncSource: model('sources'), payrollAttendanceSnapshot: model('snapshots'), payrollEvent: model('events') };
  let queue = Promise.resolve();
  const prisma: any = { ...tx, $transaction: jest.fn(async (work: any) => {
    let release!: () => void; const previous = queue; queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    const before = structuredClone(state);
    try { return await work(tx); } catch (error) { Object.assign(state, before); throw error; } finally { release(); }
  }) };
  const access = new PayrollAccessService(prisma, config), data = new PayrollDataService(prisma, access);
  const gateway = { readRange: jest.fn(async (query: any) => ({ month: query.month, organizationKey: 'fictional-organization', scope: {
    employeeIds: query.bindings.map((b: any) => b.employeeId), from: query.from, to: query.to }, complete: true, pending: [],
    days: payrollCalendarDays(query.month).filter(workDate => workDate >= query.from && workDate <= query.to).map(workDate => ({
      employeeId: query.bindings[0].employeeId, workDate, complete: true, restsKnown: true, approvals: [],
      rests: [{ startsAt: `${workDate}T12:00:00+08:00`, endsAt: `${workDate}T13:00:00+08:00` }],
      schedule: [{ id: '1', classId: 'class', workDate, checkType: 'OnDuty', plannedAt: `${workDate}T09:00:00+08:00`, isRest: false, approvalLinked: false },
        { id: '2', classId: 'class', workDate, checkType: 'OffDuty', plannedAt: `${workDate}T17:00:00+08:00`, isRest: false, approvalLinked: false }],
      punches: [{ id: '1', planId: '1', workDate, checkType: 'OnDuty', plannedAt: `${workDate}T09:00:00+08:00`, checkedAt: `${workDate}T09:00:00+08:00`, result: 'Normal', location: 'Normal', approvalLinked: false },
        { id: '2', planId: '2', workDate, checkType: 'OffDuty', plannedAt: `${workDate}T17:00:00+08:00`, checkedAt: `${workDate}T17:00:00+08:00`, result: 'Normal', location: 'Normal', approvalLinked: false }],
    })) })) };
  const dingtalk = { getAccessToken: jest.fn(async () => 'fictional-secret-token'), fetchUserDetail: jest.fn(async (id: string) => {
    const user = state.users.find((row: any) => row.dingtalkId === id); return { userid: id, unionid: user?.dingtalkUnionId, name: 'Fictional', corpId: 'fictional-corp' };
  }) };
  const worker = () => new PayrollAttendanceSyncService(prisma, access, data, gateway as any, dingtalk as any, config);
  const refreshRule = () => { state.releases[0].snapshotHash = payrollHash(payrollParameterDefinition('rule', state.policies[0])); };
  return { state, cfg, prisma, tx, access, data, gateway, dingtalk, worker, service: worker(), refreshRule,
    start: (service = worker()) => service.start({ subjectId, month, requestId: randomUUID() }, actor) };
}

async function dispatchOneChunk(f: ReturnType<typeof fixture>) {
  const original = f.gateway.readRange.getMockImplementation()!;
  let now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  f.gateway.readRange.mockImplementationOnce(async query => { const result = await original(query); now += 60_000; return result; });
  try { await f.service.dispatch(); } finally { clock.mockRestore(); }
}

function approvalFixture() {
  const f = fixture(), original = f.gateway.readRange.getMockImplementation()!;
  let mode: 'normal' | 'approved' | 'cancelled' = 'normal';
  f.state.policies[0].config.attendanceMappings = { '3:leave:annual': { type: 'paid_leave' } }; f.refreshRule();
  f.gateway.readRange.mockImplementation(async query => {
    const read = await original(query), day = read.days.find(row => row.workDate === '2035-11-01');
    if (day && mode !== 'normal') (day as any).approvals = [{ processInstanceId: 'fictional-process', businessType: 3,
      tagName: 'leave', subType: 'annual', startsAt: '2035-11-01T09:00:00+08:00', endsAt: '2035-11-01T17:00:00+08:00',
      duration: '7', unit: 'hour', state: mode, ...(mode === 'cancelled' ? { terminalProof: { status: 'TERMINATED', fingerprint: 'a'.repeat(64) } } : {}) }];
    return read;
  });
  const readSources = (worker = f.worker()): Promise<PayrollDingtalkAttendanceSourceState[]> => (worker as any).sources(f.prisma,
    { subjectId, month }, [{ employeeId, workDate: '2035-11-01' }]);
  const run = async (next: typeof mode) => {
    mode = next; const worker = f.worker(), job = await f.start(worker); await worker.dispatch();
    return (await worker.list(subjectId, month, actor)).find(row => row.id === job.id)!;
  };
  return { ...f, readSources, run, original };
}

describe('formal attendance durable jobs (fictional persistence and gateway only)', () => {
  beforeAll(() => jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Live requests forbidden in this suite')));
  afterAll(() => jest.restoreAllMocks());
  it('persists confirmed absence through restart, resync and sealing, but blocks changed plan evidence', async () => {
    const f = fixture(), original = f.gateway.readRange.getMockImplementation()!;
    let changed = false;
    f.gateway.readRange.mockImplementation(async query => {
      const read = await original(query), day = read.days.find(row => row.workDate === '2035-11-01');
      if (day) { day.punches = []; if (changed) day.schedule[0].plannedAt = `${day.workDate}T08:00:00+08:00`; }
      return read;
    });
    const sealerId = randomUUID(); f.state.users.push({ ...f.state.users[0], id: sealerId });
    f.state.grants.push({ userId: sealerId, subjectId, revokedAt: null, capabilities: ['attendance_seal'] });
    const job = await f.start(); await f.service.dispatch();
    expect(f.state.jobs.find((row: any) => row.id === job.id).status).toBe('blocked');
    const prior = f.state.snapshots.at(-1), proposalId = randomUUID(), absence = new PayrollAbsenceService(f.prisma, f.access);
    expect(prior.payload.dingtalk.absenceCandidates[0].hours).toBe('7');
    await absence.propose(prior.id, { expectedVersion: prior.version, employeeId, workDate: '2035-11-01', reference: 'Fictional signed attendance decision', requestId: proposalId }, actor);
    await absence.decide(prior.id, proposalId, { expectedVersion: prior.version, decision: 'approve', note: 'Fictional sealer verification' }, { id: sealerId } as any);
    const retried = await f.service.retry(job.id, { requestId: randomUUID() }, actor); await f.service.dispatch();
    const retriedState = f.state.jobs.find((row: any) => row.id === retried.id);
    expect({ status: retriedState.status, issues: retriedState.issues }).toEqual({ status: 'completed', issues: [] });
    const complete = f.state.snapshots.at(-1);
    expect(complete.payload.issues).toEqual([]); expect(complete.payload.confirmedAbsences[0].id).toBe(proposalId);
    expect(complete.payload.days.find((row: any) => row.workDate === '2035-11-01').records.some((row: any) => row.type === 'absence' && row.effectiveHours === '3')).toBe(true);
    expect(f.state.sources.some((row: any) => row.sourceId.startsWith('hr-absence:'))).toBe(false);
    await f.data.seal(complete.id, complete.version, { id: sealerId } as any);
    changed = true; const refreshed = await f.start(); await f.service.dispatch();
    expect(f.state.jobs.find((row: any) => row.id === refreshed.id).status).toBe('blocked');
    expect(f.state.snapshots.at(-1).payload.sync.complete).toBe(false);
  });
  it('persists a schema-1 record/proof envelope and reloads the complete proof through a restarted sources reader', async () => {
    const f = approvalFixture(); expect((await f.run('normal')).status).toBe('completed');
    const expected = f.state.snapshots[0].payload.dingtalk.sourceState.filter((row: any) => row.record.workDate === '2035-11-01');
    for (const row of f.state.sources) {
      expect(row.record).toMatchObject({ schema: 1, record: { sourceId: row.sourceId }, proof: { kind: 'derived-normal' } });
      row.record = JSON.parse(JSON.stringify(row.record));
    }
    expect(await f.readSources(f.worker())).toEqual(expected);
    expect(JSON.stringify(expected.map((row: any) => row.proof))).not.toMatch(/private-|fictional-secret-token|fictional-process/);
  });
  it('restarts normal to full leave to terminal cancellation with stable versions and inactive tombstones', async () => {
    const f = approvalFixture(); expect((await f.run('normal')).status).toBe('completed');
    const initial = await f.readSources();
    expect((await f.run('approved')).status).toBe('completed');
    const leave = await f.readSources();
    for (const prior of initial) expect(leave.find(row => row.sourceId === prior.sourceId)).toMatchObject({
      sourceVersion: 2, record: { state: 'superseded' }, proof: { kind: 'superseded-normal', previousFingerprint: prior.fingerprint },
    });
    expect((await f.run('approved')).status).toBe('completed'); expect(await f.readSources()).toEqual(leave);
    expect((await f.run('cancelled')).status).toBe('completed');
    const cancelled = await f.readSources();
    expect(cancelled.filter(row => row.record.state === 'cancelled')).toHaveLength(2);
    for (const source of cancelled.filter(row => row.record.state === 'cancelled')) expect(source).toMatchObject({
      sourceVersion: 4, proof: { kind: 'approval', terminalHash: 'a'.repeat(64) },
    });
    const day = f.state.snapshots.at(-1).payload.days.find((row: any) => row.workDate === '2035-11-01');
    expect(day.issues).toEqual([]);
    expect(day.records.filter((row: any) => row.state === 'cancelled').every((row: any) => row.resolution === 'inactive')).toBe(true);
    expect(day.records.filter((row: any) => row.type === 'normal' && row.resolution === 'usable').reduce((sum: number, row: any) => sum + Number(row.effectiveHours), 0)).toBe(7);
    expect((await f.run('cancelled')).status).toBe('completed'); expect(await f.readSources()).toEqual(cancelled);
  });
  it('keeps a genuinely disappeared external source blocked after source proof is reloaded', async () => {
    const f = approvalFixture(); expect((await f.run('approved')).status).toBe('completed');
    const before = await f.readSources();
    const result = await f.run('normal');
    expect(result.status).toBe('blocked'); expect(result.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_DISAPPEARED_UNPROVEN' }));
    const retained = await f.readSources();
    for (const source of before) expect(retained.find(row => row.sourceId === source.sourceId)).toEqual(source);
  });
  it('reads old raw records without inventing proof and keeps replacement pending through the real converter', async () => {
    const f = approvalFixture(); await f.run('normal');
    for (const row of f.state.sources) row.record = row.record.record ?? row.record;
    const previous = await f.readSources(f.worker());
    expect(previous).toHaveLength(2); expect(previous.every(row => row.proof === undefined)).toBe(true);
    const read = await f.original({ month, from: '2035-11-01', to: '2035-11-01', bindings: [{ employeeId }] });
    (read.days[0] as any).approvals = [{ processInstanceId: 'fictional-process', businessType: 3, tagName: 'leave', subType: 'annual',
      startsAt: '2035-11-01T09:00:00+08:00', endsAt: '2035-11-01T17:00:00+08:00', duration: '7', unit: 'hour', state: 'approved' }];
    const result = convertDingtalkAttendance(read, { expected: [{ employeeId, workDate: '2035-11-01', required: true, units: '1' }],
      observationVersion: 2, previous, approvalMappings: { '3:leave:annual': { type: 'paid_leave' } } });
    expect(result.complete).toBe(false); expect(result.pending.map(row => row.code)).toContain('SOURCE_DISAPPEARED_UNPROVEN');
  });
  it('fences a proof-only source change made while the restarted worker is reading upstream', async () => {
    const f = approvalFixture(); await f.run('normal');
    const worker = f.worker(), job = await f.start(worker), original = f.gateway.readRange.getMockImplementation()!;
    let reached!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { reached = resolve; }), release = new Promise<void>(resolve => { resume = resolve; });
    f.gateway.readRange.mockImplementationOnce(async query => { reached(); await release; return original(query); });
    const snapshots = f.state.snapshots.length, pending = worker.dispatch(); await started;
    const source = f.state.sources.find((row: any) => +row.workDate === +date('2035-11-01'));
    source.record.proof.evidenceHash = 'c'.repeat(64);
    resume(); await pending;
    const listed = (await worker.list(subjectId, month, actor)).find(row => row.id === job.id)!;
    expect(listed.status).toBe('blocked'); expect(listed.completedCells).toBe(0);
    expect(listed.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_STATE_CHANGED' }));
    expect(f.state.snapshots).toHaveLength(snapshots);
    expect(f.state.sources.find((row: any) => row.sourceId === source.sourceId).record.proof.evidenceHash).toBe('c'.repeat(64));
  });
  it.each(['schema', 'proof', 'scope'])('does not downgrade a malformed %s envelope to a legacy record', async kind => {
    const f = approvalFixture(); await f.run('normal');
    const row = f.state.sources.find((source: any) => +source.workDate === +date('2035-11-01')), record = row.record.record ?? row.record;
    row.record = { schema: kind === 'schema' ? 2 : 1, record: { ...record, ...(kind === 'scope' ? { employeeId: operatorId } : {}) },
      proof: kind === 'proof' ? { kind: 'derived-normal', identityHash: 'not-a-hash', evidenceHash: 'b'.repeat(64) } : null };
    await expect(f.readSources()).rejects.toMatchObject({ code: 'SOURCE_STATE_INVALID' });
  });
  it('enqueues a bounded durable job without making an upstream HTTP call, and replays its request ID', async () => {
    const f = fixture(), input = { subjectId, month, requestId: randomUUID() };
    const job = await f.service.start(input, actor);
    expect(job).toMatchObject({ domain: 'formal', status: 'queued', totalCells: 6, completedCells: 0, attempts: 0, issues: [], canCancel: true, canRetry: false });
    expect(await f.service.start(input, actor)).toEqual(job); expect(f.state.jobs).toHaveLength(1);
    expect(f.gateway.readRange).not.toHaveBeenCalled(); expect(f.dingtalk.fetchUserDetail).not.toHaveBeenCalled();
    expect(JSON.stringify(job)).not.toMatch(/private-|fictional-secret-token|leaseToken|contextHash|cells"/);
  });
  it.each(['complete', 'employeeIds', 'bindings', 'input', 'observationVersion', 'operator'])('rejects forged client field %s', async key => {
    const f = fixture(); await expect(f.service.start({ subjectId, month, requestId: randomUUID(), [key]: true } as any, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.state.jobs).toHaveLength(0);
  });
  it('never infers an operator binding from the target and rejects real sync in preview', async () => {
    const f = fixture(); f.cfg.HRM_PREVIEW = 'true';
    await expect(f.start()).rejects.toBeInstanceOf(ForbiddenException); expect(f.gateway.readRange).not.toHaveBeenCalled();
    f.cfg.HRM_PREVIEW = 'false'; f.state.users[0].dingtalkId = null;
    const job = await f.start(); expect(job.status).toBe('blocked'); expect(f.dingtalk.fetchUserDetail).not.toHaveBeenCalled();
  });
  it.each(['preview', 'disabled'])('does not consume another formal-context job while the application is %s', async mode => {
    const f = fixture(); await f.start(); const before = JSON.stringify(f.state.jobs);
    if (mode === 'preview') f.cfg.HRM_PREVIEW = 'true'; else f.cfg.DINGTALK_ATTENDANCE_SYNC_ENABLED = 'false';
    await f.service.dispatch();
    expect(JSON.stringify(f.state.jobs)).toBe(before);
    expect(f.gateway.readRange).not.toHaveBeenCalled(); expect(f.dingtalk.fetchUserDetail).not.toHaveBeenCalled();
  });
  it('enforces one active subject/month job under concurrent starts and never treats HR/admin as a grant', async () => {
    const f = fixture(); const result = await Promise.allSettled([f.start(), f.start()]);
    expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(f.state.jobs).toHaveLength(1);
    await expect(f.service.list(otherSubject, month, actor)).rejects.toBeInstanceOf(ForbiddenException);
    f.state.grants[0].revokedAt = new Date(); f.state.users[0].sysRole = 'system_admin';
    await expect(f.service.list(subjectId, month, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('publishes source state, evidence, cursor and snapshot atomically and resumes only remaining cells after restart', async () => {
    const f = fixture(); const job = await f.start(); await dispatchOneChunk(f);
    expect(f.state.jobs[0]).toMatchObject({ status: 'queued', cursor: 4, snapshotVersion: 1 });
    expect(f.state.snapshots).toHaveLength(1); expect(f.state.sources.length).toBeGreaterThan(0);
    expect(f.state.snapshots[0].payload.dingtalk).toMatchObject({ jobId: job.id, completedCells: 4, totalCells: 6, complete: false });
    await f.worker().dispatch();
    expect((await f.service.list(subjectId, month, actor))[0]).toMatchObject({ status: 'completed', completedCells: 6, canCancel: false });
    expect(f.gateway.readRange.mock.calls.map(([q]: any) => [q.from, q.to])).toEqual([['2035-11-01', '2035-11-04'], ['2035-11-05', '2035-11-06']]);
    expect(f.state.snapshots[1].payload.sync.complete).toBe(true); expect(f.state.snapshots[1].payload.dingtalk.complete).toBe(true);
    expect(f.dingtalk.fetchUserDetail).toHaveBeenCalledWith('private-operator', 'fictional-secret-token', expect.anything());
  });
  it('continues the same job in one dispatch without waiting for the next timer, publishing one transaction per chunk', async () => {
    const f = fixture(); await f.start(); await f.service.dispatch();
    expect(f.state.jobs[0]).toMatchObject({ status: 'completed', cursor: 6, attempts: 2, snapshotVersion: 2 });
    expect(f.state.snapshots.map((row: any) => row.payload.dingtalk.completedCells)).toEqual([4, 6]);
    expect(f.state.snapshots.map((row: any) => row.payload.dingtalk.complete)).toEqual([false, true]);
  });
  it('yields after eight chunks and resumes the remaining employee without truncating the month', async () => {
    const f = fixture(), secondId = '20000000-0000-4000-8000-000000000005';
    f.state.users.push({ ...f.state.users[1], id: secondId, dingtalkId: 'private-second', dingtalkUnionId: 'private-union-second' });
    f.state.policies[0].config.employeeScope.employeeIds.push(secondId);
    f.state.policies[0].config.workCalendars[month].days.forEach((day: any) => { day.units = '1'; });
    f.state.employments[0].effectiveTo = date('2035-11-30');
    f.state.employments.push({ ...f.state.employments[0], id: randomUUID(), userId: secondId }); f.refreshRule();
    await f.start(); await f.service.dispatch();
    expect(f.state.jobs[0]).toMatchObject({ status: 'queued', cursor: 30, totalCells: 60, attempts: 8 });
    expect(f.state.snapshots).toHaveLength(8);
    await f.worker().dispatch();
    expect(f.state.jobs[0]).toMatchObject({ status: 'completed', cursor: 60, attempts: 16 });
    expect(f.state.snapshots).toHaveLength(16);
    expect(f.gateway.readRange.mock.calls[7][0]).toMatchObject({ from: '2035-11-29', to: '2035-11-30' });
    expect(f.gateway.readRange.mock.calls[8][0]).toMatchObject({ from: '2035-11-01', to: '2035-11-04', bindings: [expect.objectContaining({ employeeId: secondId })] });
  });
  it.each(['cancel', 'revoke', 'context'])('rechecks %s between chunks within the same dispatch', async action => {
    const f = fixture(), job = await f.start(), sync = f.data.syncVerified.bind(f.data);
    jest.spyOn(f.data, 'syncVerified').mockImplementationOnce(async (...args) => {
      const result = await sync(...args);
      if (action === 'cancel') await f.service.cancel(job.id, actor);
      if (action === 'revoke') f.state.grants[0].revokedAt = new Date();
      if (action === 'context') { f.state.policies[0].config.workCalendars[month].sourceVersion = 'fictional-between-chunks'; f.refreshRule(); }
      return result;
    });
    await f.service.dispatch();
    expect(f.state.jobs[0]).toMatchObject({ status: action === 'cancel' ? 'cancelled' : 'blocked', cursor: 4 });
    expect(f.state.snapshots).toHaveLength(1); expect(f.gateway.readRange).toHaveBeenCalledTimes(1);
  });
  it('allows only one database-backed claim when two dispatcher instances race', async () => {
    const f = fixture(); await f.start();
    await Promise.all([f.service.dispatch(), f.worker().dispatch()]);
    expect(f.gateway.readRange).toHaveBeenCalledTimes(2); expect(f.state.snapshots).toHaveLength(2);
    expect(f.state.jobs[0]).toMatchObject({ status: 'completed', cursor: 6, attempts: 2 });
  });
  it('rejects a provider scope broader than the claimed cells without modifying any snapshot or source index', async () => {
    const f = fixture(), original = f.gateway.readRange.getMockImplementation()!;
    f.gateway.readRange.mockImplementationOnce(async query => { const read = await original(query); read.scope.to = '2035-11-30'; return read; });
    await f.start(); await f.service.dispatch();
    expect(f.state.jobs[0].status).toBe('blocked'); expect(f.state.snapshots).toEqual([]); expect(f.state.sources).toEqual([]);
  });
  it('resumes a failed later chunk with a new observation without replaying already committed cells', async () => {
    const f = fixture(), job = await f.start(); await dispatchOneChunk(f);
    f.gateway.readRange.mockRejectedValueOnce(new Error('fictional provider failure containing private-target'));
    await f.service.dispatch(); expect(f.state.jobs[0]).toMatchObject({ status: 'failed', cursor: 4 });
    const retried = await f.service.retry(job.id, { requestId: randomUUID() }, actor);
    expect(retried).toMatchObject({ status: 'queued', completedCells: 4, totalCells: 6 });
    await f.service.dispatch(); expect(f.state.jobs[1]).toMatchObject({ status: 'completed', cursor: 6 });
    expect(f.gateway.readRange.mock.calls.map(([q]: any) => q.from)).toEqual(['2035-11-01', '2035-11-05', '2035-11-05']);
  });
  it('rolls back the source index and progress when snapshot insertion fails, then retries with a new observation', async () => {
    const f = fixture(), job = await f.start(); f.state.failSnapshot = true; await f.service.dispatch();
    expect(f.state.jobs[0]).toMatchObject({ status: 'failed', cursor: 0 }); expect(f.state.sources).toEqual([]); expect(f.state.snapshots).toEqual([]);
    f.state.failSnapshot = false; const requestId = randomUUID(), retried = await f.service.retry(job.id, { requestId }, actor);
    expect(retried.observationVersion).toBeGreaterThan(job.observationVersion); expect(retried.status).toBe('queued');
    expect((await f.service.retry(job.id, { requestId }, actor)).id).toBe(retried.id); await f.service.dispatch();
    expect(f.state.snapshots).toHaveLength(2); expect(f.state.jobs[1].status).toBe('completed');
  });
  it.each(['cancel', 'revoke', 'context', 'binding', 'priorSnapshot', 'sourceState', 'priorReview'])('fences %s while an upstream read is in flight', async action => {
    const f = fixture();
    if (action === 'priorReview') f.state.snapshots.push({ id: randomUUID(), subjectId, month, domain: 'formal', version: 1, sourceHash: 'initial',
      payload: { days: [], issues: [], sync: { coverage: [] } }, review: [], status: 'draft', sealedHash: null });
    const job = await f.start(); const original = f.gateway.readRange.getMockImplementation()!;
    let reached!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { reached = resolve; }), release = new Promise<void>(resolve => { resume = resolve; });
    f.gateway.readRange.mockImplementationOnce(async query => { reached(); await release; return original(query); });
    const pending = f.service.dispatch(); await started;
    if (action === 'cancel') await f.service.cancel(job.id, actor);
    if (action === 'revoke') f.state.grants[0].revokedAt = new Date();
    if (action === 'context') { f.state.policies[0].config.workCalendars[month].sourceVersion = 'fictional-revision'; f.refreshRule(); }
    if (action === 'binding') f.state.users[1].dingtalkUnionId = 'changed-binding';
    if (action === 'priorSnapshot') f.state.snapshots.push({ id: randomUUID(), subjectId, month, domain: 'formal', version: 50, sourceHash: 'foreign-update', payload: {} });
    if (action === 'sourceState') f.state.sources.push({ subjectId, month, domain: 'formal', sourceId: 'newer-inflight', employeeId, workDate: date('2035-11-01'), sourceVersion: 999, fingerprint: 'b'.repeat(64), record: {} });
    if (action === 'priorReview') f.state.snapshots[0].review.push({ note: 'fictional review made during upstream read' });
    resume(); await pending;
    expect(f.state.jobs[0].status).toBe(action === 'cancel' ? 'cancelled' : 'blocked');
    expect(f.state.sources).toHaveLength(action === 'sourceState' ? 1 : 0);
    expect(f.state.snapshots).toHaveLength(action === 'priorSnapshot' || action === 'priorReview' ? 1 : 0);
  });
  it('blocks changed context before the next chunk and does not silently overwrite a newer source version', async () => {
    const f = fixture(); await f.start(); await dispatchOneChunk(f);
    f.state.sources.push({ subjectId, month, domain: 'formal', sourceId: 'newer', employeeId, workDate: date('2035-11-05'), sourceVersion: 999,
      fingerprint: 'a'.repeat(64), record: { employeeId, workDate: '2035-11-05', sourceId: 'newer', sourceVersion: 999 } });
    await f.service.dispatch(); expect(f.state.jobs[0].status).toBe('blocked'); expect(f.state.snapshots).toHaveLength(1);
    expect(f.gateway.readRange).toHaveBeenCalledTimes(1);
  });
  it('does not let an expired lease overwrite a reclaimed chunk or advance its cursor twice', async () => {
    const f = fixture(); await f.start(); const original = f.gateway.readRange.getMockImplementation()!;
    let reached!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { reached = resolve; }), release = new Promise<void>(resolve => { resume = resolve; });
    f.gateway.readRange.mockImplementationOnce(async query => { reached(); await release; return original(query); });
    const old = f.service.dispatch(); await started; f.state.jobs[0].leaseUntil = new Date(0);
    await f.worker().dispatch(); resume(); await old;
    expect(f.state.snapshots).toHaveLength(2); expect(f.state.jobs[0]).toMatchObject({ status: 'completed', cursor: 6 });
  });
  it('blocks missing calendars/mappings and leaves unrecognized upstream categories pending with safe mapping keys', async () => {
    const f = fixture(); delete f.state.policies[0].config.workCalendars; f.refreshRule();
    expect((await f.start()).status).toBe('blocked'); expect(f.gateway.readRange).not.toHaveBeenCalled();
    const noMappings = fixture(); delete noMappings.state.policies[0].config.attendanceMappings; noMappings.refreshRule();
    expect((await noMappings.start()).issues).toContainEqual(expect.objectContaining({ code: 'MAPPINGS_REQUIRED' }));
    const g = fixture(); const original = g.gateway.readRange.getMockImplementation()!;
    g.gateway.readRange.mockImplementationOnce(async q => ({ ...await original(q), complete: false,
      pending: [{ code: 'APPROVAL_TYPE_UNMAPPED', mappingKey: '1:fictional leave:', employeeId, workDate: q.from }] } as any));
    await g.start(); await g.service.dispatch();
    const listed = (await g.service.list(subjectId, month, actor))[0]; expect(listed.status).toBe('blocked');
    expect(listed.issues).toContainEqual(expect.objectContaining({ mappingKey: '1:fictional leave:', message: expect.any(String) }));
    expect(g.state.snapshots[0].payload.sync.complete).toBe(false);
    expect(JSON.stringify(listed)).not.toMatch(/private-|fictional-secret-token/);
  });
  it.each([81, 201])('keeps configurable long mapping keys but never overlong keys (%s)', async size => {
    const f = fixture(), original = f.gateway.readRange.getMockImplementation()!, key = `3:leave:${'a'.repeat(size)}`;
    f.gateway.readRange.mockImplementationOnce(async q => ({ ...await original(q), complete: false,
      pending: [{ code: 'APPROVAL_TYPE_UNMAPPED', mappingKey: key, employeeId, workDate: q.from }] } as any));
    await f.start(); await f.service.dispatch();
    const pending = (await f.service.list(subjectId, month, actor))[0].issues.find(row => row.code === 'APPROVAL_TYPE_UNMAPPED');
    expect(pending).toBeDefined();
    if (size === 81) expect(pending?.mappingKey).toBe(key); else expect(pending).not.toHaveProperty('mappingKey');
  });
  it('accepts explicit enabled external bindings without inventing a user binding or returning private identities', async () => {
    const f = fixture();
    for (const user of f.state.users) {
      f.state.bindings.push({ userId: user.id, provider: 'dingtalk', status: 'enabled', endedAt: null, externalUserId: user.dingtalkId, externalUnionId: user.dingtalkUnionId });
      user.dingtalkId = null; user.dingtalkUnionId = null;
    }
    f.dingtalk.fetchUserDetail.mockImplementation(async id => ({ userid: id, unionid: f.state.bindings.find((row: any) => row.externalUserId === id).externalUnionId, name: 'Fictional', corpId: 'fictional-corp' }));
    expect((await f.start()).status).toBe('queued'); await f.service.dispatch();
    expect(f.state.jobs[0]).toMatchObject({ status: 'completed', cursor: 6 });
  });
  it.each(['union', 'corporation', 'disabledBinding', 'userRole'])('suspends invalid %s rather than changing external authorization', async kind => {
    const f = fixture();
    if (kind === 'disabledBinding') f.state.bindings.push({ userId: employeeId, provider: 'dingtalk', status: 'disabled', endedAt: null, externalUserId: 'private-target', externalUnionId: 'private-union-target' });
    if (kind === 'userRole') { const job = await f.start(); f.state.users[0].isAssessorOnly = true; await f.service.dispatch(); expect(f.state.jobs[0]).toMatchObject({ id: job.id, status: 'blocked' }); return; }
    const job = await f.start();
    if (kind === 'union') f.dingtalk.fetchUserDetail.mockResolvedValue({ userid: 'private-operator', unionid: 'wrong', name: 'Fictional', corpId: 'fictional-corp' });
    if (kind === 'corporation') f.dingtalk.fetchUserDetail.mockResolvedValue({ userid: 'private-operator', unionid: 'private-union-operator', name: 'Fictional', corpId: 'other-corp' });
    await f.service.dispatch(); expect(f.state.jobs[0]).toMatchObject({ id: job.id, status: 'blocked' }); expect(f.state.snapshots).toEqual([]);
  });
});
