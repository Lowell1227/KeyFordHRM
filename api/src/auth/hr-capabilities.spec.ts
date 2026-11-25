import { hasHrCapability } from './hr-capabilities';

describe('hasHrCapability', () => {
  it.each(['employee', 'hr_user', 'manager', 'hr', 'system_admin'])('requires an explicit %s recruitment demand review grant without granting candidate access', sysRole => {
    expect(hasHrCapability({ sysRole, hrCapabilities: [] }, 'recruitment_demand_review' as never)).toBe(false);
    const subject = { sysRole, hrCapabilities: ['recruitment_demand_review'] };
    expect(hasHrCapability(subject, 'recruitment_demand_review' as never)).toBe(true);
    expect(hasHrCapability(subject, 'recruitment_edit')).toBe(false);
    if (!['hr', 'system_admin'].includes(sysRole)) expect(hasHrCapability(subject, 'recruitment_view')).toBe(false);
    if (sysRole !== 'hr') expect(hasHrCapability(subject, 'talent_hiring_confirm')).toBe(false);
  });
  it.each(['employee', 'hr_user', 'manager', 'hr', 'system_admin'])('keeps %s recruitment editing an explicit grant without mapping it to archive permissions', sysRole => {
    expect(hasHrCapability({ sysRole, hrCapabilities: [] }, 'recruitment_edit' as never)).toBe(false);
    const actor = { sysRole, hrCapabilities: ['recruitment_edit'] };
    expect(hasHrCapability(actor, 'recruitment_edit' as never)).toBe(true);
    expect(hasHrCapability(actor, 'recruitment_view')).toBe(true);
    if (!['hr', 'system_admin'].includes(sysRole)) {
      expect(hasHrCapability(actor, 'employee_archive_edit')).toBe(false);
      expect(hasHrCapability(actor, 'organization_edit')).toBe(false);
      expect(hasHrCapability(actor, 'talent_hiring_confirm')).toBe(false);
    }
  });
  it.each(['employee', 'manager', 'dept_head', 'vp', 'hr_user'])('allows %s an explicit recruitment-only read grant', sysRole => {
    const actor = { sysRole, hrCapabilities: ['recruitment_view'] };
    expect(hasHrCapability(actor, 'recruitment_view')).toBe(true);
    expect(hasHrCapability(actor, 'employee_archive_edit')).toBe(false);
    expect(hasHrCapability(actor, 'employee_archive_review')).toBe(false);
    expect(hasHrCapability(actor, 'talent_hiring_confirm')).toBe(false);
    expect(hasHrCapability({ sysRole, hrCapabilities: [] }, 'recruitment_view')).toBe(false);
  });
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
