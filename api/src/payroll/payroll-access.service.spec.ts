import { ForbiddenException } from '@nestjs/common';
import { PayrollAccessService } from './payroll-access.service';

describe('payroll live grants and enablement', () => {
  const actor = { id: 'actor', sysRole: 'system_admin', isAssessorOnly: false };
  const setup = (values: Record<string, string>) => {
    const db = { payrollGrant: { findMany: jest.fn().mockResolvedValue([]) } };
    return { db, service: new PayrollAccessService(db as any, { get: (key: string) => values[key] } as any) };
  };
  it('disabled payroll does not query any grants or change ordinary authentication', async () => {
    const { db, service } = setup({});
    expect(await service.getAccess(actor)).toEqual({ enabled: false, subjects: [] });
    await expect(service.assert(db as any, actor, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(db.payrollGrant.findMany).not.toHaveBeenCalled();
  });
  it('global switch alone cannot open the formal channel', async () => {
    const { service } = setup({ PAYROLL_ENABLED: 'true' });
    expect(service.enabled()).toBe(false);
    await expect(service.assertDomain({} as any, 'formal')).rejects.toThrow(ForbiddenException);
  });
  it('checks revoked grants again rather than trusting the menu or JWT', async () => {
    const { db, service } = setup({ PAYROLL_ENABLED: 'true', HRM_PREVIEW: 'true' });
    db.payrollGrant.findMany.mockResolvedValueOnce([{ userId: actor.id, subjectId: 'subject', capabilities: ['payroll_view'], revokedAt: null }] as any);
    await expect(service.assert(db as any, actor, 'subject', 'payroll_view')).resolves.toBeUndefined();
    await expect(service.assert(db as any, actor, 'subject', 'payroll_view')).rejects.toThrow(ForbiddenException);
    expect(db.payrollGrant.findMany).toHaveBeenCalledTimes(2);
  });
});
