import type { Prisma } from '@prisma/client';

export const digestKinds = {
  probation: '试用期到期',
  contract: '合同到期',
  arrival: '到岗待确认',
  returned: '退回待修改',
  archive: '档案待完善',
  resignation: '离职待办理',
} as const;

export interface DigestItem {
  kind: keyof typeof digestKinds;
  id: string;
  employee: string;
  due: string | null;
  next: string;
  link: string;
}

const shanghai = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function digestDay(at: Date) {
  const parts = Object.fromEntries(shanghai.formatToParts(at).map(({ type, value }) => [type, value]));
  return { day: [parts.year, parts.month, parts.day].join('-'), time: [parts.hour, parts.minute].join(':') };
}

export function dateKey(value: Date | string | null | undefined): string | null {
  const key = value instanceof Date ? value.toISOString().slice(0, 10) : value?.slice(0, 10);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(key + 'T00:00:00Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().startsWith(key) ? key : null;
}

export function addDays(day: string, days: number): string {
  const at = new Date(day + 'T00:00:00Z');
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

type Contract = {
  isActive: boolean;
  contractType: string;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
  termType: string | null;
};

export function contractDeadline(contracts: Contract[], day: string, horizon: string): string | null {
  const ranges = contracts.filter(c => c.isActive && ['contract', 'labor', 'renewal', 'transfer'].includes(c.contractType)).flatMap(c => {
    const start = dateKey(c.effectiveFrom);
    const end = dateKey(c.expiresAt) ?? (c.termType?.includes('无固定期限') ? '9999-12-31' : null);
    return start && end && start <= end ? [{ start, end }] : [];
  }).sort((a, b) => a.start.localeCompare(b.start));
  let end: string | null = null;
  for (const range of ranges) {
    if (range.start > day && (!end || end < day || range.start > addDays(end, 1))) break;
    if (!end || range.end > end) end = range.end;
    if (end > horizon) return null;
  }
  return end;
}

type Application = {
  id: string;
  employeeName: string;
  createdById: string;
  intakeType: string | null;
  requiresArrivalConfirmation: boolean;
  onboardingStatus: string | null;
  profileReviewStatus: string;
  performanceReviewStatus: string;
  arrivalConfirmedAt: Date | null;
  proposedValue: Prisma.JsonValue;
};
type JsonObject = { [key: string]: Prisma.JsonValue | undefined };
const object = (v: Prisma.JsonValue | undefined): JsonObject =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const proposalDay = (v: Prisma.JsonValue | undefined) => typeof v === 'string' ? dateKey(v) : null;

export function projectApplication(row: Application, viewer: string, day: string): DigestItem | null {
  const employee = object(object(row.proposedValue).employee);
  const common = { id: row.id, employee: row.employeeName };
  const isResignation = employee.changeType === 'resignation';
  const lifecycleLink = '/entry-exit?requestId=' + row.id;
  if (row.profileReviewStatus === 'rejected' || row.performanceReviewStatus === 'rejected') {
    return row.createdById === viewer ? {
      ...common, kind: 'returned', due: null, next: '按退回意见修改后重提',
      link: row.intakeType || isResignation ? lifecycleLink : '/users?tab=changes&requestId=' + row.id,
    } : null;
  }
  if (row.intakeType && row.requiresArrivalConfirmation && row.onboardingStatus === 'pending_entry'
      && row.profileReviewStatus === 'approved' && !row.arrivalConfirmedAt) {
    const due = proposalDay(row.intakeType === 'reentry' ? employee.effectiveDate : employee.effectiveFrom ?? employee.entryDate);
    return due && due <= day ? { ...common, kind: 'arrival', due,
      next: '由有审核权限的 HR 确认实际到岗', link: '/entry-exit?tab=arrivals&requestId=' + row.id } : null;
  }
  if (isResignation && ['pending', 'applying'].includes(row.profileReviewStatus)) {
    const due = proposalDay(employee.leaveDate ?? employee.effectiveDate);
    return due && due <= addDays(day, 7) ? {
      ...common, kind: 'resignation', due, next: '跟进离职申请审核', link: lifecycleLink,
    } : null;
  }
  return null;
}

export function digestBody(day: string, items: DigestItem[], link: string) {
  const counts = Object.entries(digestKinds).map(([kind, name]) =>
    [name, items.filter(item => item.kind === kind).length] as const);
  const overdue = items.filter(item => item.due && item.due < day).length;
  const title = '余焱玲｜人事待办概况';
  const text = [
    '### ' + title,
    day + ' · ' + (items.length ? '待办 ' + items.length + ' 项（其中逾期 ' + overdue + ' 项）' : '今日暂无待办'),
    counts.map(([name, count]) => name + ' ' + count).join(' · '),
    '[查看 HRM 人事待办](' + link + ')',
  ].join('\n\n');
  return { msgtype: 'markdown', markdown: { title, text } };
}
