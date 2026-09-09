import type { TaskStatus } from '@/types/enums';

export interface ResultConfirmationSource {
  status: TaskStatus;
  isExempt?: boolean;
  approvedAt?: string | null;
  publishedAt?: string | null;
  employeeConfirmedAt?: string | null;
  gradeResult?: { isPublished?: boolean; publishedAt?: string | null; approvedAt?: string | null; employeeConfirmedAt?: string | null } | null;
}

export function isResultPublished(task: ResultConfirmationSource): boolean {
  return Boolean(task.publishedAt || task.gradeResult?.publishedAt || task.gradeResult?.isPublished)
    || ['published', 'appealing', 'closed'].includes(task.status);
}

export function isApprovedResultAvailable(task: ResultConfirmationSource): boolean {
  return isResultPublished(task)
    || (['approval', 'confirmed'].includes(task.status) && Boolean(task.approvedAt ?? task.gradeResult?.approvedAt));
}

export function needsEmployeeResultConfirmation(task: ResultConfirmationSource): boolean {
  if (task.isExempt || task.employeeConfirmedAt || task.gradeResult?.employeeConfirmedAt) return false;
  return (task.status === 'approval' && Boolean(task.approvedAt ?? task.gradeResult?.approvedAt))
    || task.status === 'published';
}
