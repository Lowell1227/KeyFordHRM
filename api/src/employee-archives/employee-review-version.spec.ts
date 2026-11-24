import { ConflictException } from '@nestjs/common';
import { Prisma, SysRole } from '@prisma/client';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';

const reviewer = { id: 'reviewer-a', name: 'Fictional reviewer', sysRole: SysRole.hr,
  deptId: null, isAssessorOnly: false, canViewAll: true };

function fixture() {
  const rows = new Map(['r1', 'r2'].map((id, index) => [id, {
    id, requestVersion: index + 1, userId: `employee-${id}`, createdById: reviewer.id,
    recordStatus: 'submitted', archivedAt: null, cancelledAt: null, talentCandidateId: null,
    profileReviewStatus: 'not_required', performanceReviewStatus: 'pending', validationErrors: [],
    baseValue: { performance: { managerId: null } }, proposedValue: { performance: { managerId: 'manager' } },
  }]));
  let beforeClaim: (() => void) | undefined;
  const tx = {
    employeeDataChangeRequest: {
      findUnique: jest.fn(async ({ where }) => structuredClone(rows.get(where.id))),
      updateMany: jest.fn(async ({ where, data }) => {
        beforeClaim?.(); beforeClaim = undefined;
        const row = rows.get(where.id);
        if (!row || Object.entries(where).some(([key, value]) => row[key] !== value)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }) => Object.assign(rows.get(where.id)!, data)),
    },
    user: {
      findUnique: jest.fn(async ({ where }) => ({ id: where.id, directManagerId: null })),
      update: jest.fn(async () => ({})),
    },
    auditLog: { create: jest.fn() },
  };
  const service = new EmployeeDataReviewsService({ $transaction: async callback => callback(tx) } as any);
  const approve = (versions: Record<string, number> | undefined, ids = ['r1']) => service.approveBatch({
    requestIds: ids, scopes: ['performance'], requestVersions: versions,
  } as any, reviewer);
  const reject = (versions: Record<string, number> | undefined, ids = ['r1']) =>
    (service.rejectBatch as any)(ids, 'Fictional correction', reviewer, versions);
  function noWrites() {
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  }
  return { rows, tx, approve, reject, noWrites, race: (fn: () => void) => { beforeClaim = fn; } };
}

describe('review decisions bind the version actually seen', () => {
  for (const action of ['approve', 'reject'] as const) {
    it(`${action}: A sees v1, B returns it and resubmits v2, A cannot decide v1`, async () => {
      const f = fixture();
      await f.reject({ r1: 1 });
      Object.assign(f.rows.get('r1')!, { requestVersion: 2, performanceReviewStatus: 'pending' });
      jest.clearAllMocks();
      const before = structuredClone(f.rows.get('r1'));
      await expect(f[action]({ r1: 1 })).rejects.toBeInstanceOf(ConflictException);
      expect(f.rows.get('r1')).toEqual(before);
      f.noWrites();
      const fresh = await f[action]({ r1: 2 });
      expect(fresh.failed).toEqual([]);
      expect(fresh.succeeded).toHaveLength(1);
      expect(f.rows.get('r1')!.performanceReviewStatus).toBe(action === 'approve' ? 'approved' : 'rejected');
    });

    it.each([undefined, {}, { r1: 0 }, { r1: '1' }, { r1: 1.5 }, { r2: 1 }])(`${action}: invalid or missing per-ID version %j cannot write`, async versions => {
      const f = fixture();
      await expect(f[action](versions as any)).rejects.toBeInstanceOf(ConflictException);
      f.noWrites();
      expect(f.tx.employeeDataChangeRequest.updateMany).not.toHaveBeenCalled();
    });

    it(`${action}: resubmission after read is stopped by the write condition`, async () => {
      const f = fixture();
      f.race(() => { f.rows.get('r1')!.requestVersion = 2; });
      await expect(f[action]({ r1: 1 })).rejects.toBeInstanceOf(ConflictException);
      expect(f.rows.get('r1')!.performanceReviewStatus).toBe('pending');
      f.noWrites();
      expect(f.tx.employeeDataChangeRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'r1', requestVersion: 1 }),
      }));
    });

    it(`${action}: mixed versions retain independent partial success`, async () => {
      const f = fixture();
      const before = structuredClone(f.rows.get('r1'));
      const result = await f[action]({ r1: 99, r2: 2 }, ['r1', 'r2']);
      expect(result.succeeded.map(item => item.requestId)).toEqual(['r2']);
      expect(result.failed).toEqual([{ requestId: 'r1', reason: expect.stringContaining('刷新后重新核对') }]);
      expect(f.rows.get('r1')).toEqual(before);
      expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    });
  }

  it('return converts a rolled-back serialization race into a refresh-required 409', async () => {
    const f = fixture();
    f.tx.employeeDataChangeRequest.updateMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Synthetic concurrent resubmission', { code: 'P2034', clientVersion: '5.22.0' }),
    );
    await expect(f.reject({ r1: 1 })).rejects.toBeInstanceOf(ConflictException);
    f.noWrites();
    expect(f.rows.get('r1')!.performanceReviewStatus).toBe('pending');
  });
});
