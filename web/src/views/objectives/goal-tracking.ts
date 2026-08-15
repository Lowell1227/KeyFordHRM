import type { AssessmentCycle, CurrentUser } from '@/types/api.types';
import type { ObjectiveStatus } from '@/types/enums';

export const GOAL_TRACKING_COLUMNS = [
  'latestProgress', 'status', 'progress', 'weight',
] as const;

export type GoalTrackingColumn = (typeof GOAL_TRACKING_COLUMNS)[number];
export type GoalTrackingPerson = { id: string; name: string; avatarUrl?: string };
export type GoalTrackingPeopleGroup = {
  key: 'self' | 'manager';
  label: '我' | '直接上级';
  people: GoalTrackingPerson[];
};

const ACTIVE_CYCLE_STATUSES = new Set([
  'indicator_setting', 'self_eval', 'manager_score',
  'hr_calibration', 'approval', 'appeal',
]);

export function buildTrackingPeople(user: CurrentUser): GoalTrackingPeopleGroup[] {
  const groups: GoalTrackingPeopleGroup[] = [{
    key: 'self',
    label: '我',
    people: [{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }],
  }];
  if (user.directManagerId && user.directManagerName) {
    groups.push({
      key: 'manager',
      label: '直接上级',
      people: [{ id: user.directManagerId, name: user.directManagerName }],
    });
  }
  return groups;
}

export function selectDefaultTrackingCycle(cycles: AssessmentCycle[]) {
  const sorted = [...cycles].sort((left, right) =>
    right.startDate.localeCompare(left.startDate));
  return sorted.find((cycle) => ACTIVE_CYCLE_STATUSES.has(cycle.status)) ?? sorted[0] ?? null;
}

export function goalTrackingStatus(item: { status: ObjectiveStatus; progress: number }) {
  if (item.status === 'archived') return '已归档';
  if (item.status === 'draft') return '未开始';
  if (item.progress >= 100) return '已完成';
  if (item.progress > 0) return '进行中';
  return '未开始';
}

export function parseVisibleColumns(raw: string | null): GoalTrackingColumn[] {
  if (!raw) return [...GOAL_TRACKING_COLUMNS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...GOAL_TRACKING_COLUMNS];
    return GOAL_TRACKING_COLUMNS.filter((column) => parsed.includes(column));
  } catch {
    return [...GOAL_TRACKING_COLUMNS];
  }
}

export function parseCollapsedPeopleGroups(raw: string | null) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) =>
        ['self', 'manager'].includes(key) && typeof value === 'boolean'),
    ) as Partial<Record<'self' | 'manager', boolean>>;
  } catch {
    return {};
  }
}
