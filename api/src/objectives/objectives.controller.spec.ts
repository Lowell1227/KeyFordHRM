import { SysRole } from '@prisma/client';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import {
  ObjectivesController,
  TRACKING_INDICATOR_UUID_PIPE,
} from './objectives.controller';

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

  it('accepts deterministic UUIDv5 indicator IDs used by realistic demo data', async () => {
    await expect(
      TRACKING_INDICATOR_UUID_PIPE.transform(
        '45ad95e2-febc-597e-9204-6ee7cf50cd65',
        { type: 'param' },
      ),
    ).resolves.toBe('45ad95e2-febc-597e-9204-6ee7cf50cd65');
  });
});
