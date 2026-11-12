import { ForbiddenException } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';

function setup() {
  const request = { id: 'r1', userId: 'u1', intakeType: 'reentry', recordStatus: 'submitted',
    profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [], proposedValue: {} };
  const tx = {
    employeeDataChangeRequest: {
      findUnique: jest.fn(async () => request),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ data }) => ({ ...request, ...data })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const db = { $transaction: jest.fn(async run => run(tx)) };
  const onboarding = { applyApprovedReentry: jest.fn(async () => 'pending_entry') };
  const service = new EmployeeDataReviewsService(db as any, onboarding as any);
  return { service, db, tx, onboarding };
}

const actor = { id: 'reviewer', name: 'Reviewer', sysRole: SysRole.hr_user,
  deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: ['employee_archive_review'] };

describe('employee approval service permissions', () => {
  it.each([
    { sysRole: SysRole.hr_user, hrCapabilities: [] },
    { sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_edit'] },
    { sysRole: SysRole.employee, hrCapabilities: ['employee_archive_review'] },
  ])('rejects direct approval before persistence for $sysRole/$hrCapabilities, including obsolete options', async permissions => {
    const f = setup();
    for (const scopes of [['profile'], ['performance'], ['profile', 'performance']]) {
      await expect((f.service.approveBatch as any)({ requestIds: ['r1'], scopes },
        { ...actor, ...permissions }, { autoApproved: true })).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.tx.employeeDataChangeRequest.findUnique).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.onboarding.applyApprovedReentry).not.toHaveBeenCalled();
  });

  it.each([SysRole.hr_user, SysRole.hr, SysRole.system_admin])('preserves the existing %s reviewer permission and ordinary audit', async sysRole => {
    const f = setup();
    const operator = { ...actor, sysRole, hrCapabilities: sysRole === SysRole.hr_user ? actor.hrCapabilities : [] };
    expect(await f.service.approveBatch({ requestIds: ['r1'], scopes: ['profile'] }, operator))
      .toEqual({ succeeded: [{ requestId: 'r1', scopes: ['profile'] }], failed: [] });
    expect(f.onboarding.applyApprovedReentry).toHaveBeenCalledTimes(1);
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: {
      userId: operator.id, action: 'approve_employee_data_change',
      entityType: 'employee_data_change_request', entityId: 'r1', newValue: { scopes: ['profile'] },
    } });
  });

  it('does not accept an automatic-approval audit flag from obsolete runtime callers', async () => {
    const f = setup();
    expect(await (f.service.approveBatch as any)({ requestIds: ['r1'], scopes: ['profile'] }, actor, { autoApproved: true }))
      .toEqual({ succeeded: [{ requestId: 'r1', scopes: ['profile'] }], failed: [] });
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ newValue: { scopes: ['profile'] } }) });
  });
});
