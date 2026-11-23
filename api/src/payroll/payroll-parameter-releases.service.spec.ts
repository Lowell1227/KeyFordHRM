import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollParameterReleasesService } from './payroll-parameter-releases.service';
import { payrollParameterDefinition } from './payroll-parameter-definition';

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
    findFirst: jest.fn(async () => rows.filter(row => row.status === 'active').sort((a, b) => b.version - a.version)[0] ?? null),
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
  const access = { assertDomain: jest.fn(async () => 'validation'), assert: jest.fn(async (_tx, actor, subject, capability) => {
    if (!state.editorEnabled || actor.id !== 'hr' || subject !== 'subject' || capability !== 'payroll_edit') throw new ForbiddenException();
  }) };
  const service = new PayrollParameterReleasesService(prisma, access as any);
  const submit = () => service.submit('standard', 'new', 2, hr);
  const decide = (id: string, patch: any = {}, actor: any = manager) => service.decide(id, { expectedVersion: 1, decision: 'approve', note: '', ...patch }, actor);
  return { rows, requests, events, state, tx, model, releases, access, service, submit, decide };
}

describe('payroll parameters require the submitting HR direct manager', () => {
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
});
