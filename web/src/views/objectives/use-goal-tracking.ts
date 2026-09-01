import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { cyclesApi } from '@/api/cycles.api';
import { objectivesApi } from '@/api/objectives.api';
import { useAuthStore } from '@/stores/auth.store';
import type {
  AssessmentCycle,
  GoalTrackingItem,
  GoalTrackingResult,
  PerformanceCycleContext,
} from '@/types/api.types';
import {
  buildTrackingPeople,
  selectGoalTrackingContexts,
} from './goal-tracking';

export function useGoalTracking() {
  const route = useRoute();
  const router = useRouter();
  const auth = useAuthStore();
  const contexts = ref<PerformanceCycleContext[]>([]);
  const selfContexts = ref<PerformanceCycleContext[]>([]);
  const selectedPersonId = ref('');
  const selectedCycleId = ref('');
  const result = ref<GoalTrackingResult>({ totalWeight: 0, items: [] });
  const cyclesLoading = ref(false);
  const cyclesError = ref('');
  const loading = ref(false);
  const error = ref('');
  const notice = ref('');
  const highlightedObjectiveId = ref('');
  let requestSerial = 0;
  let contextRequestSerial = 0;
  let navigationGeneration = 0;
  let lifecycleGeneration = 0;
  let disposed = false;

  function captureLifecycle() {
    const generation = lifecycleGeneration;
    return () => !disposed && generation === lifecycleGeneration;
  }

  const peopleGroups = computed(() => auth.user
    ? buildTrackingPeople(auth.user, selfContexts.value, selectedCycleId.value)
    : []);
  const people = computed(() => peopleGroups.value.flatMap((group) => group.people));
  const selectedPerson = computed(() =>
    people.value.find((person) => person.id === selectedPersonId.value) ?? people.value[0] ?? null);
  const selectedContext = computed(() =>
    contexts.value.find((context) => context.id === selectedCycleId.value) ?? null);

  async function writeQuery(
    mode: 'push' | 'replace',
    commitGuard = captureLifecycle(),
    preserveIndicator = false,
  ) {
    if (!commitGuard()) return;
    const navigate = mode === 'push' ? router.push : router.replace;
    await navigate({
      query: {
        employeeId: selectedPersonId.value || undefined,
        cycleId: selectedCycleId.value || undefined,
        indicatorId: preserveIndicator && typeof route.query.indicatorId === 'string'
          ? route.query.indicatorId
          : undefined,
      },
    });
  }

  async function resolveObjectiveDeepLink(
    objectiveId: string,
    lifecycleGuard = captureLifecycle(),
  ) {
    const generation = ++navigationGeneration;
    const isCurrent = () => lifecycleGuard() && generation === navigationGeneration;
    if (!isCurrent()) return true;
    let objective: GoalTrackingItem | undefined;
    try {
      const deepLink = await objectivesApi.getTracking({ objectiveId });
      if (!isCurrent()) return true;
      objective = deepLink.items[0];
    } catch {
      if (!isCurrent()) return true;
      notice.value = '无法定位该目标所属人员和考核周期';
      return false;
    }
    if (!objective?.ownerId || !objective.cycleId || !people.value.some((person) => person.id === objective.ownerId)) {
      notice.value = '无法定位该目标所属人员和考核周期';
      return false;
    }
    notice.value = '';
    selectedPersonId.value = objective.ownerId;
    await loadContexts(objective.ownerId, isCurrent);
    if (!isCurrent()) return true;
    if (!contexts.value.some((context) => context.id === objective?.cycleId)) {
      notice.value = '无法定位该目标所属人员和考核周期';
      return false;
    }
    selectedCycleId.value = objective.cycleId;
    highlightedObjectiveId.value = '';
    await writeQuery('replace', isCurrent);
    if (!isCurrent()) return true;
    await loadTracking(isCurrent);
    if (!isCurrent()) return true;
    return true;
  }

  async function loadTracking(commitGuard = captureLifecycle()) {
    if (!commitGuard() || !selectedPersonId.value || !selectedCycleId.value) return;
    const serial = ++requestSerial;
    const canCommit = () => serial === requestSerial && commitGuard();
    result.value = { totalWeight: 0, items: [] };
    loading.value = true;
    error.value = '';
    try {
      const next = await objectivesApi.getTracking({
        ownerId: selectedPersonId.value,
        cycleId: selectedCycleId.value,
      });
      if (canCommit()) result.value = next;
    } catch {
      if (canCommit()) error.value = '考核指标加载失败';
    } finally {
      if (canCommit()) loading.value = false;
    }
  }

  function legacyContext(cycle: AssessmentCycle): PerformanceCycleContext {
    return {
      id: cycle.id,
      name: cycle.name,
      type: cycle.type,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      openedAt: cycle.openedAt ?? cycle.updatedAt ?? cycle.createdAt ?? `${cycle.startDate}T00:00:00.000Z`,
      scoringFrequency: cycle.scoringFrequency ?? 'cycle',
      task: {
        id: `legacy-${cycle.id}`,
        status: 'goal_confirmed',
        isExempt: false,
        exemptReason: null,
        participantDisposition: 'active',
        manager: null,
      },
      periods: [],
    };
  }

  async function loadContexts(ownerId: string, commitGuard = captureLifecycle()) {
    if (!commitGuard()) return;
    const serial = ++contextRequestSerial;
    const canCommit = () => serial === contextRequestSerial && commitGuard();
    cyclesLoading.value = true;
    cyclesError.value = '';
    try {
      let next: PerformanceCycleContext[];
      try {
        next = await cyclesApi.findTrackingContexts(ownerId);
      } catch {
        // 旧环境兼容：新接口上线前仍可读取原周期列表，正式环境优先使用冻结任务上下文。
        const page = await cyclesApi.findAll({ page: 1, pageSize: 100 });
        next = page.items.map(legacyContext);
      }
      if (canCommit()) {
        contexts.value = selectGoalTrackingContexts(next);
        if (ownerId === auth.user?.id) selfContexts.value = contexts.value;
      }
    } catch {
      if (canCommit()) {
        contexts.value = [];
        cyclesError.value = '考核周期加载失败';
      }
    } finally {
      if (canCommit()) cyclesLoading.value = false;
    }
  }

  async function normalizeSelectionAndLoad(commitGuard = captureLifecycle()) {
    if (!commitGuard()) return;
    const selfId = auth.user?.id ?? '';
    selectedPersonId.value = selfId;
    await loadContexts(selfId, commitGuard);
    if (!commitGuard() || cyclesError.value) return;
    selectedCycleId.value = typeof route.query.cycleId === 'string'
      && selfContexts.value.some((context) => context.id === route.query.cycleId)
      ? route.query.cycleId
      : selfContexts.value[0]?.id ?? '';

    const objectiveId = typeof route.query.objectiveId === 'string'
      ? route.query.objectiveId
      : '';
    if (objectiveId && await resolveObjectiveDeepLink(objectiveId, commitGuard)) return;
    if (!commitGuard()) return;

    const requestedPersonId = typeof route.query.employeeId === 'string'
      && people.value.some((person) => person.id === route.query.employeeId)
      ? route.query.employeeId
      : selfId;
    if (requestedPersonId !== selfId) {
      const preferredCycleId = selectedCycleId.value;
      selectedPersonId.value = requestedPersonId;
      await loadContexts(requestedPersonId, commitGuard);
      if (!commitGuard() || cyclesError.value) return;
      selectedCycleId.value = contexts.value.some((context) => context.id === preferredCycleId)
        ? preferredCycleId
        : contexts.value[0]?.id ?? '';
    }
    await writeQuery('replace', commitGuard, true);
    if (!commitGuard()) return;
    await loadTracking(commitGuard);
  }

  async function retryCycles() {
    const isCurrent = captureLifecycle();
    await loadContexts(selectedPersonId.value || auth.user?.id || '', isCurrent);
    if (!isCurrent() || cyclesError.value) return;
    selectedCycleId.value = contexts.value.some((context) => context.id === selectedCycleId.value)
      ? selectedCycleId.value
      : contexts.value[0]?.id ?? '';
    await writeQuery('replace', isCurrent, true);
    await loadTracking(isCurrent);
  }

  async function selectPerson(id: string) {
    const isCurrent = captureLifecycle();
    if (!isCurrent()) return;
    navigationGeneration += 1;
    notice.value = '';
    highlightedObjectiveId.value = '';
    selectedPersonId.value = id;
    await loadContexts(id, isCurrent);
    if (!isCurrent()) return;
    selectedCycleId.value = contexts.value[0]?.id ?? '';
    await writeQuery('push', isCurrent);
    if (!isCurrent()) return;
    await loadTracking(isCurrent);
  }

  async function selectCycle(id: string) {
    const isCurrent = captureLifecycle();
    if (!isCurrent()) return;
    navigationGeneration += 1;
    notice.value = '';
    highlightedObjectiveId.value = '';
    selectedCycleId.value = id;
    if (!people.value.some((person) => person.id === selectedPersonId.value)) {
      selectedPersonId.value = auth.user?.id ?? '';
      contexts.value = selfContexts.value;
    }
    await writeQuery('push', isCurrent);
    if (!isCurrent()) return;
    await loadTracking(isCurrent);
  }

  watch(
    () => [route.query.employeeId, route.query.cycleId] as const,
    async ([employeeId, cycleId]) => {
      const isCurrent = captureLifecycle();
      if (!isCurrent()) return;
      if (typeof employeeId !== 'string' || typeof cycleId !== 'string') return;
      if (!people.value.some((person) => person.id === employeeId)) return;
      if (!contexts.value.some((context) => context.id === cycleId)) return;
      if (employeeId === selectedPersonId.value && cycleId === selectedCycleId.value) return;
      navigationGeneration += 1;
      selectedPersonId.value = employeeId;
      selectedCycleId.value = cycleId;
      await loadTracking(isCurrent);
    },
  );

  onMounted(async () => {
    const isCurrent = captureLifecycle();
    await auth.ensureLoaded();
    if (!isCurrent()) return;
    await normalizeSelectionAndLoad(isCurrent);
  });

  onBeforeUnmount(() => {
    disposed = true;
    lifecycleGeneration += 1;
    navigationGeneration += 1;
    requestSerial += 1;
    contextRequestSerial += 1;
  });

  return {
    contexts, cycles: contexts, peopleGroups, selectedPerson, selectedPersonId, selectedCycleId, selectedContext,
    result, cyclesLoading, cyclesError, loading, error, notice, highlightedObjectiveId,
    selectPerson, selectCycle, retryCycles, retry: loadTracking,
  };
}
