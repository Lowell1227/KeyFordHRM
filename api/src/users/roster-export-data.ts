import { EmploymentInterval, selectEmploymentAt, shanghaiBusinessDate } from '@/employee-archives/employment-timeline';

export type RosterCell = string | number | Date | null;
export interface RosterContract {
  id: string;
  sequence?: number;
  contractType: string;
  name?: string | null;
  signingCompany?: string | null;
  contractSubject?: { name: string } | null;
  signedAt?: Date | null;
  effectiveFrom?: Date | null;
  expiresAt?: Date | null;
  termType?: string | null;
  originalCompany?: string | null;
  newCompany?: string | null;
  confidentialityAgreement?: string | null;
  nonCompeteAgreement?: string | null;
  portraitAgreement?: string | null;
  isActive?: boolean;
  createdAt?: Date;
}
interface RosterEmployment extends EmploymentInterval {
  company?: string;
  companyText?: string | null;
  contractSubject?: { name: string } | null;
  jobGrade?: string | null;
  jobFamily?: string | null;
  workLocation?: string | null;
  directManager?: { name: string } | null;
  probationMonths?: number | null;
  plannedRegularDate?: Date | null;
  actualRegularDate?: Date | null;
  leaveDate?: Date | null;
}
export interface RosterArchiveSource {
  phone?: string | null;
  email?: string | null;
  status: string;
  employmentType?: string;
  entryDate?: Date | null;
  plannedRegularDate?: Date | null;
  actualRegularDate?: Date | null;
  leaveDate?: Date | null;
  dept?: { fullPath?: string | null; name: string; company?: string } | null;
  employeeProfile?: Record<string, unknown> | null;
  employmentHistory?: RosterEmployment[];
}

const COMPANY_LABELS: Record<string, string> = { fuede: '孚德', fuede_sports: '孚德体育文化', beijing_fuede: '北京孚德', fansibao: '凡思堡' };
const EMPLOYMENT_LABELS: Record<string, string> = { full_time: '全职', part_time: '兼职', rehire: '返聘', external: '外包' };
export const CONTRACT_TYPE_LABELS: Record<string, string> = { contract: '首签', renewal: '续签', transfer: '转签', attachment: '附件', unclassified: '待分类', confidentiality: '保密协议' };
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const date = (value: unknown): Date | null => value instanceof Date && Number.isFinite(value.getTime()) ? value : null;

/** Same calendar-date ordering as the archive detail, without treating sequence as chronology. */
export function selectRosterContracts(contracts: readonly RosterContract[] = []) {
  const businessDate = (contract: RosterContract) => (date(contract.effectiveFrom) ?? date(contract.signedAt))?.toISOString().slice(0, 10) ?? '-';
  const sorted = [...contracts].sort((a, b) => Number(Boolean(date(b.effectiveFrom))) - Number(Boolean(date(a.effectiveFrom)))
    || businessDate(b).localeCompare(businessDate(a))
    || (date(b.createdAt)?.getTime() ?? 0) - (date(a.createdAt)?.getTime() ?? 0) || b.id.localeCompare(a.id));
  const latest = sorted.find(contract => contract.isActive !== false && ['contract', 'renewal', 'transfer'].includes(contract.contractType)) ?? null;
  return { latest, history: sorted.filter(contract => contract !== latest) };
}

export function rosterContractDateStatus(contract: RosterContract, at = new Date()): string {
  if (contract.isActive === false) return '旧版本/已移除';
  const start = date(contract.effectiveFrom), end = date(contract.expiresAt);
  if ((contract.effectiveFrom && !start) || (contract.expiresAt && !end) || (start && end && start > end)) return '日期待核';
  const today = shanghaiBusinessDate(at);
  if (end && end < today) return '已到期';
  if (start && start > today) return '待生效';
  if (!start) return '期限待补';
  if (end) return '正常';
  return contract.termType?.includes('无固定期限') ? '无固定期限' : '期限待补';
}

