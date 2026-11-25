import { createHash } from 'node:crypto';
import type { PrismaService } from '@/prisma/prisma.service';
import type { ArchiveIssue } from './employee-archive-issues';
import { shanghaiBusinessDate } from './employment-timeline';
import { explainContractOverlap } from './contract-overlap-explanations';

type Facts = Record<string, any>;
type Context = { at?: Date; proposals?: any[]; exemptions?: Array<{ issueId: string; fingerprint: string; isExempt: boolean; version?: number }> };
const object = (v: any): Facts => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const date = (v: any): string | null => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString().slice(0, 10) : null;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const safeArchiveIssueText = (v: string) => v.replace(/(?:\+?86[\s-]?)?1\d{10}/g, '联系电话已隐藏').replace(/\d{15,19}[Xx]?/g, '敏感号码已隐藏').slice(0, 2000);
export const CURRENT_ARCHIVE_ISSUE_ACTION = 'resolve_employee_archive_current_issue';

/** Current facts are authoritative. Optional blanks and old source differences are not problems. */
export function currentArchiveIssues(user: Facts, context: Context = {}): ArchiveIssue[] {
  if (user.accountType !== 'employee' || user.archivedAt || user.deletedAt) return [];
  const today = date(context.at ?? shanghaiBusinessDate())!;
  const entry = date(user.entryDate), leave = date(user.leaveDate), regular = date(user.actualRegularDate);
  const working = ['active', 'probation'].includes(user.status), profile = object(user.employeeProfile);
  const result: ArchiveIssue[] = [];
  const add = (key: string, field: string, message: string, current: string, reason: string, facts: unknown, contractIds?: string[], fields?: string[]) => {
    const id = `current:${key}`, fingerprint = digest({ employeeId: user.id, id, facts });
    const exemption = context.exemptions?.find(e => e.issueId === id && e.fingerprint === fingerprint);
    if (exemption?.isExempt) return;
    result.push({ id, requestId: '', employeeId: user.id, field, kind: 'review', origin: 'current', message, reason,
      source: { value: null }, current: { value: safeArchiveIssueText(current) }, status: 'open', canConfirmCurrent: false, canExplain: true,
      fingerprint, contractIds, fields: fields ?? [field], exemptionVersion: exemption?.version ?? 0, maintenance: { employeeId: user.id, requestId: '', draft: false } });
  };
  if (!entry) add('entry-missing', 'employee.entryDate', '入职日期待补充', '未填写入职日期', '请补实际入职日期；查不到可继续保留，不要猜填。', null);
  if (!user.deptId) add('department-missing', 'employee.deptId', '所属部门待补充', '未设置所属部门', '请选择实际所属部门；确认不适用时说明原因。', null);
  const regularProblems: string[] = [];
  if (regular && leave && regular > leave) regularProblems.push(`实际转正日${regular}晚于离职日${leave}`);
  if (regular && entry && regular < entry) regularProblems.push(`实际转正日${regular}早于入职日${entry}`);
  if (regularProblems.length) add('regularization', 'employee.actualRegularDate', '转正日期需核对', regularProblems.join('；'), '请区分计划转正与实际转正，分别核对入职、离职和实际转正日期。', { entry, leave, regular });
  const future = [regular && regular > today ? ['实际转正日', regular, 'employee.actualRegularDate'] : null,
    date(profile.housingFundStartDate) && date(profile.housingFundStartDate)! > today ? ['公积金开始日', date(profile.housingFundStartDate), 'profile.housingFundStartDate'] : null,
    date(profile.socialSecurityStartDate) && date(profile.socialSecurityStartDate)! > today ? ['社保开始日', date(profile.socialSecurityStartDate), 'profile.socialSecurityStartDate'] : null].filter(Boolean);
  if (future.length) add('future-actual-dates', future[0]![2]!,
    '实际日期是否误填了计划日期', future.map(v => `${v![0]}：${v![1]}`).join('；'), '这些日期在未来，请确认是否只是计划安排。计划转正日可以在未来；实际已发生信息应分别维护。', future, undefined, future.map(v => v![2]!));
  const contracts = (user.employeeContracts ?? []).filter((c: Facts) => c.isActive !== false && !['attachment', 'confidentiality'].includes(c.contractType));
  const contractFacts = contracts.map((c: Facts) => ({ id: c.id, start: date(c.effectiveFrom), end: date(c.expiresAt), term: c.termType ?? null })).sort((a: Facts, b: Facts) => a.id.localeCompare(b.id));
  const notApplicable = context.proposals?.some(value => object(value).hrConfirmation20261123?.questions?.some((q: Facts) => q.contractApplicability === '不适用'));
  if (!contracts.length && !notApplicable) add('contract-missing', 'contracts', '合同或协议资料待核实', '没有可查看的合同或协议记录', '有合同请补资料；如未签、不适用或历史资料暂缺，请说明实际情况。', []);
  const pairs: string[] = [], overlapping = new Set<string>();
  const details: NonNullable<ArchiveIssue['details']> = [];
  for (let i = 0; i < contracts.length; i++) for (let j = i + 1; j < contracts.length; j++) {
    const a = contracts[i], b = contracts[j], aStart = date(a.effectiveFrom), bStart = date(b.effectiveFrom);
    if (!aStart || !bStart) continue;
    const aEnd = date(a.expiresAt), bEnd = date(b.expiresAt);
    if ((!aEnd && !a.termType?.includes('无固定期限')) || (!bEnd && !b.termType?.includes('无固定期限'))) continue;
    if (aStart <= (bEnd ?? '9999-12-31') && bStart <= (aEnd ?? '9999-12-31')) {
      overlapping.add(a.id); overlapping.add(b.id);
      pairs.push(`${a.name ?? '合同'}（${aStart}至${aEnd ?? '无固定期限'}）与${b.name ?? '合同'}（${bStart}至${bEnd ?? '无固定期限'}）`);
      const explanation = explainContractOverlap(a, b);
      details.push({ title: safeArchiveIssueText(explanation.title), records: safeArchiveIssueText(explanation.records),
        reason: safeArchiveIssueText(explanation.reason), suggestion: safeArchiveIssueText(explanation.suggestion) });
    }
  }
  if (pairs.length) add('contract-overlap', 'contracts', '合同交叠：请核对替代或并存关系', pairs.join('\n'),
    '交叠不一定填错。若转签替代，请补原合同实际结束情况；若确实并存或只是公司变更协议，可说明原因。不会自动截断日期。',
    contractFacts.filter((c: Facts) => overlapping.has(c.id)), [...overlapping]);
  const overlapIssue = result.find(i => i.id === 'current:contract-overlap');
  if (overlapIssue) overlapIssue.details = details;
  const expired = contractFacts.filter((c: Facts) => c.end && c.end < today);
  if (working && expired.length && contractFacts.every((c: Facts) => c.end && c.end < today || c.start && c.start > today)) {
    add('contract-expired', 'contracts', '在岗，但已记录合同已到期', `最新已结束合同到期日：${expired.map((c: Facts) => c.end).sort().at(-1)}`,
      '请补续签、延期或无固定期限信息；尚未签或暂时查不到请据实处理。未来生效的协议不代表今天已经续上。', { status: user.status, contracts: contractFacts, expired: expired.map((c: Facts) => c.id) }, contracts.map((c: Facts) => c.id));
  }
  return result;
}

