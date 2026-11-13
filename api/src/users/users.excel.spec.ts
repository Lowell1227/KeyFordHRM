import { SysRole, UserStatus } from '@prisma/client';
import { toSystemPermission, UserListItem } from './users.service';
import { buildRosterWorkbook, rosterSystemPermissionLabel, toRosterExportRows } from './users.excel';

function item(overrides: Partial<UserListItem> = {}): UserListItem {
  return {
    id: 'u1',
    employeeNo: '347',
    name: '冉光建',
    phone: null,
    email: null,
    avatarUrl: null,
    deptId: 'd1',
    deptName: '直播电商部',
    position: '运营',
    sysRole: SysRole.employee,
    systemPermission: toSystemPermission(SysRole.employee),
    hrCapabilities: [],
    businessIdentities: [],
    status: UserStatus.active,
    employmentType: 'full_time' as UserListItem['employmentType'],
    directManagerId: null,
    directManagerName: '郭志浩',
    directReportCount: 2,
    isAssessorOnly: false,
    canViewAll: false,
    entryDate: null,
    companyTenure: '待完善',
    dingtalkBindingState: 'unbound',
    archivedAt: null,
    matchedHistoricalEmployeeNo: null,
    ...overrides,
  };
}

describe('toRosterExportRows', () => {
  it('maps list fields with page-consistent labels', () => {
    const [row] = toRosterExportRows([item()]);
    expect(row).toEqual({
      employeeNo: '347',
      name: '冉光建',
      status: '在职',
      deptName: '直播电商部',
      position: '运营',
      directManagerName: '郭志浩',
      systemPermission: '标准用户',
      directReportCount: 2,
      dingtalkBindingState: '未关联',
      companyTenure: '待完善',
    });
  });

  it('maps empty values without leaking null', () => {
    const [row] = toRosterExportRows([item({
      employeeNo: null, deptName: null, position: null, directManagerName: null,
      status: UserStatus.resigned, dingtalkBindingState: 'enabled',
    })]);
    expect(row.employeeNo).toBe('');
    expect(row.deptName).toBe('');
    expect(row.position).toBe('');
    expect(row.directManagerName).toBe('');
    expect(row.status).toBe('已离职');
    expect(row.dingtalkBindingState).toBe('已关联·启用');
  });

  it('labels hr_user with cycle capabilities as 绩效专员 and appends 全量只读', () => {
    const specialist = item({ sysRole: SysRole.hr_user, systemPermission: 'hr_user', hrCapabilities: ['cycle_plan_edit', 'performance_publish'] });
    expect(rosterSystemPermissionLabel(specialist)).toBe('绩效专员');
    expect(rosterSystemPermissionLabel({ ...specialist, hrCapabilities: ['cycle_plan_edit'] })).toBe('普通 HR');
    expect(rosterSystemPermissionLabel(item({ canViewAll: true }))).toBe('标准用户（全量只读）');
    expect(rosterSystemPermissionLabel(item({ sysRole: SysRole.hr, systemPermission: 'hr_admin' }))).toBe('HR 管理员');
    expect(rosterSystemPermissionLabel(item({ sysRole: SysRole.system_admin, systemPermission: 'system_admin' }))).toBe('系统管理员');
  });
});

describe('buildRosterWorkbook', () => {
  it('creates one sheet with header row and one row per item', async () => {
    const workbook = await buildRosterWorkbook([item(), item({ id: 'u2', name: '苏萌', employeeNo: '12356' })]);
    const sheet = workbook.getWorksheet('花名册');
    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBe(4); // two header rows + two employees
    const headerValues = (sheet!.getRow(2).values as Array<unknown>).slice(1);
    expect(headerValues).toEqual(['姓名', '工号', '部门', '岗位', '绩效直属上级', '任职状态', '系统权限', '直属下属', '钉钉登录']);
    expect(sheet!.getRow(3).getCell(2).value).toBe('347');
    expect(sheet!.getRow(4).getCell(1).value).toBe('苏萌');
    expect(sheet!.actualRowCount).toBe(4);
  });

  it('produces a parseable xlsx buffer', async () => {
    const workbook = await buildRosterWorkbook([item()]);
    const buffer = await workbook.xlsx.writeBuffer();
    expect(Buffer.byteLength(buffer as ArrayBuffer)).toBeGreaterThan(500);
  });

  it('exports only selected columns in the requested order, including tenure', async () => {
    const workbook = await (buildRosterWorkbook as any)([item({ companyTenure: '1年2个月' } as any)], ['companyTenure', 'name']);
    const sheet = workbook.getWorksheet('花名册')!;
    expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual(['本次司龄', '姓名']);
    expect((sheet.getRow(3).values as unknown[]).slice(1)).toEqual(['1年2个月', '冉光建']);
    expect(sheet.columnCount).toBe(2);
  });
});
