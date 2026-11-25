import { ConfirmationService } from './confirmation.service';

describe('confirmation HR notifications follow explicit responsibility across all companies', () => {
  function fixture(records: Array<{ userId: string; contractSubjectId: string | null }>) {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'same-company' }, { id: 'other-company' }, { id: 'legacy-only' }]) },
      employmentRecord: { findMany: jest.fn().mockResolvedValue(records) },
    };
    return { prisma, service: new ConfirmationService(prisma as any, {} as any, {} as any, {} as any) };
  }

  it('notifies authorized active ordinary HR across companies while excluding the employee and company approver', async () => {
    const { prisma, service } = fixture([
      { userId: 'employee', contractSubjectId: 'company-a' },
      { userId: 'same-company', contractSubjectId: 'company-a' },
      { userId: 'other-company', contractSubjectId: 'company-b' },
      { userId: 'legacy-only', contractSubjectId: null },
    ]);
    expect(await (service as any).hrRecipients('employee', 'approver')).toEqual(['same-company', 'other-company', 'legacy-only']);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: {
      id: { notIn: ['employee', 'approver'] }, status: 'active', deletedAt: null,
      sysRole: 'hr_user', hrCapabilities: { has: 'confirmation_manage' },
    }, select: { id: true } });
    expect(prisma.employmentRecord.findMany).not.toHaveBeenCalled();
  });

  it('keeps pending delivery when the employee company identity is missing', async () => {
    const { service } = fixture([
      { userId: 'employee', contractSubjectId: null },
      { userId: 'employee', contractSubjectId: 'company-a' },
      { userId: 'same-company', contractSubjectId: 'company-a' },
    ]);
    expect(await (service as any).hrRecipients('employee', null)).toEqual(['same-company', 'other-company', 'legacy-only']);
  });

  it('returns no recipients when there is no eligible HR handler', async () => {
    const { prisma, service } = fixture([]);
    prisma.user.findMany.mockResolvedValueOnce([]);
    expect(await (service as any).hrRecipients('employee', null)).toEqual([]);
  });
});
