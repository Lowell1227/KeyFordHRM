import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { AuthUser } from '@/common/types/auth.types';

export const LIFECYCLE_KINDS = ['task', 'goal_change', 'improvement_plan', 'confirmation'] as const;
export type LifecycleKind = typeof LIFECYCLE_KINDS[number];
export type LifecycleStatus = 'active' | 'terminated' | 'deleted';
export type LifecycleFilter = LifecycleStatus | 'all';
export type LifecycleAction = 'terminate' | 'delete';
export interface LifecycleRecord {
  status: string;
  updatedAt: Date;
  lifecycleStatus?: string;
  lifecycleVersion?: number;
  terminatedAt?: Date | null;
  terminatedById?: string | null;
  terminationReason?: string | null;
  deletedAt?: Date | null;
  deletedById?: string | null;
  deletionReason?: string | null;
  publishedAt?: Date | null;
  approvedAt?: Date | null;
  employeeConfirmedAt?: Date | null;
  gradeResult?: { approvedAt?: Date | null; employeeConfirmedAt?: Date | null; publishedAt?: Date | null; isPublished?: boolean } | null;
  closedAt?: Date | null;
  isExempt?: boolean;
  effectiveVersionId?: string | null;
  actualRegularDate?: Date | null;
}

export const LIFECYCLE_SELECT = {
  lifecycleStatus: true, lifecycleVersion: true, terminatedAt: true, terminatedById: true,
  terminationReason: true, deletedAt: true, deletedById: true, deletionReason: true,
} as const;
export const ACTIVE_LIFECYCLE = { lifecycleStatus: 'active' } as const;

export function lifecycleTerminationProtected(kind: LifecycleKind, row: LifecycleRecord): boolean {
  if (row.lifecycleStatus === 'terminated' || row.lifecycleStatus === 'deleted') return true;
  switch (kind) {
    case 'task': return Boolean(row.approvedAt || row.employeeConfirmedAt || row.publishedAt || row.closedAt || row.isExempt
      || row.gradeResult?.approvedAt || row.gradeResult?.employeeConfirmedAt || row.gradeResult?.publishedAt || row.gradeResult?.isPublished
      || ['confirmed', 'appealing', 'published', 'closed', 'exempted'].includes(row.status));
    case 'goal_change': return Boolean(row.effectiveVersionId || ['active', 'revoked'].includes(row.status));
    case 'improvement_plan': return row.status === 'completed';
    case 'confirmation': return Boolean(row.actualRegularDate || ['approved', 'rejected'].includes(row.status));
  }
}

export function lifecycleArchiveReady(kind: LifecycleKind, row: LifecycleRecord): boolean {
  if (row.lifecycleStatus === 'terminated') return true;
  switch (kind) {
    // V5 confirmed still awaits publication; legacy published can still await employee confirmation.
    case 'task': return Boolean(row.isExempt || ['closed', 'exempted'].includes(row.status)
      || (['published', 'confirmed'].includes(row.status) && row.publishedAt && row.employeeConfirmedAt));
    case 'goal_change': return Boolean(row.effectiveVersionId || ['active', 'revoked'].includes(row.status));
    case 'improvement_plan': return row.status === 'completed';
    case 'confirmation': return ['approved', 'rejected'].includes(row.status);
  }
}

export function assertLifecycleActive(row: Pick<LifecycleRecord, 'lifecycleStatus'>): void {
  if (row.lifecycleStatus && row.lifecycleStatus !== 'active') {
    throw new ConflictException('记录已终止或移入历史，不能继续办理，请刷新页面');
  }
}

export function assertLifecycleAction(kind: LifecycleKind, row: LifecycleRecord, action: LifecycleAction): void {
  if (row.lifecycleStatus === 'deleted') throw new ConflictException('记录已移入历史，请刷新页面');
  if (action === 'terminate' && lifecycleTerminationProtected(kind, row)) throw new ConflictException('记录已经结束或生效，不能终止；既有结果保留');
  if (action === 'delete' && !lifecycleArchiveReady(kind, row)) throw new ConflictException('记录尚有未完成办理，不能移入历史');
}

export function canManageLifecycle(viewer: AuthUser, action: 'view' | LifecycleAction): boolean {
  return !viewer.isAssessorOnly && hasHrCapability(viewer, `performance_lifecycle_${action}`);
}

export function lifecycleProjection(kind: LifecycleKind, row: LifecycleRecord, viewer: AuthUser) {
  const allowedActions: string[] = [];
  for (const action of ['terminate', 'delete'] as const) {
    if (!canManageLifecycle(viewer, action)) continue;
    try { assertLifecycleAction(kind, row, action); allowedActions.push(`lifecycle_${action}`); } catch { /* Not eligible. */ }
  }
  return {
    lifecycleStatus: (row.lifecycleStatus ?? 'active') as LifecycleStatus,
    lifecycleVersion: row.lifecycleVersion ?? 0,
    terminatedAt: row.terminatedAt ?? null, terminatedById: row.terminatedById ?? null,
    terminationReason: row.terminationReason ?? null,
    deletedAt: row.deletedAt ?? null, deletedById: row.deletedById ?? null, deletionReason: row.deletionReason ?? null,
    updatedAt: row.updatedAt, allowedActions,
  };
}

// This predicate must be ANDed with, never replace, the original domain scope.
export function lifecycleWhere(filter: LifecycleFilter | undefined, _viewer: AuthUser) {
  if (filter && !['active', 'terminated', 'deleted', 'all'].includes(filter)) throw new BadRequestException('记录状态无效');
  return filter === 'all' ? {} : { lifecycleStatus: filter ?? { not: 'deleted' } };
}
