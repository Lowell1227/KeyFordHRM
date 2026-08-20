import { TEST_ACCOUNT_MANIFEST } from '../../src/auth/test-accounts';

describe('fixed test account manifest', () => {
  it('包含 8 个唯一测试工号并覆盖完整验收角色', () => {
    expect(TEST_ACCOUNT_MANIFEST).toHaveLength(8);
    expect(new Set(TEST_ACCOUNT_MANIFEST.map((account) => account.employeeNo)).size).toBe(8);
    expect(new Set(TEST_ACCOUNT_MANIFEST.map((account) => account.sysRole))).toEqual(
      new Set(['system_admin', 'hr', 'vp', 'manager', 'employee']),
    );
  });

  it('姓名明确标注为测试身份且不使用原真实姓名', () => {
    const forbiddenRealNames = new Set(['姚瑶', '李宏', '周强', '张晨', '陈明', '王敏', '刘洋']);
    for (const account of TEST_ACCOUNT_MANIFEST) {
      expect(account.name).toMatch(/^测试·/);
      expect(forbiddenRealNames.has(account.name.replace(/^测试·/, ''))).toBe(false);
    }
  });
});
