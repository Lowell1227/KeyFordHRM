import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { ApprovalController, ApprovalTaskController } from './approval.controller';

describe('Approval controllers dynamic business authorization', () => {
  it('不使用固定系统角色拦截动态最终审批人', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ApprovalController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, ApprovalTaskController)).toBeUndefined();
  });
});
