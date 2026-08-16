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

type GoalTrackingQuarter = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  priority: number;
};

function parseGoalTrackingQuarter(cycle: AssessmentCycle): GoalTrackingQuarter | null {
  if (cycle.type !== 'quarterly') return null;

  const standard = /^(\d{4})-Q([1-4])$/.exec(cycle.name);
  const historical = /^(\d{4}) Q([1-4]) 绩效考核（历史）$/.exec(cycle.name);
  const match = standard ?? historical;
  if (!match) return null;

  return {
    year: Number(match[1]),
    quarter: Number(match[2]) as GoalTrackingQuarter['quarter'],
    priority: standard ? 2 : 1,
  };
}

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

export function selectGoalTrackingCycles(cycles: AssessmentCycle[]): AssessmentCycle[] {
  const selected = new Map<string, { cycle: AssessmentCycle; quarter: GoalTrackingQuarter }>();

  for (const cycle of cycles) {
    const quarter = parseGoalTrackingQuarter(cycle);
    if (!quarter) continue;
    const key = `${quarter.year}-Q${quarter.quarter}`;
    const existing = selected.get(key);
    if (!existing || quarter.priority > existing.quarter.priority) {
      selected.set(key, { cycle, quarter });
    }
  }

  return [...selected.values()]
    .sort((left, right) =>
      right.quarter.year - left.quarter.year
      || right.quarter.quarter - left.quarter.quarter)
    .map(({ cycle }) => cycle);
}

export function formatGoalTrackingCycleName(cycle: AssessmentCycle): string {
  const quarter = parseGoalTrackingQuarter(cycle);
  if (!quarter) return cycle.name;
  const quarterNames = ['', '第一季度', '第二季度', '第三季度', '第四季度'];
  return `${quarter.year} ${quarterNames[quarter.quarter]}`;
}

export type GoalTrackingHealthStatus = 'on_track' | 'at_risk' | 'blocked' | 'completed';

export function goalTrackingStatus(item: {
  status?: ObjectiveStatus;
  progress: number;
  healthStatus?: GoalTrackingHealthStatus | null;
}) {
  if (item.healthStatus === 'on_track') return '正常';
  if (item.healthStatus === 'at_risk') return '存在风险';
  if (item.healthStatus === 'blocked') return '已阻塞';
  if (item.healthStatus === 'completed') return '已完成';
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
