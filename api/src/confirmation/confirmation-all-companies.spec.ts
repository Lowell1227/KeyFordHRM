import { SysRole } from '@prisma/client';
import { DataScopeService } from '@/common/services/data-scope.service';
import { ConfirmationService } from './confirmation.service';
import type { AuthUser } from '@/common/types/auth.types';

describe('confirmation HR responsibility across companies', () => {
  const handler: AuthUser = { id: 'handler', name: '虚构转正经办', sysRole: SysRole.hr_user,
    deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: ['confirmation_manage'] };

  function fixture() {
    const prisma = {
      employmentRecord: { findMany: jest.fn().mockResolvedValue([
        { userId: 'handler', contractSubjectId: 'company-b' },
        { userId: 'employee', contractSubjectId: 'company-a' },
      ]) },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: handler.id }]),
        count: jest.fn(async ({ where }) => where.AND.every(filter => !filter.id?.in || filter.id.in.includes('employee')) ? 1 : 0),
      },
    };
    const scope = new DataScopeService(prisma as never);
    const service = new ConfirmationService(prisma as never, {} as never, scope, {} as never);
    return { service, scope };
  }

  it('allows an authorized HR handler to view and handle a different company application', async () => {
    const { service } = fixture();
    expect(await (service as any).canViewAsHr('employee', handler)).toBe(true);
    expect(await (service as any).canHandleHr('employee', handler, 'company-approver')).toBe(true);
  });

  it('sends the manager-completed pending notification to the different company HR handler', async () => {
    expect(await (fixture().service as any).hrRecipients('employee', 'company-approver')).toEqual(['handler']);
  });

  it('retains the HR administrator, unauthorized, self and company-approver boundaries', async () => {
    const { service, scope } = fixture();
    expect(await scope.getConfirmationEmployeeFilter({ ...handler, hrCapabilities: [] })).toEqual({ id: { in: [] } });
    expect(await (service as any).canHandleHr('employee', { ...handler, sysRole: SysRole.hr }, 'company-approver')).toBe(false);
    expect(await (service as any).canHandleHr(handler.id, handler, 'company-approver')).toBe(false);
    expect(await (service as any).canHandleHr('employee', handler, handler.id)).toBe(false);
  });
});
