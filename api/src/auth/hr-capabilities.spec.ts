import { hasHrCapability } from './hr-capabilities';

describe('hasHrCapability', () => {
  it('reserves hiring confirmation for HR administrators or explicit grants', () => {
    expect(hasHrCapability({ sysRole: 'hr' }, 'talent_hiring_confirm')).toBe(true);
    expect(hasHrCapability({ sysRole: 'system_admin' }, 'talent_hiring_confirm')).toBe(false);
    expect(hasHrCapability({ sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] }, 'talent_hiring_confirm')).toBe(false);
    expect(hasHrCapability({ sysRole: 'hr_user', hrCapabilities: ['talent_hiring_confirm'] }, 'talent_hiring_confirm')).toBe(true);
  });
  it.each(['hr', 'system_admin'])('%s 默认拥有全部 HR 能力', (sysRole) => {
    expect(hasHrCapability({ sysRole, hrCapabilities: [] }, 'organization_edit')).toBe(true);
  });

  it('普通 HR 只拥有明确授予的能力', () => {
    const subject = { sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
    expect(hasHrCapability(subject, 'employee_archive_edit')).toBe(true);
    expect(hasHrCapability(subject, 'employee_archive_review')).toBe(false);
  });

  it('普通员工不能通过伪造能力列表获得 HR 权限', () => {
    expect(hasHrCapability(
      { sysRole: 'employee', hrCapabilities: ['cycle_plan_edit'] },
      'cycle_plan_edit',
    )).toBe(false);
  });
});
