import type { EmployeeDataReview } from '@/api/employee-archives.api';
import { contractTitle } from '@/utils/employee-contract-presentation';

type RecordValue = Record<string, unknown>;
export type ReviewNames = Partial<Record<'deptId' | 'positionId' | 'managerId' | 'contractSubjectId', Record<string, string>>>;
export type ReviewDifference = { key: string; label: string; kind: '新增' | '修改' | '清空' | '移除'; before: string; after: string };
export type ReviewDifferenceGroup = { key: string; title: string; kind?: '新增' | '修改' | '移除'; fields: ReviewDifference[] };

// 与申请详情使用相同业务字段；只展示允许公开的字段，不遍历未知或加密信息。
const fieldLabels: Record<string, string> = {
  employeeNo: '工号', name: '姓名', phone: '手机号', company: '组织归属', companyText: '所属公司（合同主体）', contractSubjectId: '合同主体关联',
  deptId: '部门', positionId: '岗位关联', position: '岗位', jobGrade: '职级', jobFamily: '职系', workLocation: '工作地点',
  employeeStatus: '任职状态', status: '任职状态', employmentType: '用工类型', entryDate: '入职日期', effectiveFrom: '生效日期', effectiveDate: '生效日期', effectiveTo: '结束日期', leaveDate: '最后工作日',
  managerId: '花名册直属上级', probationMonths: '试用期（月）', plannedRegularDate: '预计转正日期', actualRegularDate: '实际转正日期', reason: '原因', changeType: '变更类型',
  gender: '性别', birthDate: '出生日期', ethnicity: '民族', education: '学历', professionalTitle: '职称', school: '毕业院校', graduationDate: '毕业日期', major: '专业',
  maritalStatus: '婚姻状况', childrenStatus: '子女状况', childrenCount: '子女数量', politicalStatus: '政治面貌', nativePlace: '籍贯', householdType: '户籍类型', idAddress: '身份证地址', currentAddress: '现住址',
  emergencyContactName: '紧急联系人', emergencyContactRelation: '与联系人关系', emergencyContactPhone: '紧急联系电话', socialSecurityStatus: '社保状态', socialSecurityStartDate: '社保起始日期',
  housingFundStatus: '公积金状态', housingFundStartDate: '公积金起始日期', bankName: '开户行', bankBranch: '开户支行', idNumberConfigured: '身份证', bankAccountConfigured: '银行卡',
};
const contractLabels: Record<string, string> = {
  name: '名称', contractType: '类型', sequence: '顺序', reference: '材料说明', signingCompany: '签约公司', contractSubjectId: '合同主体关联',
  signedAt: '签订日期', effectiveFrom: '生效日期', expiresAt: '到期日期', termType: '期限', originalCompany: '原公司', newCompany: '新公司',
  confidentialityAgreement: '保密协议', nonCompeteAgreement: '竞业协议', portraitAgreement: '肖像协议', images: '图片', attachments: '附件',
};
const dateFields = new Set(['entryDate', 'effectiveFrom', 'effectiveDate', 'effectiveTo', 'leaveDate', 'plannedRegularDate', 'actualRegularDate', 'birthDate', 'graduationDate', 'socialSecurityStartDate', 'housingFundStartDate', 'signedAt', 'expiresAt']);
const enumLabels: Record<string, Record<string, string>> = {
  company: { fuede: '孚德', fuede_sports: '孚德体育文化', beijing_fuede: '北京孚德', fansibao: '凡思堡' },
  employeeStatus: { active: '在职', probation: '试用期', pending_entry: '待入职', resigned: '已离职' },
  employmentType: { full_time: '全职', part_time: '兼职', rehire: '返聘', external: '外部' },
  contractType: { contract: '合同', attachment: '附件', renewal: '续签合同', transfer: '公司变更协议', unclassified: '待分类合同', confidentiality: '保密协议' },
  changeType: { hire: '入职', onboarding: '入职', reentry: '再入职', transfer: '调动', resignation: '离职', regularization: '转正', correction: '档案更正' },
};

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}
function records(value: unknown): RecordValue[] { return Array.isArray(value) ? value.map(record) : []; }
function empty(value: unknown): boolean { return value == null || value === '' || (Array.isArray(value) && value.length === 0); }
function comparable(key: string, value: unknown): string {
  if (empty(value) || (key.endsWith('Configured') && !value)) return '';
  if (dateFields.has(key) && typeof value === 'string') return value.slice(0, 10);
  if (key === 'images' || key === 'attachments') return JSON.stringify(records(value).map(item => [item.name, item.url, item.size, item.mimeType]));
  return JSON.stringify(value);
}
export function employeeReviewValuesEqual(key: string, before: unknown, after: unknown): boolean {
  return comparable(key, before) === comparable(key, after);
}
function text(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }

