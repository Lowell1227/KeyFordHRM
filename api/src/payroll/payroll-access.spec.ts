import { ForbiddenException } from '@nestjs/common';
import { assertPayrollGrant, payrollAccess } from './payroll-access';

describe('independent subject payroll access', () => {
  const actor = { id: 'actor', sysRole: 'hr', isAssessorOnly: false };
  const grant = { userId: 'actor', subjectId: 'subject', capabilities: ['payroll_view', 'payroll_export'], revokedAt: null };
  it('never grants HR/admin/global viewers payroll automatically', () => {
    for (const sysRole of ['hr', 'system_admin', 'hr_user', 'employee']) {
      expect(() => assertPayrollGrant({ ...actor, sysRole, canViewAll: true }, [], 'subject', 'payroll_view', true)).toThrow(ForbiddenException);
    }
  });
  it('requires live grant, exact subject and action, active feature and non-assessor identity', () => {
    expect(() => assertPayrollGrant(actor, [grant], 'subject', 'payroll_export', true)).not.toThrow();
    expect(() => assertPayrollGrant(actor, [grant], 'other', 'payroll_export', true)).toThrow(ForbiddenException);
    expect(() => assertPayrollGrant(actor, [grant], 'subject', 'payroll_edit', true)).toThrow(ForbiddenException);
    expect(() => assertPayrollGrant(actor, [{ ...grant, revokedAt: new Date() }], 'subject', 'payroll_view', true)).toThrow(ForbiddenException);
    expect(() => assertPayrollGrant(actor, [grant], 'subject', 'payroll_view', false)).toThrow(ForbiddenException);
    expect(() => assertPayrollGrant({ ...actor, isAssessorOnly: true }, [grant], 'subject', 'payroll_view', true)).toThrow(ForbiddenException);
    expect(() => assertPayrollGrant({ ...actor, id: 'other' }, [grant], 'subject', 'payroll_view', true)).toThrow(ForbiddenException);
  });
  it('does not leak grants across viewers and rejects unknown capabilities', () => {
    expect(payrollAccess(actor, [grant, { ...grant, userId: 'other', subjectId: 'hidden' }], true).subjects).toEqual([
      { id: 'subject', name: 'subject', capabilities: ['payroll_view', 'payroll_export'] },
    ]);
    expect(payrollAccess(actor, [{ ...grant, capabilities: ['bogus'] }], true).subjects).toEqual([]);
    expect(payrollAccess(actor, [grant], false)).toEqual({ enabled: false, subjects: [] });
  });
});
