import { PATH_METADATA } from '@nestjs/common/constants';
import { CyclesController } from './cycles.controller';

describe('CyclesController schedule preview route', () => {
  it('registers the literal schedule-preview route before the :id route', () => {
    const methods = Object.getOwnPropertyNames(CyclesController.prototype);

    expect(Reflect.getMetadata(PATH_METADATA, CyclesController.prototype.previewSchedule)).toBe('schedule-preview');
    expect(methods.indexOf('previewSchedule')).toBeLessThan(methods.indexOf('findOne'));
  });
});
