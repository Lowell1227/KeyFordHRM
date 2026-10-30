import { createHash } from 'node:crypto';
import { selectEmploymentAt, shanghaiBusinessDate } from './employment-timeline';

type RecordValue = Record<string, any>;
export type ArchiveIssueKind = 'conflict' | 'identity' | 'missing' | 'invalid_date' | 'review';
export interface ArchiveIssue {
  id: string; requestId: string; employeeId: string | null; field: string; kind: ArchiveIssueKind;
  message: string; reason: string; source: { sheetName?: string; rowNumber?: number; cell?: string; value: string | null };
  current: { value: string | null }; status: 'open' | 'resolved'; canConfirmCurrent: boolean;
  confirmBlockedReason?: string; fingerprint: string;
  maintenance: { employeeId?: string; requestId: string; draft: boolean };
}
export const archiveIssueSourceSystems = ['roster_initialization', 'roster_reconcile_20261030'];
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const present = (value: unknown): boolean => value != null && (typeof value !== 'string' || value.trim() !== '');
const sensitive = (field: string) => /phone|idNumber|bankAccount|password|secret|token|encrypted|fingerprint/i.test(field);
const allowed = new Set(['employeeNo', 'name', 'companyText', 'contractSubjectId', 'deptId', 'position', 'positionId', 'jobGrade', 'jobFamily',
  'workLocation', 'employeeStatus', 'status', 'employmentType', 'entryDate', 'effectiveFrom', 'effectiveTo', 'leaveDate', 'plannedRegularDate',
  'actualRegularDate', 'managerId', 'directManagerId', 'probationMonths', 'contractType', 'sequence', 'signingCompany', 'originalCompany',
  'newCompany', 'signedAt', 'expiresAt', 'termType', 'housingFundStatus', 'socialSecurityStatus', 'education', 'confidentialityAgreement',
  'nonCompeteAgreement', 'portraitAgreement']);
const redact = (value: string) => value.replace(/(?:\+?86[\s-]?)?1\d{10}/g, '联系电话已隐藏').replace(/\d{15,19}[Xx]?/g, '敏感号码已隐藏').slice(0, 500);
const labels: Record<string, string> = { companyText: '所属公司', newCompany: '新主体', originalCompany: '原主体', employeeNo: '工号',
  signedAt: '签订日期', effectiveFrom: '生效日期', effectiveTo: '结束日期', expiresAt: '到期日期', signingCompany: '签约公司' };
