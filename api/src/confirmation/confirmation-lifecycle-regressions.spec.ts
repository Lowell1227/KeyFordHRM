import { ConflictException } from '@nestjs/common';
import { ConfirmationService } from './confirmation.service';
import { terminateEmploymentPerformance } from '@/performance-lifecycle/lifecycle-employment';

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'NOT') return !matches(row, value);
    const actual = row?.[key];
    if (value instanceof Date) return actual?.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(actual);
      if ('gt' in value) return actual > value.gt;
      if ('not' in value) return actual !== value.not;
      if ('is' in value) return matches(actual, value.is);
      return matches(actual, value);
    }
    return actual === value;
  });
}

describe('confirmation lifecycle and employment regressions', () => {
  const at = new Date('2026-11-16T04:00:00Z');
  const viewer = { id: 'employee', name: 'Fictional employee', sysRole: 'employee',
    isAssessorOnly: false, canViewAll: false, hrCapabilities: [], deptId: null } as any;
  function fixture() {
    const employee = { ...viewer, employeeNo: 'SYN-001', status: 'probation', deletedAt: null, archivedAt: null,
      entryDate: new Date('2026-09-01'), deptId: 'department', dept: null };
    const records: any[] = [{ id: 'employment', userId: employee.id, employeeNo: employee.employeeNo,
      entryDate: employee.entryDate, effectiveFrom: employee.entryDate, effectiveTo: null,
      employeeStatus: 'probation', directManagerId: 'manager', deptId: 'department', sourceRequestId: null, createdAt: at }];
    const applications: any[] = [];
    const row = (extra: any = {}) => ({ id: `application-${applications.length}`, employeeId: employee.id,
      workflowVersion: 2, submissionVersion: 0, status: 'draft', lifecycleStatus: 'active', lifecycleVersion: 0,
      employmentRecordId: records[0].id, managerId: 'manager', companyApproverId: 'approver', hrId: null,
      summary: 'Fictional summary', voteParticipants: [], employee, createdAt: at, updatedAt: at, ...extra });
    const prisma: any = {
      $queryRaw: jest.fn(async (query: TemplateStringsArray, id: unknown) => {
        const sql = query.join('');
        if (/FROM (users|employment_records|confirmation_applications)/.test(sql)) return [{ id }];
        throw new Error(`Unexpected confirmation contract lock: ${sql}`);
      }),
      user: { findUnique: jest.fn(async ({ where }) => where.id === employee.id ? { ...employee }
        : { id: where.id, status: 'active', deletedAt: null, archivedAt: null }), count: jest.fn(async () => 1) },
      employmentRecord: { findMany: jest.fn(async ({ where }) => records.filter((item) => matches(item, where))),
        findUnique: jest.fn(async ({ where }) => records.find((item) => item.id === where.id) ?? null) },
      department: { findMany: jest.fn(async () => [{ id: 'department', name: 'Fictional department', parentId: null,
        leaderId: null, approverId: 'approver', leader: null, approver: null }]) },
      confirmationApplication: {
        findFirst: jest.fn(async ({ where }) => applications.find((item) => matches(item, where)) ?? null),
        findUnique: jest.fn(async ({ where }) => applications.find((item) => item.id === where.id) ?? null),
        findMany: jest.fn(async ({ where }) => applications.filter((item) => matches(item, where))),
        count: jest.fn(async ({ where }) => applications.filter((item) => matches(item, where)).length),
        create: jest.fn(async ({ data }) => {
          const saved = row({ employeeId: data.employee.connect.id, creatorId: data.creator.connect.id,
            employmentRecordId: data.employmentRecord?.connect.id ?? data.employmentRecordId ?? null,
            managerId: data.manager?.connect.id ?? null, summary: data.summary });
          applications.push(saved); return saved;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const selected = applications.filter((item) => matches(item, where));
          for (const item of selected) for (const [key, value] of Object.entries(data)) {
            item[key] = (value as any)?.increment ? item[key] + (value as any).increment : value;
          }
          return { count: selected.length };
        }),
      },
      assessmentTask: { findMany: jest.fn(async () => []) }, improvementPlan: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
    const service = new ConfirmationService(prisma, {} as any, { getConfirmationEmployeeFilter: async () => ({}) } as any,
      { create: jest.fn(async () => null) } as any);
    return { service, prisma, applications, records, employee, row };
  }
  beforeEach(() => { jest.useFakeTimers().setSystemTime(at); });
  afterEach(() => jest.useRealTimers());

  it('does not let a terminated unfinished application block a newly bound draft', async () => {
    const f = fixture();
    f.applications.push(f.row({ id: 'ended', lifecycleStatus: 'terminated' }));
    await f.service.create({ summary: 'New draft' }, viewer);
    expect(f.applications).toHaveLength(2);
    expect(f.applications[1]).toMatchObject({ lifecycleStatus: 'active', employmentRecordId: 'employment' });
    expect(f.prisma.confirmationApplication.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ employeeId: viewer.id, workflowVersion: 2, lifecycleStatus: 'active' }),
    }));
  });
  it('locks the current user and employment inside draft creation before storing their link', async () => {
    const f = fixture();
    await f.service.create({ summary: 'New draft' }, viewer);
    const queries = f.prisma.$queryRaw.mock.calls.map(([query]: any[]) => query.join(''));
    expect(queries).toEqual(expect.arrayContaining([expect.stringContaining('FROM users'), expect.stringContaining('FROM employment_records')]));
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.prisma.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(f.prisma.confirmationApplication.create.mock.invocationCallOrder[0]);
    expect(f.applications[0].employmentRecordId).toBe('employment');
  });
  it('refuses a new draft without a trustworthy current employment', async () => {
    const f = fixture(); f.records.splice(0);
    await expect(f.service.create({ summary: 'New draft' }, viewer)).rejects.toBeInstanceOf(ConflictException);
    expect(f.prisma.confirmationApplication.create).not.toHaveBeenCalled();
  });
  it('rechecks resignation after entering the draft transaction', async () => {
    const f = fixture();
    f.prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      f.employee.status = 'resigned'; return callback(f.prisma);
    });
    await expect(f.service.create({ summary: 'New draft' }, viewer)).rejects.toThrow();
    expect(f.prisma.confirmationApplication.create).not.toHaveBeenCalled();
  });
  it('binds a new draft so effective offboarding can terminate it without changing its business status', async () => {
    const f = fixture();
    await f.service.create({ summary: 'New draft' }, viewer);
    await terminateEmploymentPerformance(f.prisma, viewer.id, 'employment', at, 'hr');
    expect(f.applications[0]).toMatchObject({ status: 'draft', lifecycleStatus: 'terminated', employmentRecordId: 'employment' });
  });
  it.each([false, true])('does not rebind an old draft to reentry (reused employee number: %s)', async (reuse) => {
    const f = fixture(); const old = f.row(); f.applications.push(old);
    f.records[0].effectiveTo = new Date('2026-10-31');
    if (!reuse) f.employee.employeeNo = 'SYN-002';
    f.records.push({ ...f.records[0], id: 'reentry', employeeNo: f.employee.employeeNo,
      entryDate: new Date('2026-11-01'), effectiveFrom: new Date('2026-11-01'), effectiveTo: null });
    await expect(f.service.submit(old.id, viewer, { submissionVersion: 0 })).rejects.toBeInstanceOf(ConflictException);
    expect(old).toMatchObject({ status: 'draft', employmentRecordId: 'employment' });
    expect(f.prisma.confirmationApplication.updateMany).not.toHaveBeenCalled();
  });
  it('allows an approved same-spell transfer without replacing the draft origin link', async () => {
    const f = fixture(); const old = f.row(); f.applications.push(old);
    f.records[0].effectiveTo = new Date('2026-10-31');
    f.records.push({ ...f.records[0], id: 'transfer', effectiveFrom: new Date('2026-11-01'), effectiveTo: null });
    await f.service.submit(old.id, viewer, { submissionVersion: 0 });
    expect(old).toMatchObject({ status: 'submitted', employmentRecordId: 'employment' });
  });
  it('does not guess a legacy null employment link during submission', async () => {
    const f = fixture(); const old = f.row({ employmentRecordId: null }); f.applications.push(old);
    await expect(f.service.submit(old.id, viewer, { submissionVersion: 0 })).rejects.toBeInstanceOf(ConflictException);
    expect(f.prisma.confirmationApplication.updateMany).not.toHaveBeenCalled();
    expect(old.employmentRecordId).toBeNull();
  });
  it.each(['submitted', 'hr_approved'])('retains ended %s in assigned history while excluding active pending and unrelated records', async (status) => {
    const f = fixture();
    const actor = { ...viewer, id: status === 'submitted' ? 'manager' : 'approver' };
    f.applications.push(f.row({ id: 'ended', status, submissionVersion: 1, lifecycleStatus: 'terminated' }),
      f.row({ id: 'active', status, submissionVersion: 1 }),
      f.row({ id: 'unrelated', status, submissionVersion: 1, lifecycleStatus: 'terminated', managerId: 'other', companyApproverId: 'other' }));
    const page = await f.service.findAssignedHistory({ page: 1, pageSize: 10, skip: 0, take: 10 } as any, actor);
    expect(page.items.map((item) => item.id)).toEqual(['ended']);
    expect(page.items[0]).toMatchObject({ lifecycleStatus: 'terminated', pendingRole: null });
  });
});
