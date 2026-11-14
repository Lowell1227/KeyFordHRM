import type { EmployeeArchiveEvent, EmployeeDataReview } from '@/api/employee-archives.api';
import { formatDateTime } from '@/utils/date';
import { completedDirectProfileEvent, isDirectArchiveApplication } from '@/utils/employee-lifecycle';
import { employeeEventDifferences, type ReviewDifferenceGroup } from './employee-review-differences';

export type PersonnelProcessTone = 'success' | 'current' | 'danger' | 'waiting' | 'neutral';

export interface PersonnelProcessDetail {
  key: string;
  title: string;
  status: string;
  tone: PersonnelProcessTone;
  actor?: string;
  time?: string;
}

export interface PersonnelProcessStep {
  key: string;
  title: string;
  status: string;
  tone: PersonnelProcessTone;
  current?: boolean;
  actor?: string;
  time?: string;
  note?: string;
  details?: PersonnelProcessDetail[];
  occurredAt?: string | null;
  eventId?: string;
  eventAction?: string;
  stage?: string;
  differences?: ReviewDifferenceGroup[];
  differenceStatus?: '已记录' | '未记录';
  revisionVersion?: number;
}
function eventPresentation(event: EmployeeArchiveEvent, request?: EmployeeDataReview): Pick<PersonnelProcessStep, 'title' | 'status' | 'tone' | 'stage'> {
  const action = event.action;
  const onboarding = Boolean(request?.intakeType || request?.sourceType === 'manual_employee_create');
  if (/^reopen_/.test(action)) return { title: '恢复入职并重新提交', status: '已提交', tone: 'success' };
  if (action === 'revise_employee_arrival_date') return { title: '修改到岗日期并重新提交', status: '已提交', tone: 'success' };
  if (/^revise_/.test(action)) return { title: '修改并重新提交', status: '已提交', tone: 'success' };
  if (/^reject_/.test(action)) return { title: '退回申请', status: '已退回', tone: 'danger', stage: 'review' };
  if (/^(cancel|withdraw)_/.test(action)) return { title: '取消申请', status: event.newValue?.partial ? '部分已取消' : '已取消', tone: 'danger', stage: 'closed' };
  if (/^approve_/.test(action)) return { title: '档案审核', status: '已通过', tone: 'success', stage: 'review' };
  if (/^submit_/.test(action)) return { title: request && isDirectArchiveApplication(request) ? '提交' : onboarding ? '提交审核' : '提交申请', status: '已提交', tone: 'success', stage: 'submitted' };
  if (action === 'confirm_employee_arrival') return { title: '确认到岗', status: '已完成', tone: 'success', stage: 'waiting-effective' };
  if (action === 'activate_employee_onboarding' || action === 'apply_employee_archive_change') return { title: onboarding ? '入职生效' : '变更生效', status: '已生效', tone: 'success', stage: 'effective' };
  if (action === 'employee_profile_direct_update') {
    if (request && completedDirectProfileEvent(request)?.id === event.id) return { title: '变更生效', status: '已生效', tone: 'success', stage: 'effective' };
    const sameSubmission = request && event.newValue?.requestId === request.id && Number.isInteger(event.newValue.requestVersion)
      && request.events?.some(other => other.action === 'apply_employee_archive_change' && other.newValue?.requestVersion === event.newValue?.requestVersion);
    return { title: '档案资料直接更新', status: sameSubmission ? '同次提交' : '已生效', tone: sameSubmission ? 'neutral' : 'success' };
  }
  if (/draft/.test(action)) return { title: '保存草稿', status: '未提交', tone: 'neutral' };
  if (/^(restore|unarchive)_/.test(action)) return { title: '取消归档', status: '已取消归档', tone: 'neutral' };
  if (/^archive_/.test(action)) return { title: '归档', status: '已归档', tone: 'neutral' };
  return { title: '记录更新', status: '已记录', tone: 'neutral' };
}

function businessOrder(step: PersonnelProcessStep): number {
  const stage = step.stage ?? step.key;
  if (stage === 'submitted') return 10;
  if (/^(revise|reopen)_/.test(step.eventAction ?? '')) return 20;
  return ({ review: 30, 'waiting-effective': 40, effective: 50, closed: 60 } as Record<string, number>)[stage] ?? 0;
}

export function comparePersonnelSteps(left: PersonnelProcessStep, right: PersonnelProcessStep): number {
  const elapsed = (Date.parse(left.occurredAt ?? '') || 0) - (Date.parse(right.occurredAt ?? '') || 0);
  if (elapsed) return elapsed;
  const versionOrder = (left.revisionVersion ?? 0) - (right.revisionVersion ?? 0);
  if (versionOrder) return versionOrder;
  return businessOrder(left) - businessOrder(right) || (left.eventId ?? left.key).localeCompare(right.eventId ?? right.key);
}

export function personnelEventSteps(events: EmployeeArchiveEvent[], request?: EmployeeDataReview): PersonnelProcessStep[] {
  const seen = new Set<string>();
  return events.flatMap(event => {
    if (seen.has(event.id)) return [];
    seen.add(event.id);
    const presentation = eventPresentation(event, request);
    const actor = event.user?.name?.trim() || '未记录';
    const time = formatDateTime(event.createdAt);
    const scopes: string[] = Array.isArray(event.newValue?.scopes) ? event.newValue.scopes : [];
    return [{ key: `event-${event.id}`, eventId: event.id, eventAction: event.action, ...presentation,
      actor, time, occurredAt: event.createdAt,
      ...employeeEventDifferences(event, request),
      note: typeof event.newValue?.reason === 'string' ? event.newValue.reason : undefined,
      details: /^approve_/.test(event.action) ? scopes.filter(scope => ['profile', 'performance'].includes(scope)).map(scope => ({
        key: scope, title: scope === 'profile' ? '基础档案' : '绩效关系', status: presentation.status, tone: presentation.tone, actor, time,
      })) : undefined,
    }];
  }).sort(comparePersonnelSteps);
}
