import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollParameterReleasesService } from './payroll-parameter-releases.service';
import { PayrollAccessService } from './payroll-access.service';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { payrollHash } from './payroll-transaction';
import { payrollCalendarDays } from './payroll-work-calendar';
import { normalizePayrollPolicy } from './payroll-policy';
import { randomUUID } from 'node:crypto';

const hr = { id: 'hr' } as any, manager = { id: 'manager' } as any;
const date = (value: string) => new Date(`${value}T00:00:00Z`);
function fixture() {
  const rows: any[] = [{ id: 'old', subjectId: 'subject', domain: 'validation', employeeId: 'employee', version: 1,
    effectiveFrom: date('2036-01-01'), effectiveTo: null, status: 'active', activatedAt: date('2036-01-01'),
    fixedMonthly: new Prisma.Decimal('10000'), performanceBase: null, performanceMode: 'none', evidence: 'Fictional approval', createdById: 'hr' }];
  rows.push({ ...rows[0], id: 'new', version: 2, effectiveFrom: date('2036-12-01'), status: 'draft', activatedAt: null, fixedMonthly: new Prisma.Decimal('12000') });
  const requests: any[] = [], events: any[] = [];
  const state = { managerId: 'manager' as string | null, eligible: true, editorEnabled: true };
  const model = {
    findUnique: jest.fn(async ({ where, select }) => {
      const row = rows.find(value => value.id === where.id);
      return !row ? null : select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : { ...row };
    }),
    findFirst: jest.fn(async (_args: any = {}) => rows.filter(row => row.status === 'active').sort((a, b) => b.version - a.version)[0] ?? null),
    update: jest.fn(async ({ where, data }) => { const row = rows.find(value => value.id === where.id); Object.assign(row, data); return { ...row }; }),
  };
  const releases = {
    findFirst: jest.fn(async ({ where }) => requests.filter(row => (!where.standardId || row.standardId === where.standardId)
      && (!where.subjectId || row.subjectId === where.subjectId) && (!where.reviewerId || row.reviewerId === where.reviewerId)).at(-1) ?? null),
    findUnique: jest.fn(async ({ where, select }) => {
      const row = requests.find(value => value.id === where.id);
      return !row ? null : select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : { ...row };
    }),
    findMany: jest.fn(async ({ where }: any) => requests.filter(row => typeof where.status === 'string' ? row.status === where.status : row.status !== where.status?.not).map(row => ({ ...row }))),
    create: jest.fn(async ({ data }) => { const row = { id: `request-${requests.length}`, status: 'pending', ...data }; requests.push(row); return { ...row }; }),
    update: jest.fn(async ({ where, data }) => { const row = requests.find(value => value.id === where.id); Object.assign(row, data); return { ...row }; }),
  };
  const tx: any = { $queryRaw: jest.fn(async () => []), payrollStandard: model, payrollPolicy: model, payrollParameterRelease: releases,
    user: { findFirst: jest.fn(async ({ where }) => where.id === 'hr' && state.eligible ? { directManagerId: state.managerId }
      : ['manager', 'new-manager'].includes(where.id) && state.eligible ? { id: where.id } : null) },
    payrollEvent: { create: jest.fn(async ({ data }) => { events.push(data); return data; }) } };
  const prisma: any = { ...tx, $transaction: jest.fn(async work => work(tx)) };
  const access = { maintenancePurpose: jest.fn(() => 'validation'), assertDomain: jest.fn(async (_tx: any, _purpose: string) => 'validation'), assert: jest.fn(async (_tx, actor, subject, capability) => {
    if (!state.editorEnabled || actor.id !== 'hr' || subject !== 'subject' || capability !== 'payroll_edit') throw new ForbiddenException();
  }) };
  const service = new PayrollParameterReleasesService(prisma, access as any);
  const submit = () => service.submit('standard', 'new', 2, hr);
  const decide = (id: string, patch: any = {}, actor: any = manager) => service.decide(id, { expectedVersion: 1, decision: 'approve', note: '', ...patch }, actor);
  return { rows, requests, events, state, tx, prisma, model, releases, access, service, submit, decide };
}

