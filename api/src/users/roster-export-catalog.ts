import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { hasHrCapability, HrCapabilitySubject } from '@/auth/hr-capabilities';

export const ROSTER_EXPORT_GROUPS = [
  { key: 'employment', label: '基本与任职' },
  { key: 'personal', label: '个人与教育' },
  { key: 'contact', label: '身份与联系' },
  { key: 'insurance', label: '社保公积金' },
  { key: 'bank', label: '银行信息' },
  { key: 'contract', label: '最新合同' },
  { key: 'history', label: '合同历史' },
  { key: 'system', label: '系统信息' },
] as const;

/** Order follows the source roster. Additional archive fields are never selected by default. */
export const ROSTER_EXPORT_COLUMNS = [
  { key: 'name', header: '姓名', group: 'employment', width: 14 },
  { key: 'employeeNo', header: '工号', group: 'employment', width: 14 },
  { key: 'companyText', header: '所属公司', group: 'employment', width: 22 },
  { key: 'organization', header: '组织归属', group: 'employment', width: 18 },
  { key: 'departmentLevel1', header: '一级部门', group: 'employment', width: 20 },
  { key: 'departmentLevel2', header: '二级部门', group: 'employment', width: 20 },
  { key: 'departmentLevel3', header: '三级部门', group: 'employment', width: 20 },
  { key: 'deptName', header: '部门', group: 'employment', width: 20 },
  { key: 'position', header: '岗位', group: 'employment', width: 20 },
  { key: 'jobGrade', header: '职级', group: 'employment', width: 12 },
  { key: 'jobFamily', header: '职系', group: 'employment', width: 16 },
  { key: 'rosterManagerName', header: '花名册直属主管', group: 'employment', width: 18 },
  { key: 'directManagerName', header: '绩效直属上级', group: 'employment', width: 18 },
  { key: 'entryDate', header: '入职日期', group: 'employment', width: 14 },
  { key: 'workLocation', header: '工作地点', group: 'employment', width: 22 },
  { key: 'employmentType', header: '用工类型', group: 'employment', width: 12 },
  { key: 'status', header: '任职状态', group: 'employment', width: 12 },
  { key: 'probationMonths', header: '试用期（月）', group: 'employment', width: 14 },
  { key: 'plannedRegularDate', header: '预计转正日期', group: 'employment', width: 14 },
  { key: 'actualRegularDate', header: '实际转正日期', group: 'employment', width: 14 },
  { key: 'leaveDate', header: '离职日期', group: 'employment', width: 14 },
  { key: 'companyTenure', header: '本次司龄', group: 'employment', width: 16 },
  { key: 'phone', header: '手机号', group: 'personal', width: 18 },
  { key: 'gender', header: '性别', group: 'personal', width: 10 },
  { key: 'birthDate', header: '出生日期', group: 'personal', width: 14 },
  { key: 'age', header: '年龄', group: 'personal', width: 10 },
  { key: 'ethnicity', header: '民族', group: 'personal', width: 12 },
  { key: 'education', header: '学历', group: 'personal', width: 14 },
  { key: 'professionalTitle', header: '职称', group: 'personal', width: 20 },
  { key: 'school', header: '毕业院校', group: 'personal', width: 28 },
  { key: 'graduationDate', header: '毕业日期', group: 'personal', width: 14 },
  { key: 'major', header: '专业', group: 'personal', width: 22 },
  { key: 'maritalStatus', header: '婚姻状况', group: 'personal', width: 14 },
  { key: 'childrenStatus', header: '子女状况', group: 'personal', width: 14 },
  { key: 'childrenCount', header: '子女数量', group: 'personal', width: 12 },
  { key: 'politicalStatus', header: '政治面貌', group: 'personal', width: 16 },
  { key: 'nativePlace', header: '籍贯', group: 'contact', width: 22 },
  { key: 'householdType', header: '户籍类型', group: 'contact', width: 16 },
  { key: 'idAddress', header: '身份证地址', group: 'contact', width: 38 },
  { key: 'idNumberConfigured', header: '身份证号录入状态', group: 'contact', width: 20 },
  { key: 'currentAddress', header: '现住址', group: 'contact', width: 38 },
  { key: 'emergencyContactName', header: '紧急联系人', group: 'contact', width: 16 },
  { key: 'emergencyContactRelation', header: '紧急联系人关系', group: 'contact', width: 18 },
  { key: 'emergencyContactPhone', header: '紧急联系人电话', group: 'contact', width: 18 },
  { key: 'email', header: '邮箱', group: 'contact', width: 30 },
  { key: 'socialSecurityStatus', header: '社保状态', group: 'insurance', width: 16 },
  { key: 'socialSecurityStartDate', header: '社保起缴日期', group: 'insurance', width: 14 },
  { key: 'housingFundStatus', header: '公积金状态', group: 'insurance', width: 16 },
  { key: 'housingFundStartDate', header: '公积金起缴日期', group: 'insurance', width: 16 },
  { key: 'bankName', header: '开户行', group: 'bank', width: 22 },
  { key: 'bankBranch', header: '开户支行', group: 'bank', width: 28 },
  { key: 'bankAccountConfigured', header: '银行卡号录入状态', group: 'bank', width: 20 },
  { key: 'latestContractType', header: '合同类型', group: 'contract', width: 14 },
  { key: 'latestContractName', header: '合同名称', group: 'contract', width: 24 },
  { key: 'latestSigningCompany', header: '签约公司', group: 'contract', width: 24 },
  { key: 'latestSignedAt', header: '签订日期', group: 'contract', width: 14 },
  { key: 'latestEffectiveFrom', header: '生效日期', group: 'contract', width: 14 },
  { key: 'latestExpiresAt', header: '到期日期', group: 'contract', width: 14 },
  { key: 'latestTermType', header: '合同期限', group: 'contract', width: 18 },
  { key: 'latestOriginalCompany', header: '原公司', group: 'contract', width: 24 },
  { key: 'latestNewCompany', header: '新公司', group: 'contract', width: 24 },
  { key: 'latestConfidentialityAgreement', header: '保密协议', group: 'contract', width: 14 },
  { key: 'latestNonCompeteAgreement', header: '竞业协议', group: 'contract', width: 14 },
  { key: 'latestPortraitAgreement', header: '肖像协议', group: 'contract', width: 14 },
  { key: 'contractHistory', header: '历史合同明细', group: 'history', width: 20 },
  { key: 'systemPermission', header: '系统权限', group: 'system', width: 18 },
  { key: 'directReportCount', header: '直属下属', group: 'system', width: 12 },
  { key: 'dingtalkBindingState', header: '钉钉登录', group: 'system', width: 16 },
] as const;

