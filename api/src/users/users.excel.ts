import * as ExcelJS from 'exceljs';
import type { SystemPermission, UserListItem } from './users.service';
import { DEFAULT_ROSTER_EXPORT_COLUMNS, ROSTER_EXPORT_COLUMNS, ROSTER_EXPORT_GROUPS, RosterExportColumnKey } from './roster-export-catalog';
import { RosterCell, RosterContract, rosterContractCells, selectRosterContracts } from './roster-export-data';
export { DEFAULT_ROSTER_EXPORT_COLUMNS, ROSTER_EXPORT_COLUMNS, parseRosterExportColumns } from './roster-export-catalog';
export type { RosterExportColumnKey } from './roster-export-catalog';

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
  companyTenure: string;
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
    companyTenure: item.companyTenure,
  }));
}

export interface RosterWorkbookItem extends UserListItem {
  archiveFields?: Record<string, RosterCell>;
  contracts?: RosterContract[];
}

type SheetColumn = { key: string; header: string; group: string; width: number };
const HISTORY_COLUMNS: SheetColumn[] = [
  { key: 'employeeName', header: '姓名', group: '员工', width: 14 },
  { key: 'employeeNo', header: '工号', group: '员工', width: 14 },
  { key: 'sequence', header: '原记录序号', group: '合同历史', width: 14 },
  { key: 'contractType', header: '合同类型', group: '合同历史', width: 14 },
  { key: 'name', header: '合同名称', group: '合同历史', width: 24 },
  { key: 'signingCompany', header: '签约公司', group: '合同历史', width: 24 },
  { key: 'signedAt', header: '签订日期', group: '合同历史', width: 14 },
  { key: 'effectiveFrom', header: '生效日期', group: '合同历史', width: 14 },
  { key: 'expiresAt', header: '到期日期', group: '合同历史', width: 14 },
  { key: 'termType', header: '合同期限', group: '合同历史', width: 18 },
  { key: 'originalCompany', header: '原公司', group: '合同历史', width: 24 },
  { key: 'newCompany', header: '新公司', group: '合同历史', width: 24 },
  { key: 'confidentialityAgreement', header: '保密协议', group: '合同历史', width: 14 },
  { key: 'nonCompeteAgreement', header: '竞业协议', group: '合同历史', width: 14 },
  { key: 'portraitAgreement', header: '肖像协议', group: '合同历史', width: 14 },
  { key: 'status', header: '停用状态', group: '合同历史', width: 14 },
];

function addRosterSheet(workbook: ExcelJS.Workbook, name: string, columns: SheetColumn[], rows: Record<string, RosterCell>[]) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map(column => ({ key: column.key, width: column.width }));
  sheet.addRow(columns.map(column => column.group));
  sheet.addRow(columns.map(column => column.header));
  let groupStart = 1;
  for (let index = 1; index <= columns.length; index++) {
    if (index === columns.length || columns[index].group !== columns[groupStart - 1].group) {
      if (index > groupStart) sheet.mergeCells(1, groupStart, 1, index);
      groupStart = index + 1;
    }
  }
  for (const data of rows) sheet.addRow(columns.map(column => data[column.key] ?? null));
  const border = { style: 'thin' as const, color: { argb: 'FFE3D5CC' } };
  sheet.eachRow((row, index) => {
    row.height = index === 1 ? 29 : 32;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: '微软雅黑', size: 11, bold: index <= 2, color: { argb: index === 1 ? 'FFFFFFFF' : 'FF303133' } };
      cell.border = { top: border, bottom: border, left: border, right: border };
      cell.alignment = { vertical: 'middle', horizontal: index <= 2 ? 'center' : 'left', wrapText: true };
      if (index <= 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 1 ? 'FFC04F15' : 'FFFBE9DE' } };
      else if (index % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFAF6' } };
      if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd';
      else if (typeof cell.value === 'string') cell.numFmt = '@';
      if (index > 2 && typeof cell.value === 'string') {
        const displayLength = [...cell.value].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
        row.height = Math.max(row.height ?? 32, Math.min(100, Math.ceil(displayLength / (columns[columnNumber - 1].width - 2)) * 17));
      }
    });
  });
  const identityKeys = new Set(['employeeNo', 'name', 'employeeName']);
  let xSplit = 0;
  while (xSplit < columns.length && identityKeys.has(columns[xSplit].key)) xSplit++;
  // Do not freeze every selected column; a one-column export still needs a visible scrollable pane.
  xSplit = Math.min(xSplit, Math.max(0, columns.length - 1));
  sheet.views = [{ state: 'frozen', xSplit, ySplit: 2, showGridLines: false,
    topLeftCell: `${sheet.getColumn(xSplit + 1).letter}3`, activeCell: 'A3' }];
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(2, sheet.rowCount), column: columns.length } };
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, printTitlesRow: '1:2' };
  return sheet;
}

/** Only explicitly selected fields become cells; encrypted/source-evidence data never enters this workbook. */
export async function buildRosterWorkbook(items: RosterWorkbookItem[], columns: RosterExportColumnKey[] = DEFAULT_ROSTER_EXPORT_COLUMNS): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KeyFord HRM';
  const mainColumns = columns.filter(key => key !== 'contractHistory').map(key => {
    const column = ROSTER_EXPORT_COLUMNS.find(candidate => candidate.key === key)!;
    return { ...column, group: ROSTER_EXPORT_GROUPS.find(group => group.key === column.group)!.label };
  });
  const legacyRows = toRosterExportRows(items);
  if (mainColumns.length) {
    const rows = items.map((item, index) => {
      const latest = rosterContractCells(selectRosterContracts(item.contracts).latest);
      return { ...legacyRows[index], ...item.archiveFields,
        latestContractType: latest.contractType, latestContractName: latest.name,
        latestSigningCompany: latest.signingCompany, latestSignedAt: latest.signedAt,
        latestEffectiveFrom: latest.effectiveFrom, latestExpiresAt: latest.expiresAt, latestTermType: latest.termType,
        latestContractStatus: latest.dateStatus,
        latestOriginalCompany: latest.originalCompany, latestNewCompany: latest.newCompany,
        latestConfidentialityAgreement: latest.confidentialityAgreement, latestNonCompeteAgreement: latest.nonCompeteAgreement,
        latestPortraitAgreement: latest.portraitAgreement,
      };
    });
    addRosterSheet(workbook, '花名册', mainColumns, rows);
  }
  if (columns.includes('contractHistory')) {
    const rows = items.flatMap(item => selectRosterContracts(item.contracts).history.map(contract => ({
      ...rosterContractCells(contract), employeeName: item.name, employeeNo: item.employeeNo ?? '',
    })));
    addRosterSheet(workbook, '历史合同', HISTORY_COLUMNS, rows);
  }
  return workbook;
}