export function employeeReviewValueDisplay(key: string, value: unknown, source: RecordValue, names: ReviewNames = {}): string {
  if (empty(value) || (key.endsWith('Configured') && !value)) return '未填写';
  if (key === 'phone' || key === 'emergencyContactPhone' || key.endsWith('Configured')) return '已保存';
  if (key === 'deptId') return text(source.departmentName || source.deptName) || names.deptId?.[String(value)] || '已设置（历史名称未记录）';
  if (key === 'positionId') return text(source.positionName || source.position) || names.positionId?.[String(value)] || '已设置（历史岗位未记录）';
  if (key === 'managerId') return text(source.managerName) || names.managerId?.[String(value)] || '已设置（历史姓名未记录）';
  if (key === 'contractSubjectId') return `${text(source.contractSubjectName) || names.contractSubjectId?.[String(value)] || text(source.companyText || source.signingCompany) || '合同主体'} · 已关联`;
  if (key === 'images' || key === 'attachments') return records(value).map(item => text(item.name) || '未命名材料').join('、');
  if (dateFields.has(key)) return text(value).slice(0, 10);
  if (key === 'sequence' && typeof value === 'number') return String(value + 1);
  return enumLabels[key === 'status' ? 'employeeStatus' : key]?.[String(value)] || text(value) || '无法展示';
}

function differences(before: RecordValue, after: RecordValue, labels: Record<string, string>, names: ReviewNames, prefix = '', removed = false): ReviewDifference[] {
  return Object.entries(labels).flatMap(([key, label]) => {
    if (!(key in after) && !removed) return [];
    const previous = before[key], next = after[key];
    if (employeeReviewValuesEqual(key, previous, next)) return [];
    return [{ key: `${prefix}${key}`, label, kind: removed ? '移除' : empty(next) || (key.endsWith('Configured') && !next) ? '清空' : empty(previous) || (key.endsWith('Configured') && !previous) ? '新增' : '修改',
      before: employeeReviewValueDisplay(key, previous, before, names), after: removed ? '已移除' : employeeReviewValueDisplay(key, next, after, names) }];
  });
}

function normalizeContract(value: RecordValue): RecordValue {
  return { ...value, contractType: value.contractType ?? value.kind ?? 'contract', termType: value.termType ?? value.termText };
}

function managerReference(source: RecordValue): RecordValue {
  if (!empty(source.managerId) || !('managerName' in source)) return source;
  // 导入可按姓名提交待解析关系；仅用于对照展示，不把显示名称当成实际用户 ID。
  const name = typeof source.managerName === 'string' ? source.managerName.trim() : '';
  return { ...source, managerId: name ? `name:${name}` : null, managerName: name || null };
}

export function employeeReviewDifferences(request: EmployeeDataReview, names: ReviewNames = {}): ReviewDifferenceGroup[] {
  const groups: ReviewDifferenceGroup[] = [];
  for (const [section, title] of [['employee', '员工任职信息'], ['profile', '员工档案资料'], ['performance', '绩效关系']] as const) {
    const labels = section === 'performance' ? { managerId: '绩效直属上级' } : fieldLabels;
    const before = record(request.baseValue[section]), after = record(request.proposedValue[section]);
    const fields = differences(section === 'profile' ? before : managerReference(before), section === 'profile' ? after : managerReference(after), labels, names, `${section}.`);
    if (fields.length) groups.push({ key: section, title, fields });
  }
  // 未携带 contracts 表示本申请不涉及合同，不能把缺省当作删除全部。
  if (!Array.isArray(request.proposedValue.contracts)) return groups;
  const before = records(request.baseValue.contracts).map(normalizeContract);
  const after = records(request.proposedValue.contracts).map(normalizeContract);
  const matched = new Set<RecordValue>();
  after.forEach((contract, index) => {
    const previous = before.find(item => !matched.has(item) && (contract.id ? item.id === contract.id
      : request.sourceType === 'employee_roster_import' && item.contractType === contract.contractType && item.sequence === contract.sequence));
    if (previous) matched.add(previous);
    const proposed = { ...contract };
    if (previous) {
      // 合同主体缺省沿用正式关联，导入不修改已有上传材料。
      for (const key of Object.keys(contractLabels)) {
        if (!(key in proposed) && key !== 'contractSubjectId' && !(['images', 'attachments'].includes(key) && request.sourceType === 'employee_roster_import')) proposed[key] = null;
      }
    }
    const fields = differences(previous ?? {}, proposed, contractLabels, names);
    if (fields.length) groups.push({ key: text(contract.id) || `new-contract-${index}`, title: contractTitle({ ...previous, ...contract }), kind: previous ? '修改' : '新增', fields });
  });
  before.filter(item => !matched.has(item)).forEach((contract, index) => groups.push({
    key: text(contract.id) || `removed-contract-${index}`, title: contractTitle(contract), kind: '移除', fields: differences(contract, {}, contractLabels, names, '', true),
  }));
  return groups;
}