function formalRuleSetup() {
  const s = fixture(), person = randomUUID(), month = '2036-11';
  s.rows.length = 0;
  const row: any = { id: 'formal-rule', subjectId: 'subject', domain: 'formal', version: 1, status: 'draft', createdById: 'hr',
    effectiveFrom: date('2036-11-01'), effectiveTo: null, config: normalizePayrollPolicy({ employeeScope: { employeeIds: [person], evidenceRef: 'Fictional payer decision' },
      fixedSalaryBasis: 'monthly_workdays', rounding: 'item_half_up', cutoverMonth: month,
      workCalendars: { [month]: { sourceVersion: 'fictional-v1', evidenceRef: 'Fictional calendar', days: payrollCalendarDays(month).map(workDate => ({ workDate, units: '1' })) } } }) };
  s.rows.push(row); s.access.assertDomain.mockResolvedValue('formal');
  s.model.findFirst.mockImplementation(async ({ where }: any) => s.rows.find(row => row.status === 'active' && row.subjectId === where.subjectId && row.domain === where.domain) ?? null);
  Object.assign(s.model, { findMany: jest.fn(async ({ where }: any) => s.rows.filter(row => row.status === 'active' && row.domain === where.domain && (!where.subjectId || row.subjectId === where.subjectId))) });
  const employments: any[] = [{ id: 'employment', userId: person, effectiveFrom: date('2036-11-01'), effectiveTo: null, entryDate: date('2036-11-01'), leaveDate: null, employeeStatus: 'active', user: { id: person, name: 'Fictional', employeeNo: 'FICT' } }];
  s.tx.employmentRecord = { findMany: jest.fn(async () => employments) };
  return { ...s, row, person, employments, submitRule: () => s.service.submit('rule', row.id, 1, hr) };
}

