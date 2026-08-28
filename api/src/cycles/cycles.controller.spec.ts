import { PATH_METADATA } from '@nestjs/common/constants';
import { SysRole } from '@prisma/client';
import { HR_CAPABILITIES_KEY } from '@/common/decorators/hr-capabilities.decorator';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { CyclesController } from './cycles.controller';

describe('CyclesController schedule preview route', () => {
  it('registers the literal schedule-preview route before the :id route', () => {
    const methods = Object.getOwnPropertyNames(CyclesController.prototype);

    expect(Reflect.getMetadata(PATH_METADATA, CyclesController.prototype.previewSchedule)).toBe('schedule-preview');
    expect(methods.indexOf('previewSchedule')).toBeLessThan(methods.indexOf('findOne'));
  });

  it('authorizes cycle review as HR business work without a system-administrator fallback', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CyclesController.prototype.review)).toEqual([SysRole.hr]);
    expect(Reflect.getMetadata(HR_CAPABILITIES_KEY, CyclesController.prototype.review)).toBeUndefined();
  });
});
