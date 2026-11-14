import { ConflictException } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { selectEmploymentAt } from './employment-timeline';

const operator = { id: 'synthetic-reviewer', sysRole: SysRole.hr } as any;

// Keep dates in Jest's realm so the service sees the same Date type as Prisma returns.
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]) => value === undefined
    || (value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value));
}

function apply(row: any, data: any) {
  for (const [key, value] of Object.entries(data) as any) {
    row[key] = value?.increment ? row[key] + value.increment : clone(value);
  }
  return clone(row);
}

function fixture(talentCandidateId: string | null = null, currentFrom = '2024-01-01') {
  const employee = {
    employeeNo: 'S001', name: 'Synthetic', company: 'fuede', companyText: null,
    contractSubjectId: null, deptId: 'd1', entryDate: '2024-01-01T00:00:00.000Z',
    employmentType: 'full_time', employeeStatus: 'active',
  };
  let state: any = {
    request: {
      id: 'r1', userId: 'u1', employeeNo: 'S001', sourceType: 'manual_employment_change',
      intakeType: null, sourceBatchId: null, recordStatus: 'submitted', requestVersion: 1,
      talentCandidateId, archivedAt: null, cancelledAt: null, rejectedReason: null,
      profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      profileReviewedAt: null, profileReviewedById: null, performanceReviewedAt: null,
      performanceReviewedById: null, appliedAt: null, updatedAt: new Date('2026-11-13T01:00:00Z'),
      validationErrors: [], validationWarnings: [], revisionHistory: [],
      baseValue: { employee, profile: {}, performance: { managerId: null } },
      proposedValue: { employee: { ...employee, effectiveFrom: '2025-01-01', changeType: 'transfer' },
        profile: {}, performance: { managerId: 'manager-A' } },
    },
    user: { ...employee, id: 'u1', status: 'active', accountType: 'employee',
      entryDate: new Date('2024-01-01'), directManagerId: null, employeeProfile: null, employeeContracts: [] },
    records: [{ id: 'current-employment', userId: 'u1', company: 'fuede', companyText: null,
      contractSubjectId: null, employeeStatus: 'active', effectiveFrom: new Date(currentFrom), effectiveTo: null }],
    bindingEnabled: true, audit: [],
  };
  const trace: string[] = [];
  let beforeWrite: (() => void) | undefined;
  let failProposalWrite = false;
  let transactionError: unknown;
  const enterWrite = () => { const hook = beforeWrite; beforeWrite = undefined; hook?.(); };

  // Only persistence is replaced. Transactions publish their copy only after success.
  const client = (read: () => any, transactional: boolean): any => ({
    $queryRaw: async () => { trace.push('talent-lock'); return []; },
    employeeDataChangeRequest: {
      findUnique: async () => clone(read().request),
      update: async ({ where, data }: any) => {
        if (!transactional) enterWrite();
        const row = read().request;
        if (!matches(row, where)) throw { code: 'P2025' };
        trace.push(transactional ? 'transaction-write' : 'outside-write');
        const result = apply(row, data);
        if (data.proposedValue && failProposalWrite) throw new Error('synthetic persistence failure');
        return result;
      },
      updateMany: async ({ where, data }: any) => {
        if (!matches(read().request, where)) return { count: 0 };
        apply(read().request, data);
        return { count: 1 };
      },
    },
    user: {
      findUnique: async ({ where }: any) => where.id === 'u1'
        ? { ...clone(read().user), employmentHistory: clone(read().records) }
        : { id: where.id, name: where.id, status: 'active', deletedAt: null, directManagerId: null },
      update: async ({ data }: any) => apply(read().user, data),
    },
    employmentRecord: {
      findFirst: async ({ where }: any) => {
        const row = where.employeeStatus ? read().records.find((record: any) =>
          where.employeeStatus.in.includes(record.employeeStatus)
          && record.effectiveFrom <= where.effectiveFrom.lte
          && (!record.effectiveTo || record.effectiveTo >= where.effectiveFrom.lte)) : read().records[0];
        return row ? clone(row) : null;
      },
      create: async ({ data }: any) => {
        const record = { id: `employment-${read().records.length}`, ...clone(data) };
        read().records.push(record);
        return record;
      },
      update: async ({ where, data }: any) => apply(read().records.find((row: any) => row.id === where.id), data),
    },
    employeeProfile: { upsert: async () => ({}) },
    externalIdentityBinding: { updateMany: async () => { read().bindingEnabled = false; return { count: 1 }; } },
    auditLog: { create: async ({ data }: any) => { read().audit.push(clone(data)); return data; } },
  });
  const db = {
    ...client(() => state, false),
    $transaction: async (run: any) => {
      enterWrite();
      const local = clone(state);
      const result = await run(client(() => local, true));
      if (transactionError) throw transactionError;
      state = local;
      return result;
    },
  };
  const service = new EmployeeDataReviewsService(db);
  return {
    service, state: () => state, trace,
    approve: (scope: 'profile' | 'performance') => service.approveBatch({ requestIds: ['r1'], scopes: [scope] }, operator),
    changeManager: (id: string) => service.setPendingPerformanceManager('r1', id, operator),
    failProposalWrite: () => { failProposalWrite = true; },
    failTransaction: (error: unknown) => { transactionError = error; },
    beforeWrite: (hook: () => void) => { beforeWrite = hook; },
  };
}