describe('payroll parameters require the submitting HR direct manager', () => {
  it.each(['submit', 'decide', 'withdraw'])('fences %s only after subject locking and before parameter changes', async operation => {
    const s = fixture(), request = operation === 'submit' ? null : await s.submit();
    s.tx.$queryRaw.mockClear(); const statuses = s.rows.map(row => row.status), count = s.events.length;
    s.tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
      if (sql.join('').includes('FOR SHARE')) throw { code: 'P2010', meta: { code: '40001' } };
      return [];
    });
    const action = operation === 'submit' ? s.submit() : operation === 'decide' ? s.decide(request!.id)
      : s.service.withdraw(request!.id, { expectedVersion: 1, note: 'Fictional' }, hr);
    await expect(action).rejects.toThrow(ConflictException);
    const queries = s.tx.$queryRaw.mock.calls.map(call => call[0].join(''));
    expect(queries).toHaveLength(2); expect(queries[0]).toContain('pg_advisory_xact_lock'); expect(queries[1]).toContain('FOR SHARE');
    expect(s.rows.map(row => row.status)).toEqual(statuses); expect(s.events).toHaveLength(count);
    expect(s.access.assert.mock.invocationCallOrder[0]).toBeLessThan(s.tx.$queryRaw.mock.invocationCallOrder[0]);
  });
  it('requires an explicit formal payer scope at submission rather than approving a contract-derived default', async () => {
    const s = formalRuleSetup(); delete s.row.config.employeeScope;
    await expect(s.submitRule()).rejects.toThrow(ConflictException); expect(s.requests).toHaveLength(0);
  });
  it('does not submit a selected conflicting employment even when the caller bypasses the disabled candidate', async () => {
    const s = formalRuleSetup(); s.employments.push({ ...s.employments[0], id: 'overlap' });
    await expect(s.submitRule()).rejects.toThrow(ConflictException);
    expect(s.requests).toHaveLength(0); expect(s.events).toHaveLength(0); expect(s.row.status).toBe('draft');
  });
  it('rechecks selected employment conflicts at approval without publishing or silently dropping the person', async () => {
    const s = formalRuleSetup(), request = await s.submitRule(); s.employments.push({ ...s.employments[0], id: 'overlap' });
    await expect(s.decide(request.id)).rejects.toThrow(ConflictException);
    expect(s.row.status).toBe('pending'); expect(s.requests[0].status).toBe('pending');
    expect(s.events.some(row => row.action === 'parameter_published')).toBe(false);
  });
  it('rejects selected people without an employment in the effective calendar rather than publishing an empty payer scope', async () => {
    const s = formalRuleSetup(); s.employments[0].effectiveFrom = date('2037-01-01');
    await expect(s.submitRule()).rejects.toThrow(ConflictException); expect(s.requests).toHaveLength(0);
  });
  it('checks the rule effective interval without letting an earlier overlap block a later valid assignment', async () => {
    const s = formalRuleSetup(); s.row.effectiveFrom = date('2036-11-15');
    s.employments.push({ ...s.employments[0], id: 'earlier-overlap', effectiveTo: date('2036-11-14') });
    const request = await s.submitRule();
    expect((await s.decide(request.id)).status).toBe('approved');
  });
  it('rejects a cross-subject employee overlap at publication under a shared lock and Serializable transaction', async () => {
    const s = formalRuleSetup(), request = await s.submitRule();
    const other = { ...s.row, id: 'other-rule', subjectId: 'other', status: 'active' };
    s.rows.push(other); s.requests.push({ id: 'other-release', subjectId: 'other', domain: 'formal', kind: 'rule', status: 'approved', ruleId: other.id,
      previousParameterId: null, parameterVersion: 1, snapshotHash: payrollHash(payrollParameterDefinition('rule', other)) });
    s.tx.$queryRaw.mockClear();
    await expect(s.decide(request.id)).rejects.toThrow(ConflictException);
    expect(s.row.status).toBe('pending'); expect(s.events.some(row => row.action === 'parameter_published')).toBe(false);
    expect(s.tx.$queryRaw.mock.calls.filter(call => call[0].join('').includes('pg_advisory_xact_lock')).map(call => call[1]))
      .toEqual(['payroll:formal:employee-scope-publication', 'payroll:formal:subject']);
    expect(s.tx.$queryRaw.mock.calls.slice(2).map(call => call[0].join(''))).toEqual([
      expect.stringContaining('FROM "users"'), expect.stringContaining('FROM "payroll_grants"'),
    ]);
    expect((s.prisma.$transaction.mock.calls.at(-1) as any[])[1].isolationLevel).toBe('Serializable');
  });
  it('publishes an explicit payer scope and keeps it frozen in the manager-reviewed snapshot', async () => {
    const s = formalRuleSetup(), request = await s.submitRule(), frozen = JSON.stringify(request.snapshot);
    expect((await s.decide(request.id)).status).toBe('approved'); expect(s.row.status).toBe('active');
    expect(JSON.stringify(request.snapshot)).toBe(frozen);
    expect((request.snapshot as any).config.employeeScope.employeeIds).toEqual([s.person]);
  });
  it('freezes a reviewed successor and leaves the original definition unchanged', async () => {
    const s = fixture(), original = payrollParameterDefinition('standard', s.rows[0]);
    const request = await s.submit();
    expect(request).toMatchObject({ reviewerId: 'manager', submittedById: 'hr', previousParameterId: 'old', status: 'pending' });
    expect(s.rows[1].status).toBe('pending'); expect(s.rows[0].status).toBe('active');
    expect((await s.decide(request.id)).status).toBe('approved');
    expect(s.rows[1].status).toBe('active');
    expect(payrollParameterDefinition('standard', s.rows[0])).toEqual(original);
    await expect(s.decide(request.id)).rejects.toThrow(ConflictException);
    expect(s.events.filter(row => row.action === 'parameter_published')).toHaveLength(1);
  });
  it.each([null, 'hr', 'inactive'])('does not invent a reviewer for manager=%s', async value => {
    const s = fixture(); s.state.managerId = value;
    await expect(s.submit()).rejects.toThrow(ConflictException); expect(s.requests).toEqual([]);
  });
  it('rejects the submitter and an unrelated administrator before reading the parameter snapshot', async () => {
    const s = fixture(), row = await s.submit(); s.model.findUnique.mockClear();
    for (const actor of [hr, { id: 'administrator', sysRole: 'system_admin' }]) await expect(s.decide(row.id, {}, actor)).rejects.toThrow(ForbiddenException);
    expect(s.model.findUnique).not.toHaveBeenCalled();
    expect(s.releases.findUnique.mock.calls.every(([args]) => Boolean(args.select))).toBe(true);
  });
  it('blocks a changed reporting relationship or revoked HR authority', async () => {
    const s = fixture(), row = await s.submit(); s.state.managerId = 'new-manager';
    await expect(s.decide(row.id)).rejects.toThrow(ForbiddenException);
    s.state.managerId = 'manager'; s.state.editorEnabled = false;
    await expect(s.decide(row.id)).rejects.toThrow(ForbiddenException); expect(s.rows[1].status).toBe('pending');
  });
  it('supports return, resubmission and withdrawal while retaining every attempt', async () => {
    const s = fixture(), first = await s.submit();
    await expect(s.decide(first.id, { decision: 'return', note: '' })).rejects.toThrow();
    await s.decide(first.id, { decision: 'return', note: 'Fictional return reason' });
    const second = await s.submit(); expect(second.attempt).toBe(2);
    await s.service.withdraw(second.id, { expectedVersion: 2, note: 'Fictional withdrawal' }, hr);
    expect(s.rows[1].status).toBe('draft'); expect(s.requests.map(row => row.status)).toEqual(['returned', 'withdrawn']);
    await expect(s.decide(second.id, { expectedVersion: 2 })).rejects.toThrow(ConflictException);
  });
  it('does not publish a changed snapshot or a draft based on an obsolete predecessor', async () => {
    const s = fixture(), row = await s.submit(); s.rows[1].fixedMonthly = new Prisma.Decimal('13000');
    await expect(s.decide(row.id)).rejects.toThrow(ConflictException);
    s.rows[1].fixedMonthly = new Prisma.Decimal('12000'); s.rows[0].evidence = 'Changed predecessor evidence';
    await expect(s.decide(row.id)).rejects.toThrow(ConflictException); expect(s.rows[1].status).toBe('pending');
  });
  it('rejects another HR draft, stale request versions and backward timeline insertion', async () => {
    const s = fixture(); s.rows[1].createdById = 'someone-else';
    await expect(s.submit()).rejects.toThrow(ForbiddenException);
    s.rows[1].createdById = 'hr'; s.rows[1].effectiveFrom = date('2035-12-01');
    await expect(s.submit()).rejects.toThrow(ConflictException);
    s.rows[1].effectiveFrom = date('2036-12-01'); const row = await s.submit();
    await expect(s.decide(row.id, { expectedVersion: 0 })).rejects.toThrow(ConflictException);
  });
  it('does not grant a supervisor the complete standard list or unassigned snapshots', async () => {
    const s = fixture();
    await expect(s.service.list('subject', { id: 'manager' } as any)).rejects.toThrow(ForbiddenException);
    expect(s.releases.findMany).not.toHaveBeenCalled();
    await s.submit(); await s.service.list('subject', manager);
    const query = s.releases.findMany.mock.calls.at(-1)![0];
    expect(query.where).toMatchObject({ subjectId: 'subject', reviewerId: 'manager', submittedBy: { is: { directManagerId: 'manager' } } });
  });

  it('keeps every assigned pending request visible even when there are more than one hundred', async () => {
    const s = fixture(), first = await s.submit();
    for (let i = 1; i < 150; i++) s.requests.push({ ...first, id: `pending-${i}`, status: 'pending' });
    const result = await s.service.list('subject', manager);
    expect(result.filter(row => row.status === 'pending')).toHaveLength(150);
    expect(s.releases.findMany.mock.calls).toContainEqual([expect.objectContaining({ where: expect.objectContaining({ status: 'pending' }) })]);
    expect(s.releases.findMany.mock.calls.find(([input]) => input.where.status === 'pending')?.[0].take).toBeUndefined();
  });
  it('shows names only for payer scope identities in this assigned parameter snapshot', async () => {
    const s = fixture(), request = await s.submit();
    Object.assign(s.requests[0], { kind: 'rule', snapshot: { config: { employeeScope: { employeeIds: ['scope-employee'], evidenceRef: 'Fictional payer confirmation' }, performance: {} } } });
    s.tx.user.findMany = jest.fn(async () => [{ id: 'scope-employee', name: 'Fictional scoped employee', employeeNo: 'SCOPED' }, { id: 'unrelated', name: 'Must not be returned', employeeNo: 'OTHER' }]);
    const result = await s.service.list('subject', manager) as any[];
    expect(result.find(row => row.id === request.id).scopeEmployees).toEqual([{ id: 'scope-employee', name: 'Fictional scoped employee', employeeNo: 'SCOPED' }]);
    expect(s.tx.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['scope-employee'] } }, select: { id: true, name: true, employeeNo: true } });
  });
  it('uses the server-selected formal domain for both reviewer qualification and list queries', async () => {
    const s = fixture(); await s.submit();
    s.access.maintenancePurpose.mockReturnValue('formal'); s.access.assertDomain.mockResolvedValue('formal');
    await s.service.list('subject', manager);
    expect(s.access.assertDomain.mock.calls.at(-1)?.[1]).toBe('formal');
    expect(s.releases.findFirst.mock.calls.at(-1)?.[0].where.domain).toBe('formal');
    expect(s.releases.findMany.mock.calls.every(([input]) => input.where.domain === 'formal')).toBe(true);
  });
  it('does not expose assigned review snapshots when only the formal switch is on', async () => {
    const s = fixture(); await s.submit(); s.releases.findMany.mockClear();
    const access = new PayrollAccessService(s.tx, { get: (key: string) => key === 'PAYROLL_FORMAL_ENABLED' ? 'true' : 'false' } as any);
    const service = new PayrollParameterReleasesService({ $transaction: work => work(s.tx) } as any, access);
    await expect(service.list('subject', manager)).rejects.toThrow(ForbiddenException);
    expect(s.releases.findMany).not.toHaveBeenCalled();
  });
});
