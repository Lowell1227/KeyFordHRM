export const TEST_ACCOUNT_MANIFEST = [
  { employeeNo: 'ADMIN', name: '测试·系统管理员', sysRole: 'system_admin', roleLabel: '系统管理员' },
  { employeeNo: 'HR001', name: '测试·姚遥', sysRole: 'hr', roleLabel: 'HR 管理员' },
  { employeeNo: 'VP001', name: '测试·李弘', sysRole: 'employee', roleLabel: '最终业务审批场景' },
  { employeeNo: 'MGR001', name: '测试·周强明', sysRole: 'employee', roleLabel: '绩效直属上级场景' },
  { employeeNo: 'EMP001', name: '测试·张辰', sysRole: 'employee', roleLabel: '员工目标审核场景' },
  { employeeNo: 'EMP002', name: '测试·陈铭', sysRole: 'employee', roleLabel: '员工自评场景' },
  { employeeNo: 'EMP003', name: '测试·王敏宁', sysRole: 'employee', roleLabel: '主管评分场景' },
  { employeeNo: 'EMP004', name: '测试·刘扬', sysRole: 'employee', roleLabel: '结果查看场景' },
] as const;

export type TestAccountManifestItem = (typeof TEST_ACCOUNT_MANIFEST)[number];

export function findTestAccount(employeeNo: string): TestAccountManifestItem | undefined {
  return TEST_ACCOUNT_MANIFEST.find((account) => account.employeeNo === employeeNo);
}
