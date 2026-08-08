import { computed, type ComputedRef } from 'vue';
import {
  useRoute,
  useRouter,
  type LocationQuery,
  type LocationQueryValue,
  type NavigationFailure,
  type Router,
} from 'vue-router';
import type { TaskWorkspaceQuery } from '../../types/api.types';

const scopes = new Set<TaskWorkspaceQuery['scope']>(['mine', 'team']);
const stages = new Set<TaskWorkspaceQuery['stage']>(['goal-review', 'manager-eval']);
const stageStates = new Set<NonNullable<TaskWorkspaceQuery['stageState']>>([
  'not_started',
  'pending',
  'completed',
  'exempted',
]);

function firstNonEmptyValue(value: LocationQueryValue | LocationQueryValue[] | undefined): string | undefined {
  const firstValue = Array.isArray(value) ? value[0] : value;
  if (typeof firstValue !== 'string') return undefined;
  const normalized = firstValue.trim();
  return normalized || undefined;
}

function toStableQuery(state: TaskWorkspaceQuery): Record<string, string> {
  const query: Record<string, string> = {
    scope: state.scope,
    stage: state.stage,
  };

  for (const key of ['cycleId', 'deptId', 'employeeId', 'taskId', 'stageState', 'keyword'] as const) {
    const value = state[key];
    if (value) query[key] = value;
  }

  return query;
}

function matchesStableQuery(current: LocationQuery, next: Record<string, string>): boolean {
  const currentEntries = Object.entries(current);
  const nextEntries = Object.entries(next);
  return (
    currentEntries.length === nextEntries.length &&
    currentEntries.every(([key, value], index) => {
      const [nextKey, nextValue] = nextEntries[index] ?? [];
      return key === nextKey && value === nextValue;
    })
  );
}

export function parseTaskWorkspaceQuery(query: LocationQuery): TaskWorkspaceQuery {
  const scope = firstNonEmptyValue(query.scope);
  const stage = firstNonEmptyValue(query.stage);
  const stageState = firstNonEmptyValue(query.stageState);

  return {
    scope: scope && scopes.has(scope as TaskWorkspaceQuery['scope']) ? (scope as TaskWorkspaceQuery['scope']) : 'mine',
    stage: stage && stages.has(stage as TaskWorkspaceQuery['stage']) ? (stage as TaskWorkspaceQuery['stage']) : 'goal-review',
    cycleId: firstNonEmptyValue(query.cycleId),
    deptId: firstNonEmptyValue(query.deptId),
    employeeId: firstNonEmptyValue(query.employeeId),
    taskId: firstNonEmptyValue(query.taskId),
    stageState:
      stageState && stageStates.has(stageState as NonNullable<TaskWorkspaceQuery['stageState']>)
        ? (stageState as NonNullable<TaskWorkspaceQuery['stageState']>)
        : undefined,
    keyword: firstNonEmptyValue(query.keyword),
  };
}

export function updateTaskWorkspaceQuery(
  router: Router,
  current: LocationQuery,
  patch: Partial<TaskWorkspaceQuery>,
): Promise<NavigationFailure | void | undefined> {
  const next = toStableQuery(parseTaskWorkspaceQuery({ ...current, ...patch }));
  if (matchesStableQuery(current, next)) return Promise.resolve(undefined);
  return router.replace({ query: next });
}

export function useTaskWorkspaceQuery(): {
  state: ComputedRef<TaskWorkspaceQuery>;
  update: (patch: Partial<TaskWorkspaceQuery>) => Promise<NavigationFailure | void | undefined>;
} {
  const route = useRoute();
  const router = useRouter();
  const state = computed(() => parseTaskWorkspaceQuery(route.query));
  const update = (patch: Partial<TaskWorkspaceQuery>) => updateTaskWorkspaceQuery(router, route.query, patch);
  return { state, update };
}
