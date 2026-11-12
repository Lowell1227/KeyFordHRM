import { EmploymentInterval, selectEmploymentAt, shanghaiBusinessDate } from '@/employee-archives/employment-timeline';

interface TenureEmployment extends EmploymentInterval {
  entryDate: Date | null;
  leaveDate: Date | null;
  employeeStatus?: string;
}

export interface CompanyTenureSubject {
  status: string;
  employmentHistory?: TenureEmployment[];
}

/** Uses approved employment records. effectiveFrom is an interval boundary, never the tenure start. */
export function companyTenure(subject: CompanyTenureSubject, at = new Date()): string {
  if (subject.status === 'pending_entry') return '未到岗';
  const today = shanghaiBusinessDate(at);
  const records = subject.employmentHistory ?? [];
  const selection = selectEmploymentAt(records, today);
  if (selection.matches.length > 1) return '待完善';
  const employment = selection.current ?? (subject.status === 'resigned'
    ? records.filter(record => record.effectiveFrom <= today)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
    : null);
  if (!employment?.entryDate || !Number.isFinite(employment.entryDate.getTime())) return '待完善';
  const currentWorkerStatuses = ['active', 'probation'];
  if (employment.employeeStatus && employment.employeeStatus !== subject.status
    && !(currentWorkerStatuses.includes(subject.status) && currentWorkerStatuses.includes(employment.employeeStatus))) return '待完善';
  const entry = employment.entryDate;
  const end = subject.status === 'resigned' ? employment.leaveDate : today;
  if (!end || !Number.isFinite(end.getTime()) || entry > end || end > today || entry > employment.effectiveFrom) return '待完善';
  if (subject.status !== 'resigned' && employment.leaveDate && employment.leaveDate < today) return '待完善';

  let months = (end.getUTCFullYear() - entry.getUTCFullYear()) * 12 + end.getUTCMonth() - entry.getUTCMonth();
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  if (end.getUTCDate() < Math.min(entry.getUTCDate(), lastDay)) months--;
  if (months < 1) return '不满1个月';
  const years = Math.floor(months / 12);
  return `${years ? `${years}年` : ''}${months % 12 ? `${months % 12}个月` : ''}`;
}
