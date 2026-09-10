import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { InterviewsController } from './interviews.controller';

describe('InterviewsController HR ledger access', () => {
  it('limits every ledger route to HR and removes employee/signature actions', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InterviewsController)).toEqual(['hr_user', 'hr', 'system_admin']);
    for (const removed of ['findMine', 'managerSign', 'employeeSign', 'findByTaskId']) {
      expect(InterviewsController.prototype).not.toHaveProperty(removed);
    }
  });
});
