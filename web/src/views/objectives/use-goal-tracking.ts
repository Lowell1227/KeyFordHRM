import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { cyclesApi } from '@/api/cycles.api';
import { objectivesApi } from '@/api/objectives.api';
import { useAuthStore } from '@/stores/auth.store';
import type {
  AssessmentCycle,
  GoalTrackingItem,
  GoalTrackingResult,
} from '@/types/api.types';
import { buildTrackingPeople, selectDefaultTrackingCycle } from './goal-tracking';

export function useGoalTracking() {
  const route = useRoute();
  const router = useRouter();
  const auth = useAuthStore();
  const cycles = ref<AssessmentCycle[]>([]);
  const selectedPersonId = ref('');
  const selectedCycleId = ref('');
  const result = ref<GoalTrackingResult>({ totalWeight: 0, items: [] });
  const loading = ref(false);
  const error = ref('');
  const notice = ref('');
  const highlightedObjectiveId = ref('');
  let requestSerial = 0;
  let navigationGeneration = 0;

  const peopleGroups = computed(() => auth.user ? buildTrackingPeople(auth.user) : []);
  const people = computed(() => peopleGroups.value.flatMap((group) => group.people));
  const selectedPerson = computed(() =>
    people.value.find((person) => person.id === selectedPersonId.value) ?? people.value[0] ?? null);

  async function writeQuery(mode: 'push' | 'replace') {
    const navigate = mode === 'push' ? router.push : router.replace;
    await navigate({
      query: {
        employeeId: selectedPersonId.value || undefined,
        cycleId: selectedCycleId.value || undefined,
      },
    });
  }

  async function resolveObjectiveDeepLink(objectiveId: string) {
    const generation = ++navigationGeneration;
    const isCurrent = () => generation === navigationGeneration;
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
    if (
      !objective?.ownerId
      || !objective.cycleId
      || !people.value.some((person) => person.id === objective.ownerId)
      || !cycles.value.some((cycle) => cycle.id === objective.cycleId)
    ) {
      notice.value = '无法定位该目标所属人员和考核周期';
      return false;
    }
    notice.value = '';
    selectedPersonId.value = objective.ownerId;
    selectedCycleId.value = objective.cycleId;
    highlightedObjectiveId.value = objective.id;
    await writeQuery('replace');
    if (!isCurrent()) return true;
    await loadTracking(isCurrent);
    if (!isCurrent()) return true;
    return true;
  }

  async function loadTracking(commitGuard: () => boolean = () => true) {
    if (!selectedPersonId.value || !selectedCycleId.value) return;
    const serial = ++requestSerial;
    const canCommit = () => serial === requestSerial && commitGuard();
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

  async function selectPerson(id: string) {
    navigationGeneration += 1;
    notice.value = '';
    highlightedObjectiveId.value = '';
    selectedPersonId.value = id;
    await writeQuery('push');
    await loadTracking();
  }

  async function selectCycle(id: string) {
    navigationGeneration += 1;
    notice.value = '';
    highlightedObjectiveId.value = '';
    selectedCycleId.value = id;
    await writeQuery('push');
    await loadTracking();
  }

  watch(
    () => [route.query.employeeId, route.query.cycleId] as const,
    async ([employeeId, cycleId]) => {
      if (typeof employeeId !== 'string' || typeof cycleId !== 'string') return;
      if (!people.value.some((person) => person.id === employeeId)) return;
      if (!cycles.value.some((cycle) => cycle.id === cycleId)) return;
      if (employeeId === selectedPersonId.value && cycleId === selectedCycleId.value) return;
      navigationGeneration += 1;
      selectedPersonId.value = employeeId;
      selectedCycleId.value = cycleId;
      await loadTracking();
    },
  );

  onMounted(async () => {
    await auth.ensureLoaded();
    const page = await cyclesApi.findAll({ page: 1, pageSize: 100 });
    cycles.value = page.items;
    const defaultCycle = selectDefaultTrackingCycle(cycles.value);
    const objectiveId = typeof route.query.objectiveId === 'string'
      ? route.query.objectiveId
      : '';
    if (objectiveId && await resolveObjectiveDeepLink(objectiveId)) return;
    selectedPersonId.value = typeof route.query.employeeId === 'string'
      && people.value.some((person) => person.id === route.query.employeeId)
      ? route.query.employeeId
      : auth.user?.id ?? '';
    selectedCycleId.value = typeof route.query.cycleId === 'string'
      && cycles.value.some((cycle) => cycle.id === route.query.cycleId)
      ? route.query.cycleId
      : defaultCycle?.id ?? '';
    await writeQuery('replace');
    await loadTracking();
  });

  onBeforeUnmount(() => {
    navigationGeneration += 1;
    requestSerial += 1;
  });

  return {
    cycles, peopleGroups, selectedPerson, selectedPersonId, selectedCycleId,
    result, loading, error, notice, highlightedObjectiveId,
    selectPerson, selectCycle, retry: loadTracking,
  };
}
