import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { EmployeeDataReviewsService, EmployeeReviewScope } from './employee-data-reviews.service';

function databaseError(code = 'P2034') {
  return new Prisma.PrismaClientKnownRequestError('Raw database details: private SQL and engine trace', {
    code, clientVersion: '5.20.0',
  });
}

function fixture() {
  const employee = { employeeNo: 'SYNTH001', name: 'Original employee', phone: null,
    company: 'fuede', deptId: 'synthetic-dept', entryDate: '2024-01-01T00:00:00.000Z',
    employmentType: 'full_time', employeeStatus: 'active' };
  const request = { id: 'review-1', userId: 'employee-1', requestVersion: 1,
    sourceType: 'manual_archive_change', sourceSystem: null, sourceBatchId: null, talentCandidateId: null,
    intakeType: null, onboardingStatus: null, recordStatus: 'submitted', cancelledAt: null, archivedAt: null,
    profileReviewStatus: 'pending', performanceReviewStatus: 'pending', appliedAt: null, validationErrors: [],
    baseValue: { employee, profile: { education: 'Original' }, contracts: [], performance: { managerId: null } },
    proposedValue: { employee: { ...employee, name: 'Approved employee' },
      profile: { education: 'Approved', educationId: '70000000-0000-4000-8000-000000000001' },
      contracts: [], performance: { managerId: 'manager-1' } } };
  let state: any = {
    requests: { [request.id]: request }, audits: [],
    users: {
      'employee-1': { ...employee, id: 'employee-1', status: 'active', accountType: 'employee',
        entryDate: new Date(employee.entryDate), directManagerId: null, employeeProfile: { education: 'Original' },
        employeeContracts: [], employmentHistory: [{ company: 'fuede' }] },
      'manager-1': { id: 'manager-1', status: 'active', accountType: 'employee', deletedAt: null, directManagerId: null },
    },
  };
  const operator: AuthUser = { id: 'synthetic-reviewer', name: 'Reviewer', sysRole: SysRole.hr_user,
    deptId: null, isAssessorOnly: false, canViewAll: true, hrCapabilities: ['employee_archive_review'] };
  const commitFailures = new Map<number, unknown>();
  const attempts: Array<{ reads: string[]; writes: number; audits: number }> = [];
  let afterRollback: ((committed: any, attempt: number) => void) | undefined;
  let beforePerformanceWrite: ((attempt: number) => void) | undefined;
  const prisma = { $transaction: jest.fn(async (run: any, options: any) => {
    expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const draft = structuredClone(state);
    const observed = { reads: [] as string[], writes: 0, audits: 0 };
    attempts.push(observed);
    const attempt = attempts.length;
    const tx = {
      employeeDataChangeRequest: {
        findUnique: async ({ where }: any) => {
          observed.reads.push(where.id);
          return structuredClone(draft.requests[where.id] ?? null);
        },
        updateMany: async ({ where, data }: any) => {
          const row = draft.requests[where.id];
          if (!row || !Object.entries(where).every(([key, value]) => row[key] === value)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
        update: async ({ where, data }: any) => Object.assign(draft.requests[where.id], data),
      },
      user: {
        findUnique: async ({ where }: any) => {
          const row = draft.users[where.id];
          if (!row || where.status && !where.status.in.includes(row.status) || where.deletedAt === null && row.deletedAt) return null;
          return { ...structuredClone(row), ...(row.entryDate ? { entryDate: new Date(row.entryDate) } : {}) };
        },
        update: async ({ where, data }: any) => {
          if ('directManagerId' in data) beforePerformanceWrite?.(attempt);
          observed.writes++;
          return Object.assign(draft.users[where.id], data);
        },
      },
      employeeProfile: { upsert: async ({ where, update }: any) => Object.assign(draft.users[where.userId].employeeProfile, update) },
      personnelReferenceData: { findMany: async () => [{ id: '70000000-0000-4000-8000-000000000001',
        kind: 'education', name: 'Approved', isActive: true }] },
      employeeContract: { findMany: async () => [] },
      auditLog: { create: async ({ data }: any) => { observed.audits++; draft.audits.push(data); return data; } },
    };
    try {
      const result = await run(tx);
      if (commitFailures.has(attempt)) throw commitFailures.get(attempt);
      state = draft;
      return result;
    } catch (error) {
      afterRollback?.(state, attempt);
      throw error;
    }
  }) };
  const service = new EmployeeDataReviewsService(prisma as any);
  return { operator, prisma, attempts, commitFailures, state: () => state,
    afterRollback: (callback: typeof afterRollback) => { afterRollback = callback; },
    beforePerformanceWrite: (callback: typeof beforePerformanceWrite) => { beforePerformanceWrite = callback; },
    approve: (scopes: EmployeeReviewScope[] = ['profile', 'performance'], requestIds = ['review-1']) =>
      service.approveBatch({ requestIds, scopes,
        requestVersions: Object.fromEntries(requestIds.map(id => [id, state.requests[id]?.requestVersion])) }, operator),
    reject: () => service.rejectBatch(['review-1'], 'Needs correction', operator, { 'review-1': request.requestVersion }),
  };
}

describe('approval serialization conflict recovery', () => {
  it.each([1, 2])('replays both scopes after %i rolled-back commit conflicts and commits each effect once', async conflicts => {
    const f = fixture();
    for (let attempt = 1; attempt <= conflicts; attempt++) f.commitFailures.set(attempt, databaseError());

    expect(await f.approve(['performance', 'profile'], ['review-1', 'review-1'])).toEqual({
      succeeded: [{ requestId: 'review-1', scopes: ['profile', 'performance'] }], failed: [],
    });
    expect(f.attempts).toHaveLength(conflicts + 1);
    expect(f.attempts.every(attempt => attempt.reads.length === 2 && attempt.writes === 2 && attempt.audits === 2)).toBe(true);
    expect(f.state().requests['review-1']).toMatchObject({ profileReviewStatus: 'approved', performanceReviewStatus: 'approved' });
    expect(f.state().users['employee-1']).toMatchObject({ name: 'Approved employee', directManagerId: 'manager-1',
      employeeProfile: { education: 'Approved' } });
    expect(f.state().audits).toHaveLength(2);
    expect(f.state().audits.map((audit: any) => audit.newValue.scopes)).toEqual([['profile'], ['performance']]);
  });

  it('stops after three total attempts with a friendly retry reason and no partial success', async () => {
    const f = fixture();
    for (let attempt = 1; attempt <= 4; attempt++) f.commitFailures.set(attempt, databaseError());
    const result = await f.approve();
    expect(f.attempts).toHaveLength(3);
    expect(result).toEqual({ succeeded: [], failed: [{ requestId: 'review-1', reason: expect.stringContaining('\u91cd\u8bd5') }] });
    expect(result.failed[0].reason).not.toMatch(/Raw|SQL|engine|P2034/);
    expect(f.state().requests['review-1']).toMatchObject({ profileReviewStatus: 'pending', performanceReviewStatus: 'pending', appliedAt: null });
    expect(f.state().users['employee-1']).toMatchObject({ name: 'Original employee', directManagerId: null,
      employeeProfile: { education: 'Original' } });
    expect(f.state().audits).toEqual([]);
  });

  it('replays the profile too when P2034 interrupts the later performance scope', async () => {
    const f = fixture();
    f.beforePerformanceWrite(attempt => { if (attempt === 1) throw databaseError(); });
    expect((await f.approve()).failed).toEqual([]);
    expect(f.attempts.map(attempt => attempt.writes)).toEqual([1, 2]);
    expect(f.state().audits).toHaveLength(2);
  });

  it.each([
    [{ recordStatus: 'draft' }, '\u8349\u7a3f\u5c1a\u672a\u63d0\u4ea4\u5ba1\u6838'],
    [{ recordStatus: 'archived' }, '\u8be5\u8bb0\u5f55\u5df2\u5f52\u6863'],
    [{ cancelledAt: new Date() }, '\u5165\u804c\u7533\u8bf7\u5df2\u53d6\u6d88'],
    [{ sourceSystem: 'archive_assistant_pilot' }, '\u6d4b\u8bd5\u8d44\u6599\u4ec5\u53ef\u4fdd\u5b58\u5f85\u6838\u8349\u7a3f'],
    [{ validationErrors: ['New validation failure'] }, 'New validation failure'],
    [{ profileReviewStatus: 'approved', performanceReviewStatus: 'approved' }, '\u8be5\u8bb0\u5f55\u5df2\u5904\u7406'],
  ])('rereads request guards after rollback (%j)', async (change, reason) => {
    const f = fixture();
    f.commitFailures.set(1, databaseError());
    f.afterRollback(state => Object.assign(state.requests['review-1'], change));
    expect(await f.approve()).toEqual({ succeeded: [], failed: [{ requestId: 'review-1', reason }] });
    expect(f.attempts).toHaveLength(2);
    expect(f.state().audits).toEqual([]);
    expect(f.state().users['employee-1'].name).toBe('Original employee');
  });

  it.each([
    ['name', 'Concurrent employee edit', '\u6b63\u5f0f\u57fa\u7840\u6863\u6848\u5df2\u53d1\u751f\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u63d0\u4ea4\u5ba1\u6838'],
    ['directManagerId', 'concurrent-manager', '\u6b63\u5f0f\u7ee9\u6548\u76f4\u5c5e\u4e0a\u7ea7\u5df2\u53d1\u751f\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u63d0\u4ea4\u5ba1\u6838'],
  ])('revalidates the %s baseline on a fresh transaction', async (field, value, reason) => {
    const f = fixture();
    f.commitFailures.set(1, databaseError());
    f.afterRollback(state => { state.users['employee-1'][field] = value; });
    expect(await f.approve()).toEqual({ succeeded: [], failed: [{ requestId: 'review-1', reason }] });
    expect(f.attempts).toHaveLength(2);
    expect(f.state().users['employee-1'][field]).toBe(value);
    expect(f.state().audits).toEqual([]);
    expect(f.state().requests['review-1'].profileReviewStatus).toBe('pending');
  });

  it('rechecks the supplied actor capability before retrying any writes', async () => {
    const f = fixture();
    f.commitFailures.set(1, databaseError());
    f.afterRollback(() => { f.operator.hrCapabilities = []; });
    expect(await f.approve()).toEqual({ succeeded: [], failed: [{ requestId: 'review-1',
      reason: '\u65e0\u6743\u9650\u5ba1\u6838\u4eba\u4e8b\u53d8\u66f4' }] });
    expect(f.state().audits).toEqual([]);
    expect(f.state().users['employee-1'].name).toBe('Original employee');
  });

  it.each(['profile', 'contracts'])('revalidates the %s baseline after rollback', async field => {
    const f = fixture();
    f.commitFailures.set(1, databaseError());
    f.afterRollback(state => {
      if (field === 'profile') state.users['employee-1'].employeeProfile.education = 'Concurrent profile';
      else state.users['employee-1'].employeeContracts = [{ id: 'concurrent-contract' }];
    });
    const result = await f.approve();
    expect(result).toEqual({ succeeded: [], failed: [{ requestId: 'review-1',
      reason: '\u6b63\u5f0f\u57fa\u7840\u6863\u6848\u5df2\u53d1\u751f\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u63d0\u4ea4\u5ba1\u6838' }] });
    expect(f.attempts).toHaveLength(2);
    expect(f.state().requests['review-1'].profileReviewStatus).toBe('pending');
    expect(f.state().audits).toEqual([]);
  });

  it('refuses an initially unauthorized caller without starting a transaction', async () => {
    const f = fixture();
    f.operator.hrCapabilities = [];
    await expect(f.approve()).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.attempts).toHaveLength(0);
  });

  it.each([
    ['missing record', databaseError('P2025')], ['transaction timeout', databaseError('P2028')],
    ['message only', new Error('P2034 in a message is not a serialization error')],
    ['untrusted code', Object.assign(new Error('Untrusted error'), { code: 'P2034' })],
  ])('does not retry other or ambiguous errors (%s)', async (_label, error) => {
    const f = fixture();
    f.commitFailures.set(1, error);
    const result = await f.approve();
    expect(f.attempts).toHaveLength(1);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).not.toMatch(/Raw|SQL|engine|P2025|P2028|P2034|Untrusted/);
    expect(f.state().audits).toEqual([]);
  });

  it.each([
    ['validation', new BadRequestException({ message: 'Business validation reason' }), 'Business validation reason'],
    ['conflict', new ConflictException('Business conflict reason'), 'Business conflict reason'],
    ['permission', new ForbiddenException('Business permission reason'), 'Business permission reason'],
    ['missing', new NotFoundException({ message: 'Business missing reason' }), 'Business missing reason'],
  ])('preserves allowlisted %s business exception messages without retrying', async (_label, error, reason) => {
    const f = fixture();
    f.commitFailures.set(1, error);
    expect(await f.approve()).toEqual({ succeeded: [], failed: [{ requestId: 'review-1', reason }] });
    expect(f.attempts).toHaveLength(1);
    expect(f.state().audits).toEqual([]);
  });

  it('preserves a business failure in the second scope and rolls back the first scope', async () => {
    const f = fixture();
    f.state().users['manager-1'].deletedAt = new Date();
    expect(await f.approve()).toEqual({ succeeded: [], failed: [{ requestId: 'review-1',
      reason: '\u7ee9\u6548\u76f4\u5c5e\u4e0a\u7ea7\u4e0d\u5b58\u5728\u6216\u5df2\u505c\u7528' }] });
    expect(f.attempts).toHaveLength(1);
    expect(f.attempts[0]).toMatchObject({ writes: 1, audits: 1 });
    expect(f.state().requests['review-1']).toMatchObject({ profileReviewStatus: 'pending', performanceReviewStatus: 'pending', appliedAt: null });
    expect(f.state().users['employee-1'].name).toBe('Original employee');
    expect(f.state().audits).toEqual([]);
  });

  it.each(['P2034', 'P2028'])('keeps a rolled-back rejection pending with no false success or raw %s error', async code => {
    const f = fixture();
    f.commitFailures.set(1, databaseError(code));
    if (code === 'P2034') {
      await expect(f.reject()).rejects.toMatchObject({ status: 409,
        message: '申请版本缺失或已变化，请刷新后重新核对再审核' });
    } else {
      const result = await f.reject();
      expect(result.succeeded).toEqual([]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).not.toMatch(/Raw|SQL|engine|P2034|P2028/);
    }
    expect(f.attempts).toHaveLength(1);
    expect(f.state().requests['review-1']).toMatchObject({ profileReviewStatus: 'pending', performanceReviewStatus: 'pending' });
    expect(f.state().audits).toEqual([]);
  });

  it('isolates an exhausted request without undoing or retrying another committed request', async () => {
    const f = fixture();
    f.state().requests['review-2'] = { ...structuredClone(f.state().requests['review-1']), id: 'review-2', userId: 'employee-2' };
    f.state().users['employee-2'] = { ...structuredClone(f.state().users['employee-1']), id: 'employee-2' };
    for (const attempt of [2, 3, 4]) f.commitFailures.set(attempt, databaseError());
    expect(await f.approve(['profile', 'performance'], ['review-1', 'review-2'])).toEqual({
      succeeded: [{ requestId: 'review-1', scopes: ['profile', 'performance'] }],
      failed: [{ requestId: 'review-2', reason: expect.stringContaining('\u91cd\u8bd5') }],
    });
    expect(f.attempts).toHaveLength(4);
    expect(f.state().users['employee-1'].name).toBe('Approved employee');
    expect(f.state().users['employee-2'].name).toBe('Original employee');
    expect(f.state().audits).toHaveLength(2);
  });
});
