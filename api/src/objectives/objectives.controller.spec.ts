import { SysRole } from '@prisma/client';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { ObjectivesController } from './objectives.controller';

describe('ObjectivesController tracking access', () => {
  it('overrides the manager-only controller role list for every authenticated role', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ObjectivesController.prototype.findTracking,
    );
    expect(roles).toEqual([
      SysRole.employee,
      SysRole.manager,
      SysRole.dept_head,
      SysRole.vp,
      SysRole.hr,
      SysRole.chairman,
      SysRole.system_admin,
    ]);
  });

  it('exposes indicator detail and progress routes to every authenticated role', () => {
    const methods = [
      (ObjectivesController.prototype as any).findTrackingIndicator,
      (ObjectivesController.prototype as any).updateTrackingIndicatorProgress,
    ];

    for (const method of methods) {
      expect(typeof method).toBe('function');
      expect(Reflect.getMetadata(ROLES_KEY, method)).toEqual([
        SysRole.employee,
        SysRole.manager,
        SysRole.dept_head,
        SysRole.vp,
        SysRole.hr,
        SysRole.chairman,
        SysRole.system_admin,
      ]);
    }
  });
});