export const currentArchiveFactsSelect = {
  id: true, accountType: true, archivedAt: true, deletedAt: true, status: true, entryDate: true, leaveDate: true,
  actualRegularDate: true, deptId: true,
  employeeProfile: { select: { housingFundStartDate: true, socialSecurityStartDate: true } },
  employeeContracts: { select: { id: true, isActive: true, contractType: true, effectiveFrom: true, expiresAt: true, termType: true, name: true,
    signingCompany: true, originalCompany: true, newCompany: true } },
} as const;

/** Batched list/filter projection; no writes, decrypted fields or source-to-current mappings. */
export async function loadCurrentArchiveIssues(prisma: Pick<PrismaService, 'user' | 'employeeDataChangeRequest' | 'employeeArchiveIssueExemption'>, userIds: string[]) {
  const output = new Map<string, ArchiveIssue[]>();
  if (!userIds.length) return output;
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, accountType: 'employee', deletedAt: null, archivedAt: null }, select: currentArchiveFactsSelect });
  const eligible = users.filter(u => u.accountType === 'employee' && !u.archivedAt && !u.deletedAt);
  if (!eligible.length) return output;
  const requests = await prisma.employeeDataChangeRequest.findMany({ where: { userId: { in: eligible.map(u => u.id) },
    profileReviewStatus: 'approved', appliedAt: { not: null }, cancelledAt: null }, select: { userId: true, proposedValue: true } });
  const preliminary = new Map(eligible.map(u => [u.id, currentArchiveIssues(u, { proposals: requests.filter(r => r.userId === u.id).map(r => r.proposedValue) })]));
  const affected = [...preliminary].filter(([, items]) => items.length).map(([id]) => id);
  const exemptions = affected.length ? await prisma.employeeArchiveIssueExemption.findMany({ where: { userId: { in: affected } }, select: { userId: true, issueId: true, fingerprint: true, isExempt: true, version: true } }) : [];
  for (const u of eligible) output.set(u.id, currentArchiveIssues(u, {
    proposals: requests.filter(r => r.userId === u.id).map(r => r.proposedValue), exemptions: exemptions.filter(r => r.userId === u.id),
  }));
  return output;
}