export function rosterContractCells(contract: RosterContract | null): Record<string, RosterCell> {
  if (!contract) return {};
  return {
    sequence: typeof contract.sequence === 'number' ? contract.sequence + 1 : null,
    contractType: CONTRACT_TYPE_LABELS[contract.contractType] ?? contract.contractType,
    name: contract.name ?? '', signingCompany: contract.signingCompany ?? contract.contractSubject?.name ?? '',
    signedAt: date(contract.signedAt), effectiveFrom: date(contract.effectiveFrom), expiresAt: date(contract.expiresAt),
    termType: contract.termType ?? '', originalCompany: contract.originalCompany ?? '', newCompany: contract.newCompany ?? '',
    confidentialityAgreement: contract.confidentialityAgreement ?? '', nonCompeteAgreement: contract.nonCompeteAgreement ?? '',
    portraitAgreement: contract.portraitAgreement ?? '', status: contract.isActive === false ? '已停用' : '未停用',
    dateStatus: rosterContractDateStatus(contract),
  };
}

export function rosterArchiveCells(source: RosterArchiveSource, at = new Date()): Record<string, RosterCell> {
  const today = shanghaiBusinessDate(at);
  const history = source.employmentHistory ?? [];
  const current = selectEmploymentAt(history, today).current ?? (source.status === 'resigned'
    ? [...history].filter(record => record.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
      || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0) || b.id.localeCompare(a.id))[0] : null);
  const profile = source.employeeProfile ?? {};
  const departmentPath = (source.dept?.fullPath ?? source.dept?.name ?? '').split('/').map(value => value.trim()).filter(Boolean);
  const birthDate = date(profile.birthDate);
  let age: number | null = null;
  if (birthDate && birthDate <= today) {
    age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    if (today.getUTCMonth() < birthDate.getUTCMonth() || (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate())) age--;
  }
  const cells: Record<string, RosterCell> = {
    companyText: current?.companyText ?? current?.contractSubject?.name ?? '',
    organization: COMPANY_LABELS[current?.company ?? source.dept?.company ?? ''] ?? '',
    departmentLevel1: departmentPath[0] ?? '', departmentLevel2: departmentPath[1] ?? '', departmentLevel3: departmentPath[2] ?? '',
    jobGrade: current?.jobGrade ?? '', jobFamily: current?.jobFamily ?? '', rosterManagerName: current?.directManager?.name ?? '',
    workLocation: current?.workLocation ?? '', employmentType: EMPLOYMENT_LABELS[source.employmentType ?? ''] ?? source.employmentType ?? '',
    probationMonths: current?.probationMonths ?? null,
    entryDate: date(source.entryDate), plannedRegularDate: date(current?.plannedRegularDate),
    actualRegularDate: date(current?.actualRegularDate), leaveDate: date(current?.leaveDate),
    phone: text(profile.phone) || source.phone || '', email: source.email ?? '', age,
    idNumberConfigured: source.employeeProfile ? (profile.idNumberFingerprint ? '已录入' : '未录入') : '',
    bankAccountConfigured: source.employeeProfile ? (profile.bankAccountFingerprint ? '已录入' : '未录入') : '',
    childrenCount: typeof profile.childrenCount === 'number' ? profile.childrenCount : null,
  };
  for (const key of ['gender', 'ethnicity', 'education', 'professionalTitle', 'school', 'major', 'maritalStatus', 'childrenStatus',
    'politicalStatus', 'nativePlace', 'householdType', 'idAddress', 'currentAddress', 'emergencyContactName', 'emergencyContactRelation',
    'emergencyContactPhone', 'socialSecurityStatus', 'housingFundStatus', 'bankName', 'bankBranch']) cells[key] = text(profile[key]);
  for (const key of ['birthDate', 'graduationDate', 'socialSecurityStartDate', 'housingFundStartDate']) cells[key] = date(profile[key]);
  return cells;
}
