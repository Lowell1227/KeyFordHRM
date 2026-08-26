import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import {
  ObjectivesController,
  TRACKING_INDICATOR_UUID_PIPE,
} from './objectives.controller';

describe('ObjectivesController tracking access', () => {
  it('does not use a fixed manager role gate for the controller or business writes', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ObjectivesController)).toBeUndefined();
    for (const method of [
      ObjectivesController.prototype.create,
      ObjectivesController.prototype.update,
      ObjectivesController.prototype.remove,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, method)).toBeUndefined();
    }
  });

  it('lets the service decide tracking visibility for every authenticated account', () => {
    expect(Reflect.getMetadata(
      ROLES_KEY,
      ObjectivesController.prototype.findTracking,
    )).toBeUndefined();
  });

  it('exposes indicator detail and progress routes to every authenticated role', () => {
    const methods = [
      (ObjectivesController.prototype as any).findTrackingIndicator,
      (ObjectivesController.prototype as any).updateTrackingIndicatorProgress,
    ];

    for (const method of methods) {
      expect(typeof method).toBe('function');
      expect(Reflect.getMetadata(ROLES_KEY, method)).toBeUndefined();
    }
  });

  it('exposes objective review routes without granting a broad role override', () => {
    const methods = [
      (ObjectivesController.prototype as any).approveObjective,
      (ObjectivesController.prototype as any).requestObjectiveChanges,
    ];

    for (const method of methods) {
      expect(typeof method).toBe('function');
      expect(Reflect.getMetadata(ROLES_KEY, method)).toBeUndefined();
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
