<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import GoalTrackingPeoplePanel from './GoalTrackingPeoplePanel.vue';
import GoalTrackingIndicatorPanel from './GoalTrackingIndicatorPanel.vue';
import GoalTrackingDetailDrawer from './GoalTrackingDetailDrawer.vue';
import { useGoalTracking } from './use-goal-tracking';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const workspace = useGoalTracking();
const selectedIndicatorId = ref(
  typeof route.query.indicatorId === 'string' ? route.query.indicatorId : '',
);
const sections = computed(() => auth.user?.sysRole === 'employee'
  ? (['tracking', 'tasks'] as const)
  : (['tracking', 'map', 'tasks'] as const));

watch(() => route.query.indicatorId, (indicatorId) => {
  selectedIndicatorId.value = typeof indicatorId === 'string' ? indicatorId : '';
});

async function openIndicator(indicatorId: string) {
  await router.push({
    query: { ...route.query, indicatorId },
  });
}

async function closeIndicator() {
  if (typeof route.query.indicatorId !== 'string') return;
  const query = { ...route.query };
  delete query.indicatorId;
  await router.replace({ query });
}
</script>

<template>
  <PerformanceWorkspace title="目标跟进" active-section="tracking" :sections="sections">
    <template #context>
      <GoalTrackingPeoplePanel
        :groups="workspace.peopleGroups.value"
        :selected-id="workspace.selectedPersonId.value"
        @select="workspace.selectPerson"
      />
    </template>
    <div class="goal-tracking-view">
      <GoalTrackingIndicatorPanel
        :person="workspace.selectedPerson.value"
        :cycles="workspace.cycles.value"
        :selected-cycle-id="workspace.selectedCycleId.value"
        :result="workspace.result.value"
        :cycles-loading="workspace.cyclesLoading.value"
        :cycles-error="workspace.cyclesError.value"
        :loading="workspace.loading.value"
        :error="workspace.error.value"
        :notice="workspace.notice.value"
        :highlighted-objective-id="workspace.highlightedObjectiveId.value"
        @cycle-change="workspace.selectCycle"
        @retry-cycles="workspace.retryCycles"
        @retry-indicators="workspace.retry"
        @open-indicator="openIndicator"
      />
      <GoalTrackingDetailDrawer
        :indicator-id="selectedIndicatorId"
        @close="closeIndicator"
        @updated="workspace.retry"
      />
    </div>
  </PerformanceWorkspace>
</template>

<style scoped>
.goal-tracking-view {
  min-height: 100%;
  padding: 16px 22px;
  background: #f4f6fb;
}

@media (max-width: 768px) {
  .goal-tracking-view {
    min-height: auto;
    padding: 10px;
  }
}
</style>
