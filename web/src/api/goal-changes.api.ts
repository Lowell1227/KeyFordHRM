import { isAxiosError } from 'axios';
import http from './http';
import type { LifecycleFilter, LifecycleMetadata } from './performance-lifecycle.api';

export type GoalChangeStatus = 'draft' | 'revision' | 'indicator_reviewing' | 'indicator_dept_reviewing'
  | 'indicator_confirming' | 'indicator_approving' | 'active' | 'revoked';
export interface GoalChangeItem {
  sourceInstanceId: string | null;
  name: string;
  description: string | null;
  scoringStandard: string | null;
  targetValue: number | null;
  targetValueText: string | null;
  unit: string | null;
  weight: number;
  indicatorType: 'kpi' | 'attitude' | 'bonus' | 'penalty' | 'veto';
  dimensionName: string | null;
  dimensionWeight: number;
  sortOrder: number;
}
export interface GoalChangeTask {
  id: string;
  cycleId: string;
  cycleName: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string | null;
  managerId: string | null;
  managerName: string | null;
  grant: { state: 'open' | 'consumed' | 'revoked'; revision: number } | null;
  requestId?: string | null;
  canGrant: boolean;
  canStart: boolean;
}
export interface GoalChangeContext { canGrant: boolean; tasks: GoalChangeTask[] }
export interface GoalChangeRow extends LifecycleMetadata {
  id: string;
  taskId: string;
  employeeId: string;
  managerId: string | null;
  creatorId: string;
  canGrant: boolean;
  workflowIssue: string | null;
  employeeName: string;
  cycleName: string;
  status: GoalChangeStatus;
  revision: number;
  creatorName: string;
  reason: string | null;
  updatedAt: string;
  currentOwnerId: string | null;
  allowedActions: string[];
}
export interface GoalChangeDetail extends GoalChangeRow {
  beforeGoals: GoalChangeItem[];
  goals: GoalChangeItem[];
  records: Array<{ id: string; action: string; actorName: string; createdAt: string; newValue: unknown }>;
  protectedPeriodKeys: string[];
}
export interface GoalChangePage { items: GoalChangeRow[]; total: number; page: number; pageSize: number }
export interface GoalChangeListQuery { scope: 'self' | 'team' | 'review' | 'all'; page: number; pageSize: number; status?: string; keyword?: string; lifecycleStatus?: LifecycleFilter }

// The shared HTTP interceptor unwraps the API envelope.
export const goalChangesApi = {
  context: () => http.get<never, GoalChangeContext>('/goal-changes/context', { skipErrorMessage: true }),
  entry: () => http.get<never, { visible: boolean }>('/goal-changes/entry', { skipErrorMessage: true }),
  myPending: () => http.get<never, GoalChangeRow[]>('/goal-changes/my-pending', { skipErrorMessage: true }),
  page: (query: GoalChangeListQuery) => http.get<never, GoalChangePage>('/goal-changes/page', { params: query, skipErrorMessage: true }),
  list: () => http.get<never, GoalChangeRow[]>('/goal-changes', { skipErrorMessage: true }),
  detail: (id: string) => http.get<never, GoalChangeDetail>(`/goal-changes/${encodeURIComponent(id)}`, { skipErrorMessage: true }),
  grant: (taskId: string, expectedRevision?: number) => http.post('/goal-changes/grants',
    { taskId, ...(expectedRevision === undefined ? {} : { expectedRevision }) }, { skipErrorMessage: true }),
  revokeGrant: (taskId: string, expectedRevision: number) => http.post(`/goal-changes/grants/${encodeURIComponent(taskId)}/revoke`,
    { expectedRevision }, { skipErrorMessage: true }),
  create: (taskId: string) => http.post<never, GoalChangeDetail>('/goal-changes', { taskId }, { skipErrorMessage: true }),
  update: (id: string, body: { expectedRevision: number; reason: string; goals: GoalChangeItem[] }) =>
    http.patch<never, GoalChangeDetail>(`/goal-changes/${encodeURIComponent(id)}`, body, { skipErrorMessage: true }),
  submit: (id: string, body: { expectedRevision: number; reason: string; goals: GoalChangeItem[] }) =>
    http.post(`/goal-changes/${encodeURIComponent(id)}/submit`, body, { skipErrorMessage: true }),
  decide: (id: string, body: { expectedRevision: number; approve: boolean; comment?: string }) =>
    http.post(`/goal-changes/${encodeURIComponent(id)}/decide`, body, { skipErrorMessage: true }),
  revoke: (id: string, expectedRevision: number) => http.post(`/goal-changes/${encodeURIComponent(id)}/revoke`,
    { expectedRevision }, { skipErrorMessage: true }),
};

export function goalChangeError(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    if (error.response?.status === 403) return '无权访问或办理此目标变更，请核对任务范围';
    if (error.response?.status === 404) return '目标变更不存在或已不可访问';
    const message: unknown = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('；');
    if (error.response?.status === 409) return '当前业务状态已变化，请重新加载核对；当前输入仍保留';
  } else if (error instanceof Error && error.message) return error.message;
  return fallback;
}
