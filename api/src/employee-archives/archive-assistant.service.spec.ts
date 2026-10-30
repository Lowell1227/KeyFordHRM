import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { createHmac } from 'crypto';

// Missing boundary must fail an assertion during the initial red run.
let Boundary: any;
try { Boundary = require('./archive-assistant.service').ArchiveAssistantService; } catch {}
const viewer: any = { id: 'actor', name: 'HR', sysRole: 'hr', deptId: null, canViewAll: true, isAssessorOnly: false };
const source = { corpId: 'corp', senderStaffId: 'staff', conversationId: 'private', deliveryId: 'event' };
const key = 'synthetic-test-key';

function fixture() {
  expect(Boundary).toBeDefined();
  const rows: any[] = [], audits: any[] = [];
  const actor: any = { ...viewer, employeeNo: '312', accountType: 'employee', status: 'active', deletedAt: null, archivedAt: null };
  const binding: any = { id: 'binding', externalUserId: 'staff', status: 'enabled', endedAt: null };
  const tx: any = {
    user: { findUnique: jest.fn(async () => actor) },
    employmentRecord: { findFirst: jest.fn(async () => ({ employeeStatus: 'active' })) },
    externalIdentityBinding: { findFirst: jest.fn(async () => binding) },
    employeeDataChangeRequest: {
      findUnique: jest.fn(async ({ where }: any) => rows.find(row => row.sourceReference === where.sourceSystem_sourceReference?.sourceReference) ?? null),
      findFirst: jest.fn(async ({ where }: any) => where.id ? rows.find(row => row.id === where.id) : rows.find(row => row.sourceSystem === where.sourceSystem && row.createdById === where.createdById &&
        (where.baseValue ? row.baseValue?.assistantEvents?.includes(where.baseValue.array_contains[0]) : row.recordStatus === 'draft' && !row.archivedAt && !row.cancelledAt)) ?? null),
      create: jest.fn(async ({ data }: any) => { const row = { id: `request-${rows.length}`, requestVersion: 1, ...data }; rows.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = rows.find(row => row.id === where.id); Object.assign(row, data, { requestVersion: typeof data.requestVersion === 'object' ? row.requestVersion + 1 : row.requestVersion }); return row; }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) },
    $executeRaw: jest.fn(),
  };
  let queue = Promise.resolve();
  const prisma: any = { ...tx, $transaction: jest.fn((fn: any) => {
    const pending = queue.then(async () => {
      const count = rows.length, auditCount = audits.length;
      try { return await fn(tx); } catch (error) { rows.splice(count); audits.splice(auditCount); throw error; }
    }); queue = pending.catch(() => undefined); return pending;
  }) };
  const settings: any = { ARCHIVE_ASSISTANT_PILOT_ENABLED: 'true', JWT_SECRET: key };
  const config: any = { get: (name: string) => settings[name] };
  const archives = new EmployeeArchivesService(prisma, config);
  const service = new Boundary(prisma, config, archives);
  const token = async (deliveryId = 'event') => new URLSearchParams(new URL((await service.prepare(viewer, { ...source, deliveryId })).url, 'https://local.invalid').hash.slice(1)).get('preview')!;
  return { service, token, tx, rows, audits, actor, binding, settings, archives };
}

