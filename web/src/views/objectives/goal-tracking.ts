import type { AssessmentCycle, CurrentUser, PerformanceCycleContext } from '@/types/api.types';
import type { ObjectiveStatus } from '@/types/enums';
import { resolvePerformanceCycle } from '@/utils/performance-cycle';

export const GOAL_TRACKING_COLUMNS = [
  'latestProgress', 'status', 'progress', 'weight',
] as const;

export type GoalTrackingColumn = (typeof GOAL_TRACKING_COLUMNS)[number];
export type GoalTrackingPerson = { id: string; name: string; avatarUrl?: string };
export type GoalTrackingPeopleGroup = {
  key: 'self' | 'manager';
  label: '我' | '绩效直属上级';
  people: GoalTrackingPerson[];
};

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

export function buildTrackingPeople(
  user: CurrentUser,
  selfContexts: PerformanceCycleContext[] = [],
  cycleId = '',
): GoalTrackingPeopleGroup[] {
  const groups: GoalTrackingPeopleGroup[] = [{
    key: 'self',
    label: '我',
    people: [{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }],
  }];
  const context = selfContexts.find((item) => item.id === cycleId) ?? selfContexts[0];
  if (context?.task.manager) {
    groups.push({
      key: 'manager',
      label: '绩效直属上级',
      people: [{ id: context.task.manager.id, name: context.task.manager.name }],
    });
  }
  return groups;
}

export function selectDefaultTrackingCycle(cycles: AssessmentCycle[], today?: string) {
  return resolvePerformanceCycle(cycles, undefined, today).selectedCycle;
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

export type TrackingAction =
  | { kind: 'exempt'; label: string }
  | { kind: 'goal-setting' | 'goal-confirmation'; label: string; taskId: string }
  | { kind: 'review'; label: string; taskId: string; periodId: string }
  | { kind: 'waiting' | 'complete' | 'none'; label: string; taskId: string };

export function selectTrackingAction(context: PerformanceCycleContext): TrackingAction {
  if (context.task.isExempt) return { kind: 'exempt', label: '本周期已豁免' };
  if (['pending', 'indicator_drafting', 'indicator_setting'].includes(context.task.status)) {
    return { kind: 'goal-setting', label: '开始制定', taskId: context.task.id };
  }
  if (context.task.status === 'indicator_confirming') {
    return { kind: 'goal-confirmation', label: '确认目标', taskId: context.task.id };
  }
  if (context.task.status === 'indicator_reviewing') {
    return { kind: 'waiting', label: '等待绩效直属上级审核', taskId: context.task.id };
  }
  const employeePeriod = context.periods.find((period) => (
    period.status === 'self_eval'
    && !period.employeeSubmittedAt
    && !period.managerSubmittedAt
  ));
  if (employeePeriod) {
    return {
      kind: 'review',
      label: employeePeriod.periodType === 'cycle' ? '填写整周期自评' : '填写月度自评',
      taskId: context.task.id,
      periodId: employeePeriod.id,
    };
  }
  if (context.periods.some((period) => period.status === 'manager_scoring' && Boolean(period.employeeSubmittedAt))) {
    return { kind: 'waiting', label: '等待直属上级月度评分', taskId: context.task.id };
  }
  if (context.periods.length > 0 && context.periods.every((period) => ['completed', 'no_result'].includes(period.status))) {
    return { kind: 'complete', label: '月度评分已完成', taskId: context.task.id };
  }
  return { kind: 'none', label: '持续跟进目标', taskId: context.task.id };
}

function dateKey(value: string): string {
  return value.slice(0, 10);
}

function contextPriority(context: PerformanceCycleContext, today: string): number {
  const current = dateKey(context.startDate) <= today && dateKey(context.endDate) >= today;
  if (current && !context.task.isExempt && ['review', 'goal-setting', 'goal-confirmation'].includes(selectTrackingAction(context).kind)) return 0;
  if (current && !context.task.isExempt) return 1;
  if (current && context.task.isExempt) return 2;
  if (dateKey(context.endDate) < today) return 3;
  return 4;
}

export function selectGoalTrackingContexts(
  contexts: PerformanceCycleContext[],
  today = new Date().toISOString().slice(0, 10),
): PerformanceCycleContext[] {
  return [...contexts].sort((left, right) => (
    contextPriority(left, today) - contextPriority(right, today)
    || right.startDate.localeCompare(left.startDate)
    || right.endDate.localeCompare(left.endDate)
    || right.openedAt.localeCompare(left.openedAt)
    || left.id.localeCompare(right.id)
  ));
}

function shortDate(value: string): string {
  const [, month = '', day = ''] = dateKey(value).split('-');
  return `${month}/${day}`;
}

export function formatGoalTrackingContextLabel(context: PerformanceCycleContext): string {
  const mode = context.scoringFrequency === 'monthly' ? '月度自评' : '整周期自评';
  const participation = context.task.isExempt ? '已豁免' : '正常参与';
  return `${context.name}｜${shortDate(context.startDate)}-${shortDate(context.endDate)}｜${mode}｜${participation}`;
}

export function formatGoalTrackingContextMeta(context: PerformanceCycleContext): string {
  return `${context.scoringFrequency === 'monthly' ? '月度自评' : '整周期自评'} · ${context.task.isExempt ? '已豁免' : '正常参与'} · 开放 ${new Date(context.openedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`;
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
