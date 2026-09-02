import type { FlowRecord } from '@/types/api.types';
import type { TaskStatus } from '@/types/enums';

function recordType(record: FlowRecord): string {
  return typeof record.extraData?.type === 'string' ? record.extraData.type : '';
}

function byNewest(left: FlowRecord, right: FlowRecord): number {
  return right.createdAt.localeCompare(left.createdAt);
}

export function activeIndicatorReturn(
  status: TaskStatus | undefined,
  records: FlowRecord[] = [],
): FlowRecord | undefined {
  if (status !== 'indicator_drafting') return undefined;
  const latestTransition = [...records]
    .filter((record) => (
      record.action === 'reject'
      || recordType(record) === 'indicator_employee_submitted'
      || recordType(record) === 'indicator_employee_withdrawn'
    ))
    .sort(byNewest)[0];
  return latestTransition?.action === 'reject' ? latestTransition : undefined;
}

export function employeeCanWithdrawIndicators(
  status: TaskStatus | undefined,
  records: FlowRecord[] = [],
): boolean {
  if (status !== 'indicator_reviewing') return false;
  const submission = [...records]
    .filter((record) => recordType(record) === 'indicator_employee_submitted')
    .sort(byNewest)[0];
  if (!submission) return false;
  return !records.some((record) => (
    record.createdAt > submission.createdAt
    && recordType(record) === 'indicator_review_saved'
  ));
}

export function indicatorTaskStatusLabel(
  status: TaskStatus | undefined,
  returned: boolean,
): string {
  if (returned) return '待修改';
  if (status === 'indicator_reviewing') return '待主管审核';
  if (status === 'indicator_confirming') return '待本人确认';
  if (status === 'indicator_drafting' || status === 'indicator_setting') return '草稿';
  return '已确认';
}