export type RosterExportColumnKey = typeof ROSTER_EXPORT_COLUMNS[number]['key'];
const LEGACY_KEYS: ReadonlySet<string> = new Set(['employeeNo', 'name', 'status', 'deptName', 'position',
  'directManagerName', 'systemPermission', 'directReportCount', 'dingtalkBindingState', 'companyTenure']);
export const DEFAULT_ROSTER_EXPORT_COLUMNS: RosterExportColumnKey[] = ROSTER_EXPORT_COLUMNS
  .filter(column => LEGACY_KEYS.has(column.key) && column.key !== 'companyTenure').map(column => column.key);

export function canExportArchiveFields(viewer: HrCapabilitySubject): boolean {
  return hasHrCapability(viewer, 'employee_archive_edit') || hasHrCapability(viewer, 'employee_archive_review');
}

export function rosterExportFieldGroups(viewer: HrCapabilitySubject) {
  const archiveAccess = canExportArchiveFields(viewer);
  return ROSTER_EXPORT_GROUPS.map(group => ({ ...group,
    fields: ROSTER_EXPORT_COLUMNS.filter(column => column.group === group.key && (archiveAccess || LEGACY_KEYS.has(column.key)))
      .map(column => ({ key: column.key, label: column.header, defaultSelected: DEFAULT_ROSTER_EXPORT_COLUMNS.includes(column.key) })),
  })).filter(group => group.fields.length > 0);
}

export function parseRosterExportColumns(value?: string, viewer?: HrCapabilitySubject): RosterExportColumnKey[] {
  if (value === undefined) return [...DEFAULT_ROSTER_EXPORT_COLUMNS];
  if (typeof value !== 'string') throw new BadRequestException('导出字段格式不正确');
  const keys = value.split(',').map(key => key.trim());
  const allowed = new Set<string>(ROSTER_EXPORT_COLUMNS.map(column => column.key));
  if (keys.some(key => !allowed.has(key)) || new Set(keys).size !== keys.length) {
    throw new BadRequestException('请至少选择一个有效的导出字段，且字段不能重复');
  }
  if (viewer && !canExportArchiveFields(viewer) && keys.some(key => !LEGACY_KEYS.has(key))) {
    throw new ForbiddenException('没有导出员工档案详细字段的权限');
  }
  return keys as RosterExportColumnKey[];
}
