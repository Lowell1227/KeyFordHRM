import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { ActionItemsController } from './action-items.controller';

describe('ActionItemsController relationship access', () => {
  it('does not use legacy manager roles as an entry gate', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ActionItemsController)).toBeUndefined();
    for (const method of [
      ActionItemsController.prototype.create,
      ActionItemsController.prototype.update,
      ActionItemsController.prototype.updateProgress,
      ActionItemsController.prototype.remove,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, method)).toBeUndefined();
    }
  });
});
