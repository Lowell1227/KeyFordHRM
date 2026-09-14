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
});
