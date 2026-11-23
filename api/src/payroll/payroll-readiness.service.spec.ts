import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollReadinessService } from './payroll-readiness.service';
import { PayrollAccessService } from './payroll-access.service';
import { PAYROLL_ITEM_CODES } from './payroll-contracts';
import { assertPayrollNetFresh, capturePayrollNet, netSnapshotHash } from './payroll-net';
import { payrollHash } from './payroll-transaction';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { fictionalDeductionsInput } from './payroll-deductions-preview.fixture';
import { PayrollBatchesService } from './payroll-batches.service';

jest.mock('./payroll-net', () => ({ ...jest.requireActual('./payroll-net'), assertPayrollNetFresh: jest.fn() }));

const ids = {
  subject: '11111111-1111-4111-8111-111111111111', other: '11111111-1111-4111-8111-222222222222',
  batch: '22222222-2222-4222-8222-222222222222', version: '33333333-3333-4333-8333-333333333333',
  editor: '44444444-4444-4444-8444-444444444444', reviewer: '55555555-5555-4555-8555-555555555555',
  approver: '66666666-6666-4666-8666-666666666666', viewer: '77777777-7777-4777-8777-777777777777',
  employee: '88888888-8888-4888-8888-888888888888', admin: '99999999-9999-4999-8999-999999999999',
  request: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
const actor = (id: string) => ({ id });
const receiptKey = `payroll_formal_readiness:${ids.subject}`;
const requestKey = (id = ids.request) => `payroll_readiness_request:${id}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture() {
  jest.mocked(assertPayrollNetFresh).mockReset().mockResolvedValue(undefined);
  const configs = new Map<string, any>(), events: any[] = [];
  const grants = new Map<string, string[]>([[ids.editor, ['payroll_edit']], [ids.viewer, ['payroll_view']],
    [ids.reviewer, ['payroll_review']], [ids.approver, ['payroll_approve']]]);
  const active = new Set(Object.values(ids));
  const source = { subjectId: ids.subject, month: '2026-10', domain: 'formal', revision: 1 };
  const lines = PAYROLL_ITEM_CODES.map((itemCode, index) => ({
    id: `line-${index}`, employeeId: ids.employee, attributionMonth: '2026-10', itemCode, status: 'ready',
    entitlement: new Prisma.Decimal(index ? 0 : 100), paidBefore: new Prisma.Decimal(0), amount: new Prisma.Decimal(index ? 0 : 100),
    evidence: { employeeName: 'Fictional employee', employeeNo: 'FICTION-1' },
  }));
  const capture: any = { sourceHash: payrollHash(source), sources: clone(source), issues: [],
    approvalPath: [ids.reviewer, ids.approver], reviewerCount: 1, gross: '100.00',
    lines: lines.map(line => ({ ...line, entitlement: line.entitlement.toFixed(2), paidBefore: '0.00', amount: line.amount.toFixed(2) })),
  };
  const net: any = { schema: 1, subjectId: ids.subject, domain: 'formal', payDate: '2026-11-10',
    rows: [{ employeeId: ids.employee, employeeName: 'Fictional employee', employeeNo: 'FICTION-1',
      result: { status: 'ready', issues: [], gross: '100.00', socialInsurance: '10.00', housingFund: '5.00',
        incomeTax: '2.00', net: '83.00', evidence: { parameter: { id: 'reviewed-profile' } } }, ledger: { taxDeductions: '0.00' } }],
    totals: { gross: '100.00', socialInsurance: '10.00', housingFund: '5.00', incomeTax: '2.00', net: '83.00' },
  };
  net.sourceHash = netSnapshotHash(net);
  const version: any = { id: ids.version, batchId: ids.batch, version: 1, status: 'calculated',
    sourceHash: payrollHash([{ month: source.month, sourceHash: capture.sourceHash }]), sources: { months: [{ month: source.month, sources: clone(source) }] },
    issues: [], approvalPath: [...capture.approvalPath], reviewerCount: 1, gross: new Prisma.Decimal(100),
    payDate: new Date('2026-11-10T00:00:00Z'), netSnapshot: net, lines, voidedAt: null,
  };
  const batch: any = { id: ids.batch, subjectId: ids.subject, month: '2026-10', payMonth: '2026-11',
    purpose: 'reconciliation', status: 'calculated', version: 4, additionalMonths: [], versions: [version] };
  const tx: any = {
    $queryRaw: jest.fn(async () => [{ locked: 1 }]),
    payrollGrant: { findMany: jest.fn(async ({ where }: any) => active.has(where.userId) && grants.has(where.userId)
      && (!where.subjectId || where.subjectId === ids.subject)
      ? [{ userId: where.userId, subjectId: ids.subject, capabilities: grants.get(where.userId), revokedAt: null }] : []) },
    user: { findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, name: `Fictional ${id.slice(0, 4)}` }))),
      findFirst: jest.fn(async ({ where }: any) => active.has(where.id) ? { id: where.id } : null) },
    payrollBatch: { findUnique: jest.fn(async () => batch) },
    payrollVersion: { findUnique: jest.fn(async ({ where }: any) => where.id === version.id ? version : null) },
    systemConfig: {
      findUnique: jest.fn(async ({ where }: any) => configs.has(where.key) ? { key: where.key, value: clone(configs.get(where.key)) } : null),
      findMany: jest.fn(async ({ where }: any) => [...configs].filter(([key, value]) => key.startsWith(where.key.startsWith)
        && where.AND.every((filter: any) => filter.value.path[0] === 'subjectId' ? value.subjectId === filter.value.equals
          : value.approvalPath.includes(filter.value.array_contains[0]))).map(([key, value]) => ({ key, value: clone(value) }))),
      create: jest.fn(async ({ data }: any) => { if (configs.has(data.key)) throw { code: 'P2002' };
        configs.set(data.key, clone(data.value)); return data; }),
      update: jest.fn(async ({ where, data }: any) => { configs.set(where.key, clone(data.value)); return { key: where.key, ...data }; }),
      upsert: jest.fn(async ({ where, create, update }: any) => { const data = configs.has(where.key) ? update : create;
        configs.set(where.key, clone(data.value)); return { key: where.key, ...data }; }),
    },
    payrollEvent: { create: jest.fn(async ({ data }: any) => { events.push(clone(data)); return data; }) },
  };
  let queue = Promise.resolve();
  const prisma: any = { ...tx, $transaction: jest.fn(async (work: any) => {
    const previous = queue; let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = clone([...configs]), count = events.length;
    try { return await work(tx); }
    catch (error) { configs.clear(); for (const [key, value] of before) configs.set(key, value); events.splice(count); throw error; }
    finally { release(); }
  }) };
  const access = new PayrollAccessService(prisma, { get: (key: string) => ({ PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true' }[key]) } as any);
  const sources = { capture: jest.fn(async () => capture) };
  const service = new PayrollReadinessService(prisma, access, sources);
  const input = { batchId: ids.batch, expectedVersion: 4, firstMonth: '2026-11', reference: 'Fictional reconciliation acceptance', requestId: ids.request };
  const submit = () => service.submit(input, actor(ids.editor));
  const review = () => service.decide(ids.request, { expectedVersion: 1, decision: 'approve', note: '' }, actor(ids.reviewer));
  const approve = () => service.decide(ids.request, { expectedVersion: 2, decision: 'approve', note: 'Accepted fictional comparison' }, actor(ids.approver));
  return { service, prisma, tx, sources, access, configs, events, grants, active, batch, version, capture, input, submit, review, approve };
}

async function historicalFixture(paid: string) {
  const f = fixture(), payDate = '2026-11-10';
  f.version.lines[0].entitlement = new Prisma.Decimal('1000.00');
  f.version.lines[0].paidBefore = new Prisma.Decimal(paid);
  f.version.lines[0].amount = new Prisma.Decimal('1000.00').minus(paid);
  f.capture.lines = f.version.lines.map((line: any) => ({ ...line, entitlement: line.entitlement.toFixed(2),
    paidBefore: line.paidBefore.toFixed(2), amount: line.amount.toFixed(2) }));
  f.capture.gross = f.version.lines[0].amount.toFixed(2);
  const { subjectId, employeeId, gross, payDate: date, ...settings } = fictionalDeductionsInput({
    subjectId: ids.subject, employeeId: ids.employee, month: '2026-10', payDate, gross: '1000.00' });
  const { subjectId: subject, employeeId: employee, year, ...opening } = settings.tax.opening;
  const profile: any = { id: 'fictional-reviewed-profile', subjectId, employeeId, domain: 'formal', version: 1, status: 'active',
    payDate: new Date(date), effectiveFrom: new Date(date), effectiveTo: new Date(date), settings: {
      ...settings, tax: { ...settings.tax, opening }, ledger: { startDate: '2026-01-01',
        priorInPayMonth: Object.fromEntries(Object.keys(settings.tax.current).map(key => [key, '0'])), priorSocialInsurance: '0', priorHousingFund: '0' },
    } };
  profile.releases = [{ id: 'fictional-profile-release', parameterVersion: 1, submittedById: ids.editor, reviewerId: ids.reviewer,
    snapshotHash: payrollHash(payrollParameterDefinition('deduction', profile)) }];
  f.tx.payrollDeductionProfile = { findFirst: jest.fn(async () => profile) };
  f.tx.payrollNetPayment = { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), create: jest.fn() };
  f.tx.payrollEvent.findFirst = jest.fn(async () => null);
  f.version.netSnapshot = await capturePayrollNet(f.tx, f.batch, 'formal', payDate, f.capture.lines);
  f.version.gross = new Prisma.Decimal('1000.00');
  jest.mocked(assertPayrollNetFresh).mockImplementation(jest.requireActual<typeof import('./payroll-net')>('./payroll-net').assertPayrollNetFresh);
  return { ...f, profile };
}

describe('first-month payroll readiness requests', () => {
  it.each(['1000.00', '400.00'])('submits, refreshes and signs full historical net after %s was paid without changing wage facts or opening payment gates', async paid => {
    const f = await historicalFixture(paid), before = JSON.stringify({ batch: f.batch, capture: f.capture });
    expect(f.version.netSnapshot.totals).toEqual({ gross: '1000.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '80.00', net: '720.00' });
    await expect(f.access.assertFormalPayrollReady(f.tx, ids.subject, '2026-11')).rejects.toThrow(ConflictException);
    const submitted = await f.submit();
    expect(submitted.netSnapshot.totals?.net).toBe('720.00');
    expect(submitted.lines[0]).toMatchObject({ entitlement: '1000.00', paidBefore: paid, amount: paid === '1000.00' ? '0.00' : '600.00' });
    expect((await f.service.detail(ids.request, actor(ids.editor))).netSnapshot).toEqual(submitted.netSnapshot);
    expect((await f.submit()).request.id).toBe(ids.request);
    expect(f.events).toHaveLength(1);
    expect((await f.review()).request.status).toBe('pending');
    await expect(f.access.assertFormalPayrollReady(f.tx, ids.subject, '2026-11')).rejects.toThrow(ConflictException);
    expect((await f.approve()).request.status).toBe('approved');
    expect((await f.service.detail(ids.request, actor(ids.approver))).netSnapshot).toEqual(submitted.netSnapshot);
    await expect(f.access.assertFormalPayrollReady(f.tx, ids.subject, '2026-11')).resolves.toBeUndefined();
    await expect(f.access.assertFormalPayrollReady(f.tx, ids.subject, '2026-10')).rejects.toThrow(ConflictException);
    await expect(f.access.assert(f.tx, actor(ids.editor), ids.subject, 'payroll_settle')).rejects.toThrow(ForbiddenException);
    f.grants.set(ids.editor, ['payroll_edit', 'payroll_settle']);
    const wages = new PayrollBatchesService(f.prisma, f.access, f.sources);
    await expect(wages.netPayment(ids.batch, { expectedVersion: f.batch.version, employeeId: ids.employee, requestId: ids.second,
      payDate: '2026-11-10', reference: 'Fictional blocked reconciliation payment' }, actor(ids.editor))).rejects.toThrow(/对账/);
    expect(f.tx.payrollNetPayment.create).not.toHaveBeenCalled();
    await f.service.revoke(ids.request, { expectedVersion: 3, note: 'Fictional acceptance withdrawn' }, actor(ids.approver));
    await expect(f.access.assertFormalPayrollReady(f.tx, ids.subject, '2026-11')).rejects.toThrow(ConflictException);
    expect(JSON.stringify({ batch: f.batch, capture: f.capture })).toBe(before);
  });

  it('rejects readiness review after the approved historical deduction source changes and keeps the frozen full-net detail', async () => {
    const f = await historicalFixture('400.00');
    const frozen = (await f.submit()).netSnapshot;
    f.profile.settings.tax.opening.sourceVersion = 'fictional-approved-opening-correction';
    f.profile.releases[0].snapshotHash = payrollHash(payrollParameterDefinition('deduction', f.profile));
    await expect(f.review()).rejects.toThrow(ConflictException);
    expect(f.configs.get(requestKey())).toMatchObject({ version: 1, approvalStep: 0, status: 'pending', decisions: [] });
    expect((await f.service.detail(ids.request, actor(ids.reviewer))).netSnapshot).toEqual(frozen);
    await expect(f.access.assertFormalPayrollReady(f.tx, ids.subject, '2026-11')).rejects.toThrow(ConflictException);
    expect(f.tx.payrollNetPayment.create).not.toHaveBeenCalled();
  });

  it('freezes a complete formal reconciliation with an independent approved path without touching payroll facts', async () => {
    const f = fixture(), before = JSON.stringify(f.batch);
    const result = await f.submit();
    expect(result.request).toMatchObject({ id: ids.request, version: 1, versionId: ids.version,
      subjectId: ids.subject, status: 'pending', approvalStep: 0, reviewerCount: 1, approvalPath: [ids.reviewer, ids.approver] });
    expect(result.netSnapshot.totals?.net).toBe('83.00');
    expect(result.canWithdraw).toBe(true); expect(result.canDecide).toBe(false);
    expect(f.configs.has(receiptKey)).toBe(false);
    expect(JSON.stringify(f.batch)).toBe(before);
    expect(f.tx.$queryRaw).toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'ReadCommitted' }));
    expect(assertPayrollNetFresh).toHaveBeenCalledWith(f.tx, f.batch, f.version.netSnapshot, 'formal', f.version.id);
    expect(f.events[0]).toMatchObject({ action: 'readiness_submitted', actorId: ids.editor,
      metadata: { requestId: ids.request, beforeVersion: null, afterVersion: 1 } });
  });

  it('requires the review step before final approval and atomically records the actual last actor', async () => {
    const f = fixture(), before = JSON.stringify(f.batch);
    await f.submit();
    await expect(f.service.decide(ids.request, { expectedVersion: 1, decision: 'approve', note: '' }, actor(ids.approver))).rejects.toThrow(ForbiddenException);
    expect((await f.review()).request).toMatchObject({ version: 2, approvalStep: 1, status: 'pending' });
    expect(f.configs.has(receiptKey)).toBe(false);
    const final = await f.approve();
    expect(final.request).toMatchObject({ status: 'approved', version: 3, approvalStep: 2 });
    expect(f.configs.get(receiptKey)).toEqual({ subjectId: ids.subject, state: 'approved', firstMonth: '2026-11',
      reference: f.input.reference, approvedAt: expect.any(String), approvedById: ids.approver, requestId: ids.request });
    expect(f.events.at(-1)).toMatchObject({ action: 'readiness_approved', actorId: ids.approver,
      metadata: { beforeVersion: 2, afterVersion: 3, versionId: ids.version } });
    await expect(f.access.assertFormalPayrollReady(f.tx, ids.subject, '2026-11')).resolves.toBeUndefined();
    expect(JSON.stringify(f.batch)).toBe(before);
  });

  it.each(['trial', 'validation', 'formal'])('rejects %s instead of a formal-domain reconciliation', async purpose => {
    const f = fixture(); f.batch.purpose = purpose;
    await expect(f.submit()).rejects.toThrow(ConflictException); expect(f.configs.size).toBe(0);
  });

  it.each(['pending', 'approved', 'draft'])('rejects a reconciliation in %s state', async status => {
    const f = fixture(); f.batch.status = status;
    await expect(f.submit()).rejects.toThrow(ConflictException);
  });

  it.each([
    { expectedVersion: 3 }, { firstMonth: '2026-09' }, { firstMonth: '2026-13' }, { firstMonth: '' },
    { reference: ' ' }, { approvedById: ids.editor }, { approvalPath: [ids.editor] }, { actor: { id: ids.approver } },
  ])('rejects stale, incomplete or forged submit fields (%j)', async change => {
    const f = fixture();
    await expect(f.service.submit({ ...f.input, ...change } as any, actor(ids.editor))).rejects.toThrow(
      'expectedVersion' in change || change.firstMonth === '2026-09' ? ConflictException : BadRequestException);
    expect(f.configs.size).toBe(0);
  });

  it('uses live subject grants, not admin role, JWT claims or a foreign subject grant', async () => {
    const f = fixture();
    await expect(f.service.submit(f.input, { id: ids.admin, sysRole: 'system_admin' })).rejects.toThrow(ForbiddenException);
    f.batch.subjectId = ids.other;
    await expect(f.submit()).rejects.toThrow(ForbiddenException);
    expect(f.configs.size).toBe(0);
  });

  it.each(['missing', 'totals', 'lines', 'issues', 'payDate'])('rejects incomplete net calculation (%s)', async fault => {
    const f = fixture();
    if (fault === 'missing') f.version.netSnapshot = null;
    if (fault === 'totals') f.version.netSnapshot.totals.net = '84.00';
    if (fault === 'lines') f.version.lines.pop();
    if (fault === 'issues') f.version.issues = ['Awaiting real input'];
    if (fault === 'payDate') f.version.payDate = new Date('2026-11-11T00:00:00Z');
    await expect(f.submit()).rejects.toThrow(ConflictException); expect(f.configs.size).toBe(0);
  });

  it('rejects self-review, duplicate people and paths without both review and approval', async () => {
    for (const path of [[ids.editor, ids.approver], [ids.reviewer, ids.reviewer], [ids.reviewer]]) {
      const f = fixture(); f.version.approvalPath = path; f.capture.approvalPath = path;
      await expect(f.submit()).rejects.toThrow(ConflictException);
    }
  });

  it('rechecks permissions after waiting for the subject lock', async () => {
    const f = fixture(); f.tx.$queryRaw.mockImplementation(async () => { f.grants.delete(ids.editor); return []; });
    await expect(f.submit()).rejects.toThrow(ForbiddenException); expect(f.configs.size).toBe(0);
  });

  it('blocks approval after submitter, signer or another path member loses live authority', async () => {
    for (const lost of [ids.editor, ids.reviewer, ids.approver]) {
      const f = fixture(); await f.submit(); f.grants.delete(lost);
      await expect(f.review()).rejects.toThrow(ForbiddenException); expect(f.configs.has(receiptKey)).toBe(false);
    }
  });

  it.each(['submit', 'review'])('rechecks path authority after the net freshness boundary during %s', async action => {
    const f = fixture();
    if (action === 'review') await f.submit();
    jest.mocked(assertPayrollNetFresh).mockImplementation(async () => { f.grants.delete(ids.approver); });
    await expect(action === 'submit' ? f.submit() : f.review()).rejects.toThrow(ForbiddenException);
    expect(f.configs.has(receiptKey)).toBe(false);
    expect(f.configs.get(requestKey())?.version ?? 0).toBe(action === 'submit' ? 0 : 1);
  });

  it.each(['source', 'net', 'latest', 'path'])('blocks approval when %s changes without replacing frozen evidence', async changed => {
    const f = fixture(); await f.submit();
    if (changed === 'source') f.capture.sourceHash = 'f'.repeat(64);
    if (changed === 'net') jest.mocked(assertPayrollNetFresh).mockRejectedValue(new ConflictException('Ledger changed'));
    if (changed === 'latest') f.batch.versions = [{ ...f.version, id: ids.second, version: 2 }];
    if (changed === 'path') f.capture.approvalPath = [ids.viewer, ids.approver];
    await expect(f.review()).rejects.toThrow(ConflictException);
    expect(f.configs.get(requestKey())).toMatchObject({ version: 1, approvalStep: 0, decisions: [] });
    expect(f.configs.has(receiptKey)).toBe(false);
  });

  it('allows return and resubmission with a new id while retaining the original record', async () => {
    const f = fixture(); await f.submit();
    f.capture.sourceHash = 'f'.repeat(64);
    const returned = await f.service.decide(ids.request, { expectedVersion: 1, decision: 'return', note: 'Please recheck' }, actor(ids.reviewer));
    expect(returned.request).toMatchObject({ status: 'returned', version: 2, approvalStep: 0 });
    f.capture.sourceHash = payrollHash(f.capture.sources);
    const result = await f.service.submit({ ...f.input, requestId: ids.second }, actor(ids.editor));
    expect(result.request.id).toBe(ids.second);
    expect(f.configs.get(requestKey()).status).toBe('returned');
  });

  it('allows only the live submitter to withdraw and keeps the gate closed', async () => {
    const f = fixture(); await f.submit();
    await expect(f.service.withdraw(ids.request, { expectedVersion: 1, note: 'Withdraw' }, actor(ids.viewer))).rejects.toThrow(ForbiddenException);
    expect((await f.service.withdraw(ids.request, { expectedVersion: 1, note: 'Withdraw' }, actor(ids.editor))).request.status).toBe('withdrawn');
    expect(f.configs.has(receiptKey)).toBe(false);
  });

  it('allows only the original last approver with current approve rights to revoke the receipt', async () => {
    const f = fixture(); await f.submit(); await f.review(); await f.approve();
    const before = JSON.stringify(f.batch);
    await expect(f.service.revoke(ids.request, { expectedVersion: 3, note: 'Recheck needed' }, actor(ids.editor))).rejects.toThrow(ForbiddenException);
    f.grants.delete(ids.approver);
    await expect(f.service.revoke(ids.request, { expectedVersion: 3, note: 'Recheck needed' }, actor(ids.approver))).rejects.toThrow(ForbiddenException);
    f.grants.set(ids.approver, ['payroll_approve']);
    expect((await f.service.revoke(ids.request, { expectedVersion: 3, note: 'Recheck needed' }, actor(ids.approver))).request.status).toBe('revoked');
    expect(f.configs.get(receiptKey)).toMatchObject({ state: 'revoked', revokedById: ids.approver });
    await expect(f.access.assertFormalPayrollReady(f.tx, ids.subject, '2026-11')).rejects.toThrow(ConflictException);
    expect(JSON.stringify(f.batch)).toBe(before);
  });

  it('returns an exact submit replay but rejects changed content, actor and stale request revisions', async () => {
    const f = fixture(); await f.submit();
    expect((await f.submit()).request.id).toBe(ids.request);
    expect(f.events).toHaveLength(1);
    await expect(f.service.submit({ ...f.input, reference: 'Different' }, actor(ids.editor))).rejects.toThrow(ConflictException);
    await f.review(); await expect(f.review()).rejects.toThrow(ConflictException);
    expect(f.events).toHaveLength(2);
  });

  it('serializes competing submissions and decisions without two active requests or duplicate receipts', async () => {
    const f = fixture();
    const submits = await Promise.allSettled([f.submit(), f.service.submit({ ...f.input, requestId: ids.second }, actor(ids.editor))]);
    expect(submits.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(submits.filter(result => result.status === 'rejected')).toHaveLength(1);
    const decisions = await Promise.allSettled([f.review(), f.review()]);
    expect(decisions.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.configs.get(requestKey()).decisions).toHaveLength(1);
  });

  it('rolls back both receipt and request if the acceptance event cannot be saved', async () => {
    const f = fixture(); await f.submit(); await f.review();
    f.tx.payrollEvent.create.mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(f.approve()).rejects.toThrow('Audit unavailable');
    expect(f.configs.has(receiptKey)).toBe(false);
    expect(f.configs.get(requestKey())).toMatchObject({ version: 2, approvalStep: 1, status: 'pending' });
  });

  it('filters lists by subject and explicit assignment and exposes only the frozen version to assigned readers', async () => {
    const f = fixture(); await f.submit();
    expect((await f.service.list(ids.subject, actor(ids.reviewer))).map(row => row.id)).toEqual([ids.request]);
    f.grants.set(ids.admin, ['payroll_review']);
    expect(await f.service.list(ids.subject, actor(ids.admin))).toEqual([]);
    f.tx.payrollVersion.findUnique.mockClear();
    await expect(f.service.detail(ids.request, actor(ids.admin))).rejects.toThrow(ForbiddenException);
    expect(f.tx.payrollVersion.findUnique).not.toHaveBeenCalled();
    const detail = await f.service.detail(ids.request, actor(ids.reviewer));
    expect(detail.canDecide).toBe(true);
    expect(detail.request.versionId).toBe(ids.version);
    expect(detail).not.toHaveProperty('versions'); expect(detail).not.toHaveProperty('sources');
    const query = f.tx.systemConfig.findMany.mock.calls[0][0];
    expect(query.where.AND).toContainEqual({ value: { path: ['subjectId'], equals: ids.subject } });
  });

  it('does not allow stale revoke to close another accepted request or bypass an existing receipt', async () => {
    const f = fixture(); await f.submit(); await f.review(); await f.approve();
    await expect(f.service.submit({ ...f.input, requestId: ids.second }, actor(ids.editor))).rejects.toThrow(ConflictException);
    f.configs.set(receiptKey, { ...f.configs.get(receiptKey), requestId: ids.second });
    await expect(f.service.revoke(ids.request, { expectedVersion: 3, note: 'Not this receipt' }, actor(ids.approver))).rejects.toThrow(ConflictException);
    expect(f.configs.get(receiptKey).state).toBe('approved');
  });

  it('fails closed on malformed persisted request JSON', async () => {
    const f = fixture(); await f.submit();
    f.configs.set(requestKey(), { ...f.configs.get(requestKey()), approvalStep: 99, unexpected: true });
    await expect(f.service.detail(ids.request, actor(ids.editor))).rejects.toThrow(ConflictException);
  });
});
