import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { InterviewsController } from './interviews.controller';

describe('InterviewsController dynamic responsibility access', () => {
  it('does not block an assigned interviewer because of their system role', () => {
    for (const method of [
      InterviewsController.prototype.findAll,
      InterviewsController.prototype.update,
      InterviewsController.prototype.managerSign,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, method)).toBeUndefined();
    }
  });
});
