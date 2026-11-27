import http from './http';
import type { CurrentUser } from '@/types/api.types';

export type LifecycleKind = 'task' | 'goal_change' | 'improvement_plan' | 'confirmation';
export type LifecycleStatus = 'active' | 'terminated' | 'deleted';
export type LifecycleFilter = LifecycleStatus | 'all';
export interface PerformanceLifecycle {
  lifecycleStatus: LifecycleStatus;
  lifecycleVersion: number;
  terminatedAt: string | null;
  terminatedById: string | null;
  terminationReason: string | null;
  deletedAt: string | null;
  deletedById: string | null;
  deletionReason: string | null;
  updatedAt: string;
  allowedActions: string[];
  events?: Array<{ id: string; action: 'lifecycle_terminated' | 'lifecycle_deleted'; createdAt: string;
    actorName: string | null; reason: string | null }>;
}
export interface LifecycleMutation {
  expectedUpdatedAt: string;
  expectedLifecycleVersion: number;
  reason: string;
}
export type LifecycleMetadata = Partial<Omit<PerformanceLifecycle, 'updatedAt' | 'allowedActions'>>;
export const performanceLifecycleApi = {
  detail(kind: LifecycleKind, id: string): Promise<PerformanceLifecycle> {
    return http.get(`/performance-lifecycle/${kind}/${encodeURIComponent(id)}`, { skipErrorMessage: true }) as unknown as Promise<PerformanceLifecycle>;
  },
  mutate(kind: LifecycleKind, id: string, action: 'terminate' | 'delete', body: LifecycleMutation): Promise<PerformanceLifecycle> {
    return http.post(`/performance-lifecycle/${kind}/${encodeURIComponent(id)}/${action}`, body, { skipErrorMessage: true }) as unknown as Promise<PerformanceLifecycle>;
  },
};
export function canViewLifecycleHistory(user: CurrentUser | null): boolean {
  // Original ledger APIs retain their own employee/reviewer data scope.
  return !!user;
}
export function canViewLifecycleLedger(user: CurrentUser | null): boolean {
  return !!user && !user.isAssessorOnly && (['hr', 'system_admin'].includes(user.sysRole)
    || (user.sysRole === 'hr_user' && !!user.hrCapabilities?.includes('performance_lifecycle_view')));
}
export function lifecycleLabel(record: LifecycleMetadata): string {
  return record.lifecycleStatus === 'terminated' ? '已终止' : record.lifecycleStatus === 'deleted' ? '已删除' : '';
}
export function lifecycleReadOnly(record: LifecycleMetadata): boolean {
  return !!record.lifecycleStatus && record.lifecycleStatus !== 'active';
}
export function applyLifecycleProjection(record: { allowedActions?: string[] } & LifecycleMetadata, value: PerformanceLifecycle): void {
  const businessActions = value.lifecycleStatus === 'active'
    ? (record.allowedActions ?? []).filter(action => !action.startsWith('lifecycle_')) : [];
  Object.assign(record, value, { allowedActions: [...businessActions, ...value.allowedActions] });
}
export function parseLifecycleFilter(value: unknown): LifecycleFilter | '' {
  return typeof value === 'string' && ['active', 'terminated', 'deleted', 'all'].includes(value) ? value as LifecycleFilter : '';
}
