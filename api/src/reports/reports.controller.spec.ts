import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { ReportsController } from './reports.controller';

describe('ReportsController dynamic data scope access', () => {
  it('does not require a legacy manager or executive role for cycle summaries', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ReportsController.prototype.getCycleSummary)).toBeUndefined();
  });
});