describe('archive assistant controlled synthetic reception', () => {
  it('previews the fixed sample with no writes or real personnel in token', async () => {
    const f = fixture(), token = await f.token();
    const preview = await f.service.preview(token, viewer);
    expect(preview).toMatchObject({ employeeName: '【测试】档案助手样例', workLocation: '杭州（测试资料）', saved: null });
    expect(f.rows).toHaveLength(0); expect(f.audits).toHaveLength(0);
    expect(Buffer.from(token.split('.')[0], 'base64url').toString()).not.toMatch(/员工|测试|staff|corp|312/);
  });
  it.each(['disabled', 'role', 'employeeNo', 'deleted', 'archived', 'account', 'status', 'binding', 'employment'])('rejects live access revocation: %s', async kind => {
    const f = fixture(), token = await f.token();
    if (kind === 'disabled') f.settings.ARCHIVE_ASSISTANT_PILOT_ENABLED = 'false';
    if (kind === 'role') f.actor.sysRole = 'employee';
    if (kind === 'employeeNo') f.actor.employeeNo = '313';
    if (kind === 'deleted') f.actor.deletedAt = new Date();
    if (kind === 'archived') f.actor.archivedAt = new Date();
    if (kind === 'account') f.actor.accountType = 'test';
    if (kind === 'status') f.actor.status = 'resigned';
    if (kind === 'binding') f.tx.externalIdentityBinding.findFirst.mockResolvedValue(null);
    if (kind === 'employment') f.tx.employmentRecord.findFirst.mockResolvedValue({ employeeStatus: 'resigned' });
    await expect(f.service.preview(token, viewer)).rejects.toThrow();
    await expect(f.service.save(token, viewer)).rejects.toThrow();
    expect(f.rows).toHaveLength(0);
  });
  it('rejects forwarded, modified, oversized, expired and same-event-different sample tokens', async () => {
    const f = fixture(), token = await f.token();
    await expect(f.service.preview(token, { ...viewer, id: 'other' })).rejects.toThrow();
    await expect(f.service.save(token + 'x', viewer)).rejects.toThrow();
    await expect(f.service.save('x'.repeat(4097), viewer)).rejects.toThrow();
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    const sign = (value: any) => { const data = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${data}.${createHmac('sha256', key).update(data).digest('base64url')}`; };
    await f.service.save(token, viewer);
    await expect(f.service.save(sign({ ...payload, sample: 'changed' }), viewer)).rejects.toThrow();
    await expect(f.service.save(sign({ ...payload, exp: Date.now() - 1 }), viewer)).rejects.toThrow();
    expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1);
  });
  it('explicit save is atomic, unbound and replays current status without duplicate writes', async () => {
    const f = fixture(), token = await f.token();
    const results = await Promise.all([f.service.save(token, viewer), f.service.save(token, viewer)]);
    expect(results.map(item => item.replayed)).toEqual([false, true]);
    expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ userId: null, employeeNo: null, recordStatus: 'draft', sourceType: 'manual_employee_create', sourceSystem: 'archive_assistant_pilot' });
    expect(f.rows[0].proposedValue.employee).toMatchObject({ company: null, deptId: null, employeeStatus: null });
    expect(f.rows[0].proposedValue.contracts).toEqual([]);
    for (const state of ['submitted', 'applied', 'archived', 'cancelled']) {
      f.rows[0].recordStatus = state; f.rows[0].requestVersion++;
      expect(await f.service.save(token, viewer)).toMatchObject({ recordStatus: state, requestVersion: f.rows[0].requestVersion, replayed: true });
    }
    expect(f.audits).toHaveLength(1);
  });
  it('another source event returns the active pilot while ordinary drafts are untouched', async () => {
    const f = fixture(); f.rows.push({ id: 'ordinary', sourceSystem: null, recordStatus: 'draft', createdById: viewer.id });
    const first = await f.service.save(await f.token(), viewer);
    expect(await f.service.save(await f.token('next'), viewer)).toMatchObject({ requestId: first.requestId, replayed: true });
    expect(f.rows).toHaveLength(2); expect(f.audits).toHaveLength(1);
  });
  it('audit failure rolls back draft and source', async () => {
    const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.service.save(await f.token(), viewer)).rejects.toThrow('audit unavailable');
    expect(f.rows).toHaveLength(0);
  });
  it('remembers an additional event after archive and preserves source through ordinary edits', async () => {
    const f = fixture(), token = await f.token();
    await f.service.save(token, viewer);
    const next = await f.token('another'); await f.service.save(next, viewer);
    const originalSource = f.rows[0].sourceReference;
    f.tx.employeeDataChangeRequest.findUnique.mockImplementation(async ({ where }: any) => where.id ? f.rows.find(row => row.id === where.id) : f.rows.find(row => row.sourceReference === where.sourceSystem_sourceReference?.sourceReference) ?? null);
    await f.archives.saveEmployeeCreateDraft({ draftId: f.rows[0].id, name: 'edited', employee: { workLocation: 'edited' } } as any, viewer);
    expect(f.rows[0].sourceSystem).toBe('archive_assistant_pilot'); expect(f.rows[0].sourceReference).toBe(originalSource);
    expect(f.rows[0].validationWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'identity' })]));
    f.rows[0].recordStatus = 'archived'; f.rows[0].archivedAt = new Date();
    expect(await f.service.save(next, viewer)).toMatchObject({ requestId: f.rows[0].id, recordStatus: 'archived', replayed: true });
    expect(f.rows).toHaveLength(1);
  });
  it('blocks pilot submission before validation, number reservation or formal writes', async () => {
    const prisma: any = { employeeDataChangeRequest: { findFirst: jest.fn(async () => ({ sourceSystem: 'archive_assistant_pilot' })) } };
    prisma.$transaction = async (fn: any) => fn(prisma);
    await expect(new EmployeeArchivesService(prisma).createEmployee({ draftId: 'pilot' } as any, viewer)).rejects.toThrow('测试资料仅可保存待核草稿');
  });
  it('blocks submitted pilot approval before applying either scope', async () => {
    const tx: any = { employeeDataChangeRequest: { findUnique: jest.fn(async () => ({ id: 'pilot', sourceSystem: 'archive_assistant_pilot', recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'pending' })) } };
    const service = new EmployeeDataReviewsService({ $transaction: async (fn: any) => fn(tx) } as any);
    const result = await service.approveBatch({ requestIds: ['pilot'], scopes: ['profile', 'performance'] }, viewer);
    expect(result.failed[0].reason).toBe('测试资料仅可保存待核草稿');
  });
});
