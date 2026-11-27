import { SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { WorkbenchService } from './workbench.service';

jest.mock('./performance-operations.service', () => ({ PerformanceOperationsService: class {} }));

const actor: AuthUser = { id: 'viewer', name: 'Fictional viewer', sysRole: SysRole.employee,
  deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: [] };
const subject = (capabilities: string[], id = 'subject') => ({ id, name: 'Fictional subject', capabilities });
const batch = (id: string, overrides: Record<string, unknown> = {}, version: Record<string, unknown> = {}) => ({
  id, subjectId: 'subject', month: '2037-01', purpose: 'formal', status: 'pending', createdById: 'maker',
  versions: [{ status: 'pending', approvalStep: 0, reviewerCount: 1, approvalPath: ['viewer', 'approver'],
    submittedById: 'maker', calculatedById: 'maker', voidedAt: null, ...version }], ...overrides,
});

function setup(subjects = [subject(['payroll_review'])], viewer = actor) {
  const prisma = {
    payrollBatch: { findMany: jest.fn().mockResolvedValue([]) },
    payrollParameterRelease: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const access = { getAccess: jest.fn().mockResolvedValue({ enabled: true, subjects }),
    maintenancePurpose: jest.fn().mockReturnValue('formal'), assertDomain: jest.fn().mockResolvedValue('formal') };
  const reviews = { findAll: jest.fn().mockResolvedValue({ total: 0, items: [] }) };
  const digest = { list: jest.fn().mockResolvedValue({ items: [] }) };
  const parameters = { list: jest.fn().mockResolvedValue([]) };
  const readiness = { list: jest.fn().mockResolvedValue([]) };
  const performance = { read: jest.fn().mockResolvedValue({ visible: true, actionable: [], attention: [] }) };
  const service = new WorkbenchService(prisma as never, access as never, reviews as never,
    digest as never, parameters as never, readiness as never, performance as never);
  const get = (page = 1, pageSize = 5) => service.operations(viewer, { page, pageSize });
  return { prisma, access, reviews, digest, parameters, readiness, get };
}

describe('operations workbench scoped projection (pure)', () => {
  it('gives no implicit wage access to an administrator or all-data viewer', async () => {
    const f = setup([], { ...actor, sysRole: SysRole.system_admin, canViewAll: true });
    const result = await f.get();
    expect(result.groups.payroll.actionable.total).toBe(0);
    expect(result.groups.payroll.attention.total).toBe(0);
    expect(result.groups.payroll.visible).toBe(false);
    expect(f.prisma.payrollBatch.findMany).not.toHaveBeenCalled();
    expect(f.parameters.list).not.toHaveBeenCalled();
    expect(f.readiness.list).not.toHaveBeenCalled();
  });

  it('rejects ungranted subjects even if a repository returns extra rows', async () => {
    const f = setup();
    f.prisma.payrollBatch.findMany.mockResolvedValue([batch('other', { subjectId: 'ungranted' }), batch('mine')]);
    const result = await f.get();
    expect(result.groups.payroll.actionable.items.map(row => row.batchId)).toEqual(['mine']);
    expect(f.prisma.payrollBatch.findMany.mock.calls[0][0].where.subjectId).toBe('subject');
    expect(f.readiness.list).toHaveBeenCalledWith('subject', actor);
  });

  it('counts only the frozen current step with matching stage capability, never self-review', async () => {
    const f = setup();
    f.prisma.payrollBatch.findMany.mockResolvedValue([
      batch('current'), batch('future', {}, { approvalPath: ['other', 'viewer'] }),
      batch('approval-not-review', {}, { approvalStep: 1, approvalPath: ['other', 'viewer'] }),
      batch('self', {}, { submittedById: 'viewer', approvalPath: ['viewer', 'approver'] }),
      batch('reconciliation', { purpose: 'reconciliation' }), batch('trial', { purpose: 'trial' }),
      batch('voided', {}, { voidedAt: new Date() }), batch('old-version', {}, { status: 'returned' }),
    ]);
    const result = await f.get();
    expect(result.groups.payroll.actionable.items.map(row => row.batchId)).toEqual(['current']);
    expect(result.groups.payroll.attention.total).toBe(0);
    expect(result.groups.payroll.actionable.items[0].path).toBe('/payroll/approvals/current?subjectId=subject&month=2037-01');
  });

  it('keeps reviewer and final approver stages distinct', async () => {
    const f = setup([subject(['payroll_approve'])]);
    f.prisma.payrollBatch.findMany.mockResolvedValue([
      batch('wrong-stage'), batch('final', {}, { approvalStep: 1, approvalPath: ['other', 'viewer'] }),
    ]);
    expect((await f.get()).groups.payroll.actionable.items.map(row => row.batchId)).toEqual(['final']);
  });

  it('returns authoritative totals beyond the page size, not total visible batches', async () => {
    const f = setup();
    f.prisma.payrollBatch.findMany.mockResolvedValue([
      ...Array.from({ length: 27 }, (_, i) => batch(`batch-${String(i).padStart(2, '0')}`)),
      ...Array.from({ length: 13 }, (_, i) => batch(`not-mine-${i}`, {}, { approvalPath: ['other', 'approver'] })),
    ]);
    const first = (await f.get()).groups.payroll.actionable;
    expect(first).toMatchObject({ total: 27, page: 1, pageSize: 5, hasMore: true });
    expect(first.items).toHaveLength(5);
    expect((await f.get()).groups.payroll.counts).toEqual({ payroll_approval: { actionable: 27, attention: 0 } });
    const last = (await f.get(6)).groups.payroll.actionable;
    expect(last).toMatchObject({ total: 27, hasMore: false });
    expect(last.items).toHaveLength(2);
  });

  it('separates a submitter waiting on others from actionable review work', async () => {
    const f = setup([subject(['payroll_edit', 'payroll_view'])]);
    f.prisma.payrollBatch.findMany.mockResolvedValue([
      batch('waiting', {}, { submittedById: 'viewer', approvalPath: ['reviewer', 'approver'] }),
      batch('unrelated'), batch('returned', { status: 'returned' }, { status: 'returned', submittedById: 'viewer' }),
    ]);
    const result = (await f.get()).groups.payroll;
    expect(result.actionable.items.map(row => row.batchId)).toEqual(['returned']);
    expect(result.attention.items.map(row => row.batchId)).toEqual(['waiting']);
  });

  it('only lists live independent parameter assignments, never own or stale-manager reviews', async () => {
    const f = setup([subject(['payroll_edit', 'payroll_parameter_review'])]);
    f.parameters.list.mockResolvedValue([
      { id: 'assigned', subjectId: 'subject', domain: 'formal', status: 'pending', kind: 'rule', reviewerId: 'viewer', submittedById: 'maker' },
      { id: 'stale', subjectId: 'subject', domain: 'formal', status: 'pending', kind: 'rule', reviewerId: 'viewer', submittedById: 'former-report' },
      { id: 'self', subjectId: 'subject', domain: 'formal', status: 'pending', kind: 'rule', reviewerId: 'viewer', submittedById: 'viewer' },
      { id: 'other', subjectId: 'other', domain: 'formal', status: 'pending', kind: 'rule', reviewerId: 'viewer', submittedById: 'maker' },
    ]);
    f.prisma.payrollParameterRelease.findMany.mockResolvedValue([{ id: 'assigned' }, { id: 'self' }]);
    const result = (await f.get()).groups.payroll;
    expect(result.actionable.items.map(row => row.requestId)).toEqual(['assigned']);
    expect(result.actionable.items[0].path).toBe('/payroll/parameter-reviews?subjectId=subject&releaseId=assigned');
    const where = f.prisma.payrollParameterRelease.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ reviewerId: 'viewer', subjectId: 'subject', domain: 'formal', status: 'pending',
      submittedBy: { is: { directManagerId: 'viewer', payrollGrants: { some: { subjectId: 'subject', revokedAt: null, capabilities: { has: 'payroll_edit' } } } } } });
  });

  it('projects readiness current-step assignments without reading monetary detail', async () => {
    const f = setup();
    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    f.readiness.list.mockResolvedValue([
      { id: requestId, subjectId: 'subject', batchId: 'source', month: '2037-01', status: 'pending',
        approvalStep: 0, reviewerCount: 1, approvalPath: ['viewer', 'approver'], submittedById: 'maker' },
      { id: 'future', subjectId: 'subject', batchId: 'source', month: '2037-01', status: 'pending',
        approvalStep: 1, reviewerCount: 1, approvalPath: ['viewer', 'approver'], submittedById: 'maker' },
      { id: 'self', subjectId: 'subject', batchId: 'source', month: '2037-01', status: 'pending',
        approvalStep: 0, reviewerCount: 1, approvalPath: ['viewer', 'approver'], submittedById: 'viewer' },
    ]);
    const result = (await f.get()).groups.payroll;
    expect(result.actionable.items.map(row => row.requestId)).toEqual([requestId]);
    expect(result.actionable.items[0].path).toBe(`/payroll/approvals?subjectId=subject&month=2037-01&readiness=${requestId}`);
  });

  it('does not query wage data for a parameter-only manager', async () => {
    const f = setup([subject(['payroll_parameter_review'])]);
    await f.get();
    expect(f.parameters.list).toHaveBeenCalledWith('subject', actor);
    expect(f.prisma.payrollBatch.findMany).not.toHaveBeenCalled();
    expect(f.readiness.list).not.toHaveBeenCalled();
  });

  it('does not invoke personnel APIs without their original capability', async () => {
    const f = setup();
    await f.get();
    expect(f.reviews.findAll).not.toHaveBeenCalled();
    expect(f.digest.list).not.toHaveBeenCalled();
    expect((await f.get()).groups.personnel.visible).toBe(false);
  });

  it('enumerates personnel pending pages before filtering and counting', async () => {
    const f = setup([], { ...actor, sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_review'] });
    const rows = Array.from({ length: 113 }, (_, i) => ({ id: `request-${i}`, employeeName: 'Fictional employee',
      recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      sourceSystem: null, cancelledAt: null, archivedAt: null }));
    f.reviews.findAll.mockImplementation(async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length,
    }));
    const result = (await f.get()).groups.personnel;
    expect(result.actionable.total).toBe(113);
    expect(result.visible).toBe(true);
    expect(result.actionable.items).toHaveLength(5);
    expect(f.reviews.findAll).toHaveBeenCalledTimes(2);
    expect(result.actionable.items[0].path).toContain('/entry-exit?tab=reviews&requestId=');
  });

  it('keeps passive personnel reminders separate and requires review capability for arrival', async () => {
    const f = setup([], { ...actor, sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_edit'] });
    f.digest.list.mockResolvedValue({ items: [
      { id: 'arrive', kind: 'arrival', employee: 'Fictional A', due: '2037-01-02', next: 'Check arrival', link: '/entry-exit?tab=arrivals&requestId=arrive' },
      { id: 'return', kind: 'returned', employee: 'Fictional B', due: null, next: 'Correct request', link: '/entry-exit?requestId=return' },
      { id: 'contract', kind: 'contract', employee: 'Fictional C', due: '2037-02-01', next: 'Check contract', link: '/users?employeeId=contract' },
    ] });
    const result = (await f.get()).groups.personnel;
    expect(result.actionable.items.map(row => row.id)).toEqual(['personnel:returned:return']);
    expect(result.attention.total).toBe(2);
    expect(f.reviews.findAll).not.toHaveBeenCalled();
  });

  it('reports a failing group as unknown without losing the independent group or leaking errors', async () => {
    const f = setup([], { ...actor, sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_edit'] });
    f.digest.list.mockRejectedValue(new Error('private database detail'));
    const result = await f.get();
    expect(result.groups.personnel).toMatchObject({ status: 'error', actionable: { total: null, items: [] }, attention: { total: null } });
    expect(result.groups.payroll.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('private database detail');
  });

  it('only returns whitelisted summary metadata and rejects unsafe source paths', async () => {
    const f = setup([subject(['payroll_edit'])]);
    f.prisma.payrollBatch.findMany.mockResolvedValue([batch('batch/?&', {}, { submittedById: 'viewer',
      approvalPath: ['other', 'approver'], gross: '123456.78', netSnapshot: { secret: 'hidden' }, issues: ['salary secret'] })]);
    const result = await f.get();
    const item = result.groups.payroll.attention.items[0];
    expect(item.path).toBe('/payroll/batches/batch%2F%3F%26?subjectId=subject&month=2037-01');
    expect(JSON.stringify(result)).not.toMatch(/123456|netSnapshot|salary secret/);
    expect(f.prisma.payrollBatch.findMany.mock.calls[0][0].select.versions.select).not.toHaveProperty('gross');
  });

  it('keeps authorized empty groups visible rather than deriving access from a zero count', async () => {
    const f = setup([subject(['payroll_view'])], { ...actor, sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_edit'] });
    const result = await f.get();
    expect(result.groups.personnel).toMatchObject({ visible: true, status: 'ready', actionable: { total: 0 } });
    expect(result.groups.payroll).toMatchObject({ visible: true, status: 'ready', actionable: { total: 0 } });
  });

  it('returns unknown instead of a false personnel total if the source changes during pagination', async () => {
    const f = setup([], { ...actor, sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_review'] });
    f.reviews.findAll.mockResolvedValueOnce({ total: 101, items: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })) })
      .mockResolvedValueOnce({ total: 100, items: [] });
    expect((await f.get()).groups.personnel).toMatchObject({ status: 'error', actionable: { total: null } });
  });

  it('does not refresh, write, or recapture sources while projecting original readers', async () => {
    const f = setup([subject(['payroll_edit', 'payroll_parameter_review'])]);
    await f.get();
    expect(Object.keys(f.prisma.payrollBatch)).toEqual(['findMany']);
    expect(Object.keys(f.parameters)).toEqual(['list']);
    expect(Object.keys(f.readiness)).toEqual(['list']);
  });
});
