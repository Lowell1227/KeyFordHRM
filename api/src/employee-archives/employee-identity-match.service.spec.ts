import { BadRequestException } from '@nestjs/common';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';

describe('EmployeeIdentityMatchService', () => {
  it('requires a complete phone or identity number and never accepts a name field', async () => {
    const prisma = { user: { findMany: jest.fn() } } as any;
    const config = { get: jest.fn().mockReturnValue('test-secret') } as any;
    const service = new EmployeeIdentityMatchService(prisma, config);
    await expect(service.lookup({})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('routes an exact resigned identity match to reentry without returning the raw id', async () => {
    const user = {
      id: 'u1', name: '历史员工', employeeNo: '126', status: 'resigned', archivedAt: new Date(),
      dept: { name: '销售部' }, employeeNumberAssignments: [],
    };
    const prisma = { user: { findMany: jest.fn().mockResolvedValue([user]) } } as any;
    const config = { get: jest.fn().mockReturnValue('test-secret') } as any;
    const service = new EmployeeIdentityMatchService(prisma, config);
    const result = await service.lookup({ idNumber: '110101199001011234' });
    expect(result).toMatchObject({ outcome: 'identity_match', candidates: [{ id: 'u1', nextAction: 'reentry' }] });
    expect(JSON.stringify(result)).not.toContain('110101199001011234');
  });

  it('can match a stored identity fingerprint without restoring the raw identity number', async () => {
    const fingerprint = 'a'.repeat(64);
    const user = {
      id: 'u1', name: '历史员工', employeeNo: '126', status: 'active', archivedAt: null,
      dept: { name: '销售部' }, employeeNumberAssignments: [],
    };
    const prisma = { user: { findMany: jest.fn().mockResolvedValue([user]) } } as any;
    const config = { get: jest.fn().mockReturnValue('test-secret') } as any;
    const service = new EmployeeIdentityMatchService(prisma, config);

    const result = await service.lookupStoredIdentity({ idNumberFingerprint: fingerprint });

    expect(result).toMatchObject({ outcome: 'identity_match', candidates: [{ id: 'u1' }] });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ employeeProfile: { idNumberFingerprint: fingerprint } }),
    }));
  });
});