describe('employee review consistency remediation', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-14T04:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it.each(['2024-01-01', '2025-01-02'])('only appends historical resignation beside current employment starting %s', async currentFrom => {
    const f = fixture(null, currentFrom);
    Object.assign(f.state().request.proposedValue.employee, {
      employeeStatus: 'resigned', changeType: 'resignation', leaveDate: '2025-01-01', effectiveTo: '2025-12-31',
    });
    const original = clone(f.state().records[0]);
    const user = clone(f.state().user);

    expect((await f.approve('profile')).failed).toEqual([]);
    expect(f.state().records[0]).toEqual(original);
    expect(f.state().records).toHaveLength(2);
    expect(f.state().records[1]).toMatchObject({ employeeStatus: 'resigned',
      effectiveFrom: new Date('2025-01-02'), effectiveTo: new Date('2025-12-31') });
    expect(selectEmploymentAt(f.state().records, new Date('2026-11-14')).current?.id).toBe('current-employment');
    expect(f.state().user).toEqual(user);
    expect(f.state().bindingEnabled).toBe(true);
  });

  it('still closes current employment at the last working day for a scheduled resignation', async () => {
    const f = fixture();
    Object.assign(f.state().request.proposedValue.employee, {
      employeeStatus: 'resigned', changeType: 'resignation', leaveDate: '2026-11-14', effectiveTo: null,
    });
    expect((await f.approve('profile')).failed).toEqual([]);
    expect(f.state().records[0].effectiveTo).toEqual(new Date('2026-11-14'));
    expect(f.state().records[1].effectiveFrom).toEqual(new Date('2026-11-15'));
    expect(f.state().user.status).toBe('active');
    expect(f.state().bindingEnabled).toBe(true);
    expect(f.state().request.appliedAt).toBeNull();
  });

  describe.each([null, 'candidate-1'])('pending manager revision with talent source %s', talentCandidateId => {
    it('keeps both approval events attached to their exact proposal versions', async () => {
      const f = fixture(talentCandidateId);
      f.state().request.performanceReviewStatus = 'pending';
      expect((await f.approve('profile')).failed).toEqual([]);
      const before = clone(f.state().request);
      f.trace.length = 0;

      const result = await f.changeManager('manager-B');
      const revisions = result.revisionHistory as any[];
      expect(result.requestVersion).toBe(2);
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ version: 1,
        baseValue: before.baseValue, proposedValue: before.proposedValue,
        profileReviewStatus: 'approved', performanceReviewStatus: 'pending',
        profileReviewedById: operator.id, profileReviewedAt: '2026-11-14T04:00:00.000Z',
        rejectedReason: null,
      });
      expect(result.profileReviewStatus).toBe('approved');
      expect(result.performanceReviewStatus).toBe('pending');
      expect(f.trace).toEqual(talentCandidateId ? ['talent-lock', 'transaction-write'] : ['transaction-write']);

      expect((await f.approve('performance')).failed).toEqual([]);
      expect(f.state().audit.filter((item: any) => item.action === 'approve_employee_data_change').map((item: any) => item.newValue))
        .toEqual([{ scopes: ['profile'], requestVersion: 1 }, { scopes: ['performance'], requestVersion: 2 }]);
      expect(f.state().request.revisionHistory[0].proposedValue.performance.managerId).toBe('manager-A');
      expect(f.state().user.directManagerId).toBe('manager-B');
    });

    it('retains each prior snapshot and return reason across consecutive manager corrections', async () => {
      const f = fixture(talentCandidateId);
      f.state().request.performanceReviewStatus = 'pending';
      f.state().request.rejectedReason = 'Previous return';
      await f.changeManager('manager-B');
      await f.changeManager('manager-C');
      const request = f.state().request;
      expect(request.requestVersion).toBe(3);
      expect(request.revisionHistory.map((item: any) => ({ version: item.version,
        managerId: item.proposedValue.performance.managerId, reason: item.rejectedReason })))
        .toEqual([{ version: 1, managerId: 'manager-A', reason: 'Previous return' },
          { version: 2, managerId: 'manager-B', reason: null }]);
      expect(request.proposedValue.performance.managerId).toBe('manager-C');
    });

    it('rolls back proposal, version and history together if persistence fails', async () => {
      const f = fixture(talentCandidateId);
      f.state().request.performanceReviewStatus = 'pending';
      const before = clone(f.state());
      f.failProposalWrite();
      await expect(f.changeManager('manager-B')).rejects.toThrow('synthetic persistence failure');
      expect(f.state()).toEqual(before);
    });

    it.each(['version', 'approval', 'profile-approval'])('does not overwrite a concurrent %s change', async change => {
      const f = fixture(talentCandidateId);
      f.state().request.performanceReviewStatus = 'pending';
      f.beforeWrite(() => {
        if (change === 'version') {
          f.state().request.requestVersion = 2;
          f.state().request.proposedValue.performance.managerId = 'manager-C';
        } else if (change === 'approval') f.state().request.performanceReviewStatus = 'approved';
        else {
          f.state().request.profileReviewStatus = 'approved';
          f.state().request.updatedAt = new Date('2026-11-14T04:00:00Z');
        }
      });
      await expect(f.changeManager('manager-B')).rejects.toBeInstanceOf(ConflictException);
      expect(f.state().request.proposedValue.performance.managerId).toBe(change === 'version' ? 'manager-C' : 'manager-A');
      expect(f.state().request.revisionHistory).toEqual([]);
      expect(f.state().request.requestVersion).toBe(change === 'version' ? 2 : 1);
      expect(f.state().request.performanceReviewStatus).toBe(change === 'approval' ? 'approved' : 'pending');
      expect(f.state().request.profileReviewStatus).toBe(change === 'profile-approval' ? 'approved' : 'pending');
    });

    it.each(['P2025', 'P2034'])('returns HTTP 409 and retains all data on %s', async code => {
      const f = fixture(talentCandidateId);
      f.state().request.performanceReviewStatus = 'pending';
      const before = clone(f.state());
      f.failTransaction({ code });
      const error = await f.changeManager('manager-B').catch(value => value);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getStatus()).toBe(409);
      expect(f.state()).toEqual(before);
    });
  });
});
