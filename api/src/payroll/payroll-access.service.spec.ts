import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PayrollAccessService } from './payroll-access.service';
import { payrollReadinessRequestHash } from './dto/payroll-readiness.dto';

describe('live payroll access', () => {
  function fixture(values: Record<string, string> = { PAYROLL_ENABLED: 'true', HRM_PREVIEW: 'true' }) {
    const findMany = jest.fn(async () => []);
    const prisma = { payrollGrant: { findMany }, payrollParameterRelease: { findMany: jest.fn(async () => []) } } as any;
    return { findMany, prisma, service: new PayrollAccessService(prisma, { get: (key: string) => values[key] } as any) };
  }
  it('disabled payroll leaves existing authentication independent of salary tables', async () => {
    const { service, findMany } = fixture({});
    expect(await service.getAccess({ id: 'admin', sysRole: 'system_admin' })).toEqual({ enabled: false, subjects: [] });
    await expect(service.assert({ payrollGrant: { findMany } } as any, { id: 'admin' }, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each(['system_admin', 'hr'])('does not elevate %s into payroll', async sysRole => {
    const { service, prisma } = fixture();
    await expect(service.assert(prisma, { id: 'operator', sysRole }, 'subject', 'payroll_export')).rejects.toThrow(ForbiddenException);
  });
  it('reads current grants and eligible actor state on every operation', async () => {
    const { service, prisma, findMany } = fixture();
    await expect(service.assert(prisma, { id: 'operator', sysRole: 'employee' }, 'subject', 'payroll_edit')).rejects.toThrow();
    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'operator', subjectId: 'subject', revokedAt: null,
      user: { status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null, isAssessorOnly: false } } });
  });
  it('formal enablement never opens the formal channel inside preview', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'true', HRM_PREVIEW: 'true', PAYROLL_FORMAL_ENABLED: 'true' });
    await expect(service.assertDomain(prisma, 'formal')).rejects.toThrow(ForbiddenException);
  });
  it('reads authorized real reconciliation from the formal domain without touching preview fixtures', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false' });
    prisma.systemConfig = { findUnique: jest.fn(() => { throw new Error('Preview fixture must not be read'); }) };
    await expect(service.assertDomain(prisma, 'reconciliation' as any)).resolves.toBe('formal');
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    { PAYROLL_ENABLED: 'false', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false' },
    { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'false', HRM_PREVIEW: 'false' },
    { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'true' },
  ])('keeps real reconciliation closed under %j', async flags => {
    const { service, prisma } = fixture(flags);
    await expect(service.assertDomain(prisma, 'reconciliation' as any)).rejects.toThrow(ForbiddenException);
  });
  it('chooses the maintenance domain from server configuration, never a client selector', () => {
    expect(fixture().service.maintenancePurpose()).toBe('validation');
    expect(fixture({ PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true' }).service.maintenancePurpose()).toBe('formal');
    expect(fixture({}).service.maintenancePurpose()).toBe('formal');
  });
  it('the global switch alone cannot enable formal payroll', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'true' });
    expect(service.enabled()).toBe(false);
    await expect(service.assertDomain(prisma, 'formal')).rejects.toThrow(ForbiddenException);
  });
  it('the formal flag cannot bypass the disabled global switch for domain-only checks', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'false', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false' });
    await expect(service.assertDomain(prisma, 'formal')).rejects.toThrow(ForbiddenException);
  });
  it('checks revoked grants again rather than trusting the menu or JWT', async () => {
    const { service, prisma, findMany } = fixture();
    findMany.mockResolvedValueOnce([{ userId: 'operator', subjectId: 'subject', capabilities: ['payroll_view'], revokedAt: null }] as any);
    await expect(service.assert(prisma, { id: 'operator' }, 'subject', 'payroll_view')).resolves.toBeUndefined();
    await expect(service.assert(prisma, { id: 'operator' }, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
  it('assigned parameter review exposes only that task capability and never salary view or export', async () => {
    const { service, prisma } = fixture();
    prisma.payrollParameterRelease.findMany.mockResolvedValue([{ subjectId: 'subject', subject: { name: 'Fictional subject' },
      submittedBy: { payrollGrants: [{ subjectId: 'subject', capabilities: ['payroll_edit'] }] } }]);
    expect(await service.getAccess({ id: 'manager' })).toEqual({ enabled: true, subjects: [{ id: 'subject', name: 'Fictional subject', capabilities: ['payroll_parameter_review'] }] });
    const query = prisma.payrollParameterRelease.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ reviewerId: 'manager', submittedBy: { is: { directManagerId: 'manager' } } });
    expect(query.select).not.toHaveProperty('snapshot');
    await expect(service.assert(prisma, { id: 'manager' }, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    await expect(service.assert(prisma, { id: 'manager' }, 'subject', 'payroll_export')).rejects.toThrow(ForbiddenException);
    prisma.payrollParameterRelease.findMany.mockResolvedValue([{ subjectId: 'subject', subject: { name: 'Fictional subject' }, submittedBy: { payrollGrants: [] } }]);
    expect((await service.getAccess({ id: 'manager' })).subjects).toEqual([]);
  });
});

describe('formal payroll first-month acceptance', () => {
  const subjectId = '11111111-1111-4111-8111-111111111111';
  const otherSubject = '22222222-2222-4222-8222-222222222222';
  const signerId = '33333333-3333-4333-8333-333333333333';
  const requestId = '44444444-4444-4444-8444-444444444444';
  const actor = { id: 'operator', sysRole: 'employee' };
  const pending = { ready: false, reason: '正式发薪待首月签收' };
  const receipt = () => ({ subjectId, state: 'approved', firstMonth: '2026-11',
    reference: 'Fictional first-month acceptance', approvedAt: '2020-01-01T08:00:00+08:00', approvedById: signerId, requestId });
  function approvedRequest(): any {
    const reviewer = '55555555-5555-4555-8555-555555555555', submitter = '66666666-6666-4666-8666-666666666666';
    const row: any = { schema: 1, id: requestId, subjectId, batchId: '77777777-7777-4777-8777-777777777777',
      versionId: '88888888-8888-4888-8888-888888888888', calculationVersion: 1, version: 3, batchVersion: 4,
      month: '2026-10', firstMonth: '2026-11', sourceHash: 'a'.repeat(64), netHash: 'b'.repeat(64),
      reference: receipt().reference, status: 'approved', approvalStep: 2, approvalPath: [reviewer, signerId], reviewerCount: 1,
      submittedById: submitter, submittedAt: '2019-12-30T00:00:00Z', approvedAt: receipt().approvedAt,
      closedAt: null, closedById: null, closeNote: null,
      decisions: [{ step: 0, actorId: reviewer, decision: 'approve', note: '', decidedAt: '2019-12-31T00:00:00Z' },
        { step: 1, actorId: signerId, decision: 'approve', note: '', decidedAt: receipt().approvedAt }] };
    row.requestHash = payrollReadinessRequestHash(row);
    return row;
  }

  function fixture(values: Record<string, string | undefined> = { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true' }) {
    const accepted = approvedRequest();
    const prisma = {
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
      systemConfig: { findUnique: jest.fn(async ({ where }: any) => ({ value: where.key === `payroll_readiness_request:${requestId}` ? accepted : receipt() })) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: signerId }) },
      payrollGrant: { findMany: jest.fn().mockResolvedValue([
        { userId: actor.id, subjectId, capabilities: ['payroll_view'], revokedAt: null },
      ]) },
    } as any;
    const config = { get: jest.fn((key: string) => values[key]) };
    return { prisma, config, accepted, service: new PayrollAccessService(prisma, config as any) };
  }

  it('accepts only a subject receipt and the two existing server flags without a new global switch', async () => {
    const { service, prisma, config } = fixture();
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).resolves.toBeUndefined();
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2027-01')).resolves.toBeUndefined();
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith({ where: { key: `payroll_formal_readiness:${subjectId}` }, select: { value: true } });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: signerId }, select: { id: true } });
    expect(config.get.mock.calls.every(([key]) => ['PAYROLL_ENABLED', 'PAYROLL_FORMAL_ENABLED', 'HRM_PREVIEW'].includes(key))).toBe(true);
  });

  it('uses the caller transaction rather than the service connection', async () => {
    const { service, prisma } = fixture();
    const { prisma: tx } = fixture();
    delete tx.$transaction;
    tx.$queryRaw.mockResolvedValue([]);
    prisma.systemConfig.findUnique.mockRejectedValue(new Error('must use transaction'));
    await expect(service.assertFormalPayrollReady(tx, subjectId, '2026-11')).resolves.toBeUndefined();
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
    expect(tx.systemConfig.findUnique).toHaveBeenCalledTimes(2);
  });

  it('locks receipt then request rows before reading their facts inside the caller transaction', async () => {
    const { service, prisma } = fixture();
    const tx = { ...prisma }; delete tx.$transaction;
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray, key: string) => {
      expect(sql.join('?')).toMatch(/SELECT[\s\S]+FROM "system_configs"[\s\S]+FOR SHARE/);
      order.push(`lock:${key}`); return [];
    });
    const find = tx.systemConfig.findUnique.getMockImplementation()!;
    tx.systemConfig.findUnique.mockImplementation(async (input: any) => {
      order.push(`read:${input.where.key}`); return find(input);
    });
    await expect(service.assertFormalPayrollReady(tx, subjectId, '2026-11')).resolves.toBeUndefined();
    expect(order).toEqual([`lock:payroll_formal_readiness:${subjectId}`, `read:payroll_formal_readiness:${subjectId}`,
      `lock:payroll_readiness_request:${requestId}`, `read:payroll_readiness_request:${requestId}`]);
  });

  it('does not acquire row locks for a root-client precheck or readonly readiness metadata', async () => {
    const { service, prisma } = fixture();
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).resolves.toBeUndefined();
    expect(await service.readiness(subjectId, actor)).toEqual({ ready: true, firstMonth: '2026-11' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['receipt', { code: 'P2010', meta: { code: '40001', message: 'could not serialize access due to concurrent update' } }],
    ['request', { code: 'P2034' }],
    ['request', { code: '40001' }],
  ])('turns a stale Serializable %s row lock into a conflict instead of accepting an old receipt', async (row, error) => {
    const { service, prisma } = fixture();
    const tx = { ...prisma }; delete tx.$transaction;
    tx.$queryRaw.mockImplementation(async (_sql: TemplateStringsArray, key: string) => {
      if (key.startsWith(row === 'receipt' ? 'payroll_formal_readiness:' : 'payroll_readiness_request:')) throw error;
      return [];
    });
    await expect(service.assertFormalPayrollReady(tx, subjectId, '2026-11')).rejects.toThrow(ConflictException);
    expect(tx.user.findFirst).not.toHaveBeenCalled();
  });

  it('does not swallow unrelated row-lock failures', async () => {
    const { service, prisma } = fixture();
    const tx = { ...prisma }; delete tx.$transaction;
    tx.$queryRaw.mockRejectedValue(new Error('Connection unavailable'));
    await expect(service.assertFormalPayrollReady(tx, subjectId, '2026-11')).rejects.toThrow('Connection unavailable');
  });

  it('rejects a shape-correct receipt that has no completed request evidence', async () => {
    const { service, prisma } = fixture();
    prisma.systemConfig.findUnique.mockImplementation(async ({ where }: any) =>
      where.key.startsWith('payroll_readiness_request:') ? null : { value: receipt() });
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).rejects.toThrow(ConflictException);
    expect(await service.readiness(subjectId, actor)).toEqual(pending);
  });

  it.each(['subject', 'month', 'signer', 'approvedAt', 'pending', 'decisions', 'unknown'])('rejects mismatched or forged request evidence (%s)', async fault => {
    const { service, prisma, accepted } = fixture();
    if (fault === 'subject') accepted.subjectId = otherSubject;
    if (fault === 'month') accepted.firstMonth = '2026-12';
    if (fault === 'signer') { accepted.approvalPath[1] = otherSubject; accepted.decisions[1].actorId = otherSubject; }
    if (fault === 'approvedAt') { accepted.approvedAt = '2020-01-02T00:00:00Z'; accepted.decisions[1].decidedAt = accepted.approvedAt; }
    if (fault === 'pending') { accepted.status = 'pending'; accepted.approvalStep = 0; accepted.version = 1; accepted.decisions = []; accepted.approvedAt = null; }
    if (fault === 'decisions') accepted.decisions.pop();
    if (fault === 'unknown') accepted.bypass = true;
    accepted.requestHash = payrollReadinessRequestHash(accepted);
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).rejects.toThrow(ConflictException);
    expect(await service.readiness(subjectId, actor)).toEqual(pending);
  });

  it.each([
    {}, { PAYROLL_ENABLED: 'true' }, { PAYROLL_ENABLED: 'false', PAYROLL_FORMAL_ENABLED: 'true' },
    { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'false' },
    { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'true' },
  ])('does not let a receipt bypass disabled flags or preview (%j)', async values => {
    const { service, prisma } = fixture(values);
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).rejects.toThrow(ForbiddenException);
    await expect(service.readiness(subjectId, actor)).rejects.toThrow(ForbiddenException);
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });

  it('keeps preparation access and formal-domain reconciliation independent of missing acceptance', async () => {
    const { service, prisma } = fixture();
    prisma.systemConfig.findUnique.mockResolvedValue(null);
    await expect(service.assert(prisma, actor, subjectId, 'payroll_view')).resolves.toBeUndefined();
    await expect(service.assertDomain(prisma, 'formal')).resolves.toBe('formal');
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).rejects.toThrow(ConflictException);
    expect(await service.readiness(subjectId, actor)).toEqual(pending);
  });

  it.each([
    null, [], 'approved', {}, { ...receipt(), subjectId: otherSubject }, { ...receipt(), state: 'withdrawn' },
    { ...receipt(), firstMonth: '2026-13' }, { ...receipt(), firstMonth: '1999-12' },
    { ...receipt(), firstMonth: null }, { ...receipt(), reference: '' }, { ...receipt(), reference: '   ' },
    { ...receipt(), reference: 123 }, { ...receipt(), approvedById: 'not-a-user-id' },
    { ...receipt(), approvedAt: 'not-a-date' }, { ...receipt(), approvedAt: '2020-02-30T00:00:00Z' },
    { ...receipt(), approvedAt: '2099-01-01T00:00:00Z' }, { ...receipt(), approvedAt: null },
  ])('fails closed on an incomplete or invalid acceptance (%j)', async value => {
    const { service, prisma } = fixture();
    prisma.systemConfig.findUnique.mockResolvedValue({ value });
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).rejects.toThrow(ConflictException);
    expect(await service.readiness(subjectId, actor)).toEqual(pending);
  });

  it.each(['2026-10', '2026-00', '2026-13', '26-11', '', undefined])('rejects an earlier or invalid requested month (%s)', async month => {
    const { service, prisma } = fixture();
    await expect(service.assertFormalPayrollReady(prisma, subjectId, month as string)).rejects.toThrow(ConflictException);
  });

  it('does not reuse another subject receipt or query configuration for an invalid subject', async () => {
    const { service, prisma } = fixture();
    await expect(service.assertFormalPayrollReady(prisma, otherSubject, '2026-11')).rejects.toThrow(ConflictException);
    expect(prisma.systemConfig.findUnique).toHaveBeenLastCalledWith({ where: { key: `payroll_formal_readiness:${otherSubject}` }, select: { value: true } });
    prisma.systemConfig.findUnique.mockClear();
    await expect(service.assertFormalPayrollReady(prisma, 'not-a-subject', '2026-11')).rejects.toThrow(ConflictException);
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });

  it('preserves historical acceptance after the signer leaves or changes eligibility', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      Object.keys(where).some(key => key !== 'id') ? null : { id: signerId });
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).resolves.toBeUndefined();
    expect(await service.readiness(subjectId, actor)).toEqual({ ready: true, firstMonth: '2026-11' });
  });

  it('rechecks explicit receipt withdrawal and signer existence without caching', async () => {
    const { service, prisma } = fixture();
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).resolves.toBeUndefined();
    prisma.systemConfig.findUnique.mockResolvedValue({ value: { ...receipt(), state: 'withdrawn' } });
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).rejects.toThrow(ConflictException);
    prisma.systemConfig.findUnique.mockResolvedValue({ value: receipt() });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).rejects.toThrow(ConflictException);
    expect(await service.readiness(subjectId, actor)).toEqual(pending);
  });

  it.each(['payroll_edit', 'payroll_view', 'payroll_review', 'payroll_approve'])('allows only minimal metadata to a live %s subject grantee', async capability => {
    const { service, prisma } = fixture();
    prisma.payrollGrant.findMany.mockResolvedValue([{ userId: actor.id, subjectId, capabilities: [capability], revokedAt: null }]);
    expect(await service.readiness(subjectId, actor)).toEqual({ ready: true, firstMonth: '2026-11' });
    expect(prisma.payrollGrant.findMany).toHaveBeenCalledWith({ where: { userId: actor.id, subjectId, revokedAt: null,
      user: { status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null, isAssessorOnly: false } } });
  });

  it.each(['payroll_export', 'payroll_settle', 'payroll_parameter_review', 'attendance_edit'])('does not disclose readiness to %s alone', async capability => {
    const { service, prisma } = fixture();
    prisma.payrollGrant.findMany.mockResolvedValue([{ userId: actor.id, subjectId, capabilities: [capability], revokedAt: null }]);
    await expect(service.readiness(subjectId, actor)).rejects.toThrow(ForbiddenException);
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });

  it.each(['system_admin', 'hr'])('does not treat %s or parameter approval as acceptance authority', async sysRole => {
    const { service, prisma } = fixture();
    prisma.payrollGrant.findMany.mockResolvedValue([]);
    await expect(service.readiness(subjectId, { ...actor, sysRole })).rejects.toThrow(ForbiddenException);
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    { subjectId: otherSubject }, { userId: 'someone-else' }, { revokedAt: new Date() },
  ])('does not accept a foreign or revoked grant (%j)', async change => {
    const { service, prisma } = fixture();
    prisma.payrollGrant.findMany.mockResolvedValue([{ userId: actor.id, subjectId, capabilities: ['payroll_view'], revokedAt: null, ...change }]);
    await expect(service.readiness(subjectId, actor)).rejects.toThrow(ForbiddenException);
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });

  it('rejects assessor-only callers and rereads revoked metadata grants', async () => {
    const { service, prisma } = fixture();
    await expect(service.readiness(subjectId, { ...actor, isAssessorOnly: true })).rejects.toThrow(ForbiddenException);
    expect(await service.readiness(subjectId, actor)).toEqual({ ready: true, firstMonth: '2026-11' });
    prisma.payrollGrant.findMany.mockResolvedValue([]);
    prisma.systemConfig.findUnique.mockClear();
    await expect(service.readiness(subjectId, actor)).rejects.toThrow(ForbiddenException);
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });

  it('does not swallow database failures as an accepted receipt', async () => {
    const { service, prisma } = fixture();
    prisma.systemConfig.findUnique.mockRejectedValue(new Error('unavailable'));
    await expect(service.assertFormalPayrollReady(prisma, subjectId, '2026-11')).rejects.toThrow('unavailable');
    await expect(service.readiness(subjectId, actor)).rejects.toThrow('unavailable');
  });
});
