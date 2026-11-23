import { ForbiddenException } from '@nestjs/common';
import { PayrollAccessService } from './payroll-access.service';

describe('live payroll access', () => {
  function fixture(values: Record<string, string> = { PAYROLL_ENABLED: 'true', HRM_PREVIEW: 'true' }) {
    const findMany = jest.fn(async () => []);
    const prisma = { payrollGrant: { findMany }, payrollParameterRelease: { findMany: jest.fn(async () => []) } } as any;
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
  it('reads authorized real reconciliation from the formal domain without touching preview fixtures', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false' });
    prisma.systemConfig = { findUnique: jest.fn(() => { throw new Error('Preview fixture must not be read'); }) };
    await expect(service.assertDomain(prisma, 'reconciliation' as any)).resolves.toBe('formal');
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    { PAYROLL_ENABLED: 'false', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false' },
    { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'false', HRM_PREVIEW: 'false' },
    { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'true' },
  ])('keeps real reconciliation closed under %j', async flags => {
    const { service, prisma } = fixture(flags);
    await expect(service.assertDomain(prisma, 'reconciliation' as any)).rejects.toThrow(ForbiddenException);
  });
  it('chooses the maintenance domain from server configuration, never a client selector', () => {
    expect(fixture().service.maintenancePurpose()).toBe('validation');
    expect(fixture({ PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true' }).service.maintenancePurpose()).toBe('formal');
    expect(fixture({}).service.maintenancePurpose()).toBe('formal');
  });
  it('the global switch alone cannot enable formal payroll', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'true' });
    expect(service.enabled()).toBe(false);
    await expect(service.assertDomain(prisma, 'formal')).rejects.toThrow(ForbiddenException);
  });
  it('the formal flag cannot bypass the disabled global switch for domain-only checks', async () => {
    const { service, prisma } = fixture({ PAYROLL_ENABLED: 'false', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false' });
    await expect(service.assertDomain(prisma, 'formal')).rejects.toThrow(ForbiddenException);
  });
  it('checks revoked grants again rather than trusting the menu or JWT', async () => {
    const { service, prisma, findMany } = fixture();
    findMany.mockResolvedValueOnce([{ userId: 'operator', subjectId: 'subject', capabilities: ['payroll_view'], revokedAt: null }] as any);
    await expect(service.assert(prisma, { id: 'operator' }, 'subject', 'payroll_view')).resolves.toBeUndefined();
    await expect(service.assert(prisma, { id: 'operator' }, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
  it('assigned parameter review exposes only that task capability and never salary view or export', async () => {
    const { service, prisma } = fixture();
    prisma.payrollParameterRelease.findMany.mockResolvedValue([{ subjectId: 'subject', subject: { name: 'Fictional subject' },
      submittedBy: { payrollGrants: [{ subjectId: 'subject', capabilities: ['payroll_edit'] }] } }]);
    expect(await service.getAccess({ id: 'manager' })).toEqual({ enabled: true, subjects: [{ id: 'subject', name: 'Fictional subject', capabilities: ['payroll_parameter_review'] }] });
    const query = prisma.payrollParameterRelease.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ reviewerId: 'manager', submittedBy: { is: { directManagerId: 'manager' } } });
    expect(query.select).not.toHaveProperty('snapshot');
    await expect(service.assert(prisma, { id: 'manager' }, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    await expect(service.assert(prisma, { id: 'manager' }, 'subject', 'payroll_export')).rejects.toThrow(ForbiddenException);
    prisma.payrollParameterRelease.findMany.mockResolvedValue([{ subjectId: 'subject', subject: { name: 'Fictional subject' }, submittedBy: { payrollGrants: [] } }]);
    expect((await service.getAccess({ id: 'manager' })).subjects).toEqual([]);
  });
});
