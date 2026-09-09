import { TASK_STATUS_META, type TaskStatus } from '@/types/enums';

type ResultTagType = 'info' | 'primary' | 'success' | 'warning' | 'danger';

export function resultStage(status: TaskStatus, approvedAt?: string | null): { label: string; type: ResultTagType } {
  if (status === 'approval' && approvedAt) return { label: '已审批，待公示', type: 'success' };
  const meta = TASK_STATUS_META[status];
  return { label: meta?.label ?? status, type: (meta?.type ?? 'info') as ResultTagType };
}

export const formatResultScore = (value?: number | null): string => value == null ? '—' : value.toFixed(2);
