import { ForbiddenException } from '@nestjs/common';
import { PayrollAccessService } from './payroll-access.service';

describe('live payroll access', () => {
  function fixture(values: Record<string, string> = { PAYROLL_ENABLED: 'true', HRM_PREVIEW: 'true' }) {
    const findMany = jest.fn(async () => []);
    const prisma = { payrollGrant: { findMany } } as any;
    return { findMany, prisma, service: new PayrollAccessService(prisma, { get: (key: string) => values[key] } as any) };
  }
  it('disabled payroll leaves existing authentication independent of salary tables', async () => {
    const { service, findMany } = fixture({});
    expect(await service.getAccess({ id: 'admin', sysRole: 'system_admin' })).toEqual({ enabled: false, subjects: [] });
    await expect(service.assert({ payrollGrant: { findMany } } as any, { id: 'admin' }, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each(['system_admin', 'hr'])('does not elevate %s into payroll', async sysRole => {
    const { service, prisma } = fixture();
    await expect(service.assert(prisma, { id: 'operator', sysRole }, 'subject', 'payroll_export')).rejects.toThrow(ForbiddenException);
  });
  it('reads current grants and eligible actor state on every operation', async () => {
    const { service, prisma, findMany } = fixture();
    await expect(service.assert(prisma, { id: 'operator', sysRole: 'employee' }, 'subject', 'payroll_edit')).rejects.toThrow();
    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'operator', subjectId: 'subject', revokedAt: null,
      user: { status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null, isAssessorOnly: false } } });
  });
  it('formal enablement never opens the formal channel inside preview', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'true', HRM_PREVIEW: 'true', PAYROLL_FORMAL_ENABLED: 'true' });
    await expect(service.assertDomain(prisma, 'formal')).rejects.toThrow(ForbiddenException);
  });
  it('the global switch alone cannot enable formal payroll', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'true' });
    expect(service.enabled()).toBe(false);
    await expect(service.assertDomain(prisma, 'formal')).rejects.toThrow(ForbiddenException);
  });
  it('checks revoked grants again rather than trusting the menu or JWT', async () => {
    const { service, prisma, findMany } = fixture();
    findMany.mockResolvedValueOnce([{ userId: 'operator', subjectId: 'subject', capabilities: ['payroll_view'], revokedAt: null }] as any);
    await expect(service.assert(prisma, { id: 'operator' }, 'subject', 'payroll_view')).resolves.toBeUndefined();
    await expect(service.assert(prisma, { id: 'operator' }, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