const statuses: Record<string, string> = { active: '在职', probation: '试用期', pending_entry: '待入职', resigned: '已离职' };
const employmentTypes: Record<string, string> = { full_time: '全职', part_time: '兼职', rehire: '返聘', external: '外部用工' };
const displayKey = (field: string) => field.split('.').at(-1) === 'company' ? 'companyText' : field.split('.').at(-1)!;
function display(field: string, value: unknown): string | null {
  if (sensitive(field)) return present(value) ? '敏感信息已隐藏' : null;
  const key = displayKey(field);
  if (!allowed.has(key)) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    if (/^[a-f0-9-]{36}$/i.test(value)) return '已设置（查看档案核对）';
    return ['status', 'employeeStatus'].includes(key) ? statuses[value] ?? redact(value) : key === 'employmentType' ? employmentTypes[value] ?? redact(value) : redact(value);
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).filter(([name, item]) => allowed.has(name) && !sensitive(name) && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'))
      .map(([name, item]) => `${labels[name] ?? '资料'}：${display(name, item) ?? '待补充'}`).join('\n') || null;
  }
  return null;
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value ?? null;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function facts(request: RecordValue, user: RecordValue | null, field: string, warning: RecordValue) {
  const proposal = object(request.proposedValue), employee = object(proposal.employee), profile = object(proposal.profile);
  const history = (user?.employmentHistory ?? []) as RecordValue[];
  const dated = history.filter(item => item.effectiveFrom instanceof Date);
  const today = shanghaiBusinessDate();
  const past = dated.filter(item => item.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  const employment: RecordValue = dated.length ? selectEmploymentAt(dated as any, today).current ?? past[0] ?? {} : history[0] ?? {};
  const key = field.split('.').at(-1)!;
  if (field === 'identity') return null;
  if (field === 'source.employeeNo') return user?.employeeNo ?? request.employeeNo ?? null;
  if (field === 'profile') {
    const required = user ? { deptId: employment.deptId ?? user.deptId, entryDate: employment.entryDate ?? user.entryDate,
      effectiveFrom: employment.effectiveFrom, employeeStatus: employment.employeeStatus ?? user.status,
      employmentType: employment.employmentType ?? user.employmentType } : employee;
    return ['deptId', 'entryDate', 'effectiveFrom', 'employeeStatus', 'employmentType'].every(name => present(required[name])) ? true : null;
  }
  if (!user) return field.startsWith('profile.') ? profile[key] : employee[key];
  if (field.startsWith('contracts.')) return user.employeeContracts?.find((item: RecordValue) => item.id === warning.contractId)?.[key];
  if (field.startsWith('profile.')) return user.employeeProfile?.[key === 'idNumber' ? 'idNumberFingerprint' : key === 'bankAccount' ? 'bankAccountFingerprint' : key];
  if (key === 'employeeNo' || key === 'name') return user[key];
  if (key === 'company') return employment.companyText;
  if (key === 'managerId' || key === 'directManagerId') return employment.directManagerId;
  const profileKey = key === 'idNumber' ? 'idNumberFingerprint' : key === 'bankAccount' ? 'bankAccountFingerprint' : key;
  return user.employeeProfile?.[profileKey] ?? employment[key] ?? user[key] ?? null;
}

export function archiveIssueStates(request: RecordValue, user: RecordValue | null, includeResolved = false): Array<{ issue: ArchiveIssue; warningIndex: number; warningSourceDigest: string }> {
  if (!Array.isArray(request.validationWarnings)) return [];
  const proposal = object(request.proposedValue), result: Array<{ issue: ArchiveIssue; warningIndex: number; warningSourceDigest: string }> = [];
  request.validationWarnings.forEach((raw: unknown, warningIndex: number) => {
    const warning = object(raw); if (typeof warning.field !== 'string' || typeof warning.message !== 'string') return;
    const field = warning.field, key = field.split('.').at(-1)!, draft = !request.userId && request.recordStatus === 'draft';
    const draftMissing = request.sourceSystem === 'roster_reconcile_20261030' && ['employeeStatus', 'employmentType', 'profile'].includes(field);
    const kind: ArchiveIssueKind = field === 'identity' || warning.kind === 'identity' ? 'identity'
      : warning.kind === 'conflict' || warning.code === 'conflict' ? 'conflict'
      : warning.code === 'missing' || draftMissing || field === 'source.employeeNo' ? 'missing'
      : warning.code === 'invalid_date' ? 'invalid_date' : 'review';
    const currentRaw = facts(request, user, field, warning);
    if (kind === 'missing' && present(currentRaw)) return;
    if (kind === 'invalid_date' && present(currentRaw) && (currentRaw instanceof Date || typeof currentRaw === 'string') && Number.isFinite(new Date(currentRaw).getTime())) return;
    const { resolution: _resolution, id: _id, ...warningSource } = warning;
    const id = typeof warning.id === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(warning.id) ? warning.id : digest({ requestId: request.id, warning: warningSource });
    const effectiveSource = { source: warning.source ?? proposal.source ?? null,
      fileHash: object(warning.source).fileHash ?? proposal.sourceFileHash ?? null };
    const fingerprint = digest({ requestId: request.id, version: request.requestVersion ?? 1, id, warning: warningSource, effectiveSource, current: currentRaw });
    const warningSourceDigest = digest({ requestId: request.id, id, warning: warningSource, effectiveSource });
    const canConfirmCurrent = kind === 'conflict' && Boolean(request.userId && user) && request.profileReviewStatus === 'approved' && Boolean(request.appliedAt)
      && allowed.has(key) && !sensitive(field) && present(currentRaw);
    const resolved = kind === 'conflict' && warning.resolution?.decision === 'keep_current' && warning.resolution?.warningSourceDigest === warningSourceDigest;
    if (resolved && !includeResolved) return;
    const source = object(warning.source ?? proposal.source), sourceParent = field.startsWith('profile.') ? object(proposal.profile) : field.startsWith('contracts.')
      ? object((proposal.contracts ?? []).find((item: RecordValue) => item.id === warning.contractId || warning.contractSequence === item.sequence)) : object(proposal.employee);
    const sourceValue = Object.prototype.hasOwnProperty.call(warning, 'sourceValue') ? warning.sourceValue : sourceParent[displayKey(field)];
    const blocked = kind === 'identity' ? '请先核定员工身份，不能仅凭同名确认' : kind === 'missing' || kind === 'invalid_date' || !present(currentRaw)
      ? '请先补充或维护资料，缺项不能直接确认消除' : '该问题须先在现有档案流程中核实处理';
    if (result.some(item => item.issue.id === id)) return;
    result.push({ warningIndex, warningSourceDigest, issue: {
      id, requestId: request.id, employeeId: request.userId ?? null, field, kind,
      message: redact(warning.message), reason: redact(typeof warning.reason === 'string' ? warning.reason : warning.message),
      source: { ...(typeof source.sheetName === 'string' ? { sheetName: source.sheetName.slice(0, 100) } : {}),
        ...(typeof source.rowNumber === 'number' ? { rowNumber: source.rowNumber } : {}), ...(typeof source.cell === 'string' ? { cell: source.cell.slice(0, 40) } : {}), value: display(field, sourceValue) },
      current: { value: display(field, currentRaw) }, status: resolved ? 'resolved' : 'open', canConfirmCurrent,
      ...(!canConfirmCurrent ? { confirmBlockedReason: blocked } : {}), fingerprint,
      maintenance: { ...(request.userId ? { employeeId: request.userId } : {}), requestId: request.id, draft },
    } });
  });
  return result;
}
