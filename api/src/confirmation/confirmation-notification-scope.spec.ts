import { ConfirmationService } from './confirmation.service';

describe('confirmation HR notifications use current company identity', () => {
  function fixture(records: Array<{ userId: string; contractSubjectId: string | null }>) {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'same-company' }, { id: 'other-company' }, { id: 'legacy-only' }]) },
      employmentRecord: { findMany: jest.fn().mockResolvedValue(records) },
    };
    return { prisma, service: new ConfirmationService(prisma as any, {} as any, {} as any, {} as any) };
  }

  it('notifies only authorized active ordinary HR in the employee current company', async () => {
    const { prisma, service } = fixture([
      { userId: 'employee', contractSubjectId: 'company-a' },
      { userId: 'same-company', contractSubjectId: 'company-a' },
      { userId: 'other-company', contractSubjectId: 'company-b' },
      { userId: 'legacy-only', contractSubjectId: null },
    ]);
    expect(await (service as any).hrRecipients('employee', 'approver')).toEqual(['same-company']);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: {
      id: { notIn: ['employee', 'approver'] }, status: 'active', deletedAt: null,
      sysRole: 'hr_user', hrCapabilities: { has: 'confirmation_manage' },
    }, select: { id: true } });
    expect(prisma.employmentRecord.findMany).toHaveBeenCalled();
  });

  it('does not notify by legacy company or an older company when current identity is missing', async () => {
    const { service } = fixture([
      { userId: 'employee', contractSubjectId: null },
      { userId: 'employee', contractSubjectId: 'company-a' },
      { userId: 'same-company', contractSubjectId: 'company-a' },
    ]);
    expect(await (service as any).hrRecipients('employee', null)).toEqual([]);
  });

  it('does not use an HR historical company after their current company changes', async () => {
    const { service } = fixture([
      { userId: 'employee', contractSubjectId: 'company-a' },
      { userId: 'same-company', contractSubjectId: 'company-b' },
      { userId: 'same-company', contractSubjectId: 'company-a' },
    ]);
    expect(await (service as any).hrRecipients('employee', null)).toEqual([]);
  });
});
