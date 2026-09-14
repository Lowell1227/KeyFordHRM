import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '@/common/types/auth.types';
import { AppealsService } from './appeals.service';

const hr = { id: 'hr', name: 'HR', sysRole: 'hr' } as AuthUser;
const employee = { id: 'employee', name: 'Employee', sysRole: 'employee' } as AuthUser;

describe('AppealsService HR personnel ledger', () => {
  it('rejects employee and system administrator before any database access', async () => {
    const db = { hrAppealRecord: { findMany: jest.fn(), count: jest.fn() } };
    const service = new AppealsService(db as any);
    await expect(service.findAll({} as any, employee)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findAll({} as any, { ...hr, sysRole: 'system_admin' } as AuthUser)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.hrAppealRecord.findMany).not.toHaveBeenCalled();
  });

  it('queries only the independent HR record table', async () => {
    const db = { hrAppealRecord: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) } };
    const service = new AppealsService(db as any);
    const result = await service.findAll({ keyword: '依据', cycleId: 'cycle', deptId: 'dept', page: 1, pageSize: 10, skip: 0, take: 10 } as any, hr);
    expect(result.items).toEqual([]);
    expect(db.hrAppealRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cycleId: 'cycle', employee: { deptId: 'dept' }, OR: expect.any(Array) }),
    }));
    expect(Object.keys(db)).toEqual(['hrAppealRecord']);
  });

  it('saves an appeal from one content field without requiring a subject', async () => {
    const receivedAt = new Date('2026-09-14T00:00:00.000Z');
    let saved: Record<string, unknown> | undefined;
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'employee' }) },
      hrAppealRecord: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        saved = data;
        return { id: 'record' };
      }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const db = {
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      hrAppealRecord: { findUnique: jest.fn(async () => ({
        id: 'record', employeeId: 'employee', cycleId: null, receivedAt,
        content: saved?.content, handlingNote: null, conclusion: null,
        createdAt: receivedAt, updatedAt: receivedAt,
        employee: { name: '员工', employeeNo: 'EMP001', deptId: null, dept: null },
        cycle: null, recordedBy: { name: 'HR' },
      })) },
    };
    const service = new AppealsService(db as any);

    const result = await service.create({ employeeId: 'employee', receivedAt: '2026-09-14',
      content: '希望核查评分依据' } as any, hr);

    expect(result.content).toBe('希望核查评分依据');
    expect(result).not.toHaveProperty('subject');
  });
});
