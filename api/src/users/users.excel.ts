import * as ExcelJS from 'exceljs';
import { SystemPermission, UserListItem } from './users.service';

/** 花名册导出列定义（与员工档案页列表字段一致）。 */
export const ROSTER_EXPORT_COLUMNS = [
  { key: 'employeeNo', header: '工号', width: 14 },
  { key: 'name', header: '姓名', width: 14 },
  { key: 'status', header: '任职状态', width: 10 },
  { key: 'deptName', header: '部门', width: 20 },
  { key: 'position', header: '岗位', width: 20 },
  { key: 'directManagerName', header: '绩效直属上级', width: 16 },
  { key: 'systemPermission', header: '系统权限', width: 14 },
  { key: 'directReportCount', header: '直属下属', width: 10 },
  { key: 'dingtalkBindingState', header: '钉钉登录', width: 14 },
] as const;

const STATUS_LABELS: Record<string, string> = {
  active: '在职',
  probation: '试用期',
  pending_entry: '待入职',
  resigned: '已离职',
};

const DINGTALK_LABELS: Record<string, string> = {
  unbound: '未关联',
  enabled: '已关联·启用',
  disabled: '已关联·停用',
};

const SYSTEM_PERMISSION_LABELS: Record<SystemPermission, string> = {
  system_admin: '系统管理员',
  hr_admin: 'HR 管理员',
  hr_user: '普通 HR',
  standard_user: '标准用户',
};

/** 与前端 systemPermissionLabel 同规则，保证导出与页面显示一致。 */
export function rosterSystemPermissionLabel(
  item: Pick<UserListItem, 'sysRole' | 'systemPermission' | 'hrCapabilities' | 'canViewAll'>,
): string {
  let label: string;
  if ((item.systemPermission === 'hr_user' || item.sysRole === 'hr_user')
    && item.hrCapabilities?.includes('cycle_plan_edit') && item.hrCapabilities.includes('performance_publish')) {
    label = '绩效专员';
  } else {
    label = SYSTEM_PERMISSION_LABELS[item.systemPermission] ?? '标准用户';
  }
  return item.canViewAll ? `${label}（全量只读）` : label;
}

export interface RosterExportRow {
  employeeNo: string;
  name: string;
  status: string;
  deptName: string;
  position: string;
  directManagerName: string;
  systemPermission: string;
  directReportCount: number;
  dingtalkBindingState: string;
}

export function toRosterExportRows(items: UserListItem[]): RosterExportRow[] {
  return items.map((item) => ({
    employeeNo: item.employeeNo ?? '',
    name: item.name,
    status: STATUS_LABELS[item.status] ?? item.status,
    deptName: item.deptName ?? '',
    position: item.position ?? '',
    directManagerName: item.directManagerName ?? '',
    systemPermission: rosterSystemPermissionLabel(item),
    directReportCount: item.directReportCount,
    dingtalkBindingState: DINGTALK_LABELS[item.dingtalkBindingState] ?? item.dingtalkBindingState,
  }));
}

/** 构建花名册导出工作簿（单工作表，列与员工档案页列表一致）。 */
export async function buildRosterWorkbook(items: UserListItem[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('花名册');
  worksheet.columns = ROSTER_EXPORT_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));
  for (const row of toRosterExportRows(items)) worksheet.addRow(row);
  return workbook;
}
