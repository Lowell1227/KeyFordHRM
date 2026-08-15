import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { cyclesApi } from '@/api/cycles.api';
import { objectivesApi } from '@/api/objectives.api';
import { useAuthStore } from '@/stores/auth.store';
import type { AssessmentCycle, GoalTrackingResult } from '@/types/api.types';
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
  let requestSerial = 0;

  const peopleGroups = computed(() => auth.user ? buildTrackingPeople(auth.user) : []);
  const people = computed(() => peopleGroups.value.flatMap((group) => group.people));
  const selectedPerson = computed(() =>
    people.value.find((person) => person.id === selectedPersonId.value) ?? people.value[0] ?? null);

  async function replaceQuery() {
    await router.replace({
      query: {
        employeeId: selectedPersonId.value || undefined,
        cycleId: selectedCycleId.value || undefined,
      },
    });
  }

  async function loadTracking() {
    if (!selectedPersonId.value || !selectedCycleId.value) return;
    const serial = ++requestSerial;
    loading.value = true;
    error.value = '';
    try {
      const next = await objectivesApi.getTracking({
        ownerId: selectedPersonId.value,
        cycleId: selectedCycleId.value,
      });
      if (serial === requestSerial) result.value = next;
    } catch {
      if (serial === requestSerial) error.value = '考核指标加载失败';
    } finally {
      if (serial === requestSerial) loading.value = false;
    }
  }

  async function selectPerson(id: string) {
    selectedPersonId.value = id;
    await replaceQuery();
    await loadTracking();
  }

  async function selectCycle(id: string) {
    selectedCycleId.value = id;
    await replaceQuery();
    await loadTracking();
  }

  onMounted(async () => {
    await auth.ensureLoaded();
    const page = await cyclesApi.findAll({ page: 1, pageSize: 100 });
    cycles.value = page.items;
    const defaultCycle = selectDefaultTrackingCycle(cycles.value);
    selectedPersonId.value = typeof route.query.employeeId === 'string'
      && people.value.some((person) => person.id === route.query.employeeId)
      ? route.query.employeeId
      : auth.user?.id ?? '';
    selectedCycleId.value = typeof route.query.cycleId === 'string'
      && cycles.value.some((cycle) => cycle.id === route.query.cycleId)
      ? route.query.cycleId
      : defaultCycle?.id ?? '';
    await replaceQuery();
    await loadTracking();
  });

  return {
    cycles, peopleGroups, selectedPerson, selectedPersonId, selectedCycleId,
    result, loading, error, selectPerson, selectCycle, retry: loadTracking,
  };
}
