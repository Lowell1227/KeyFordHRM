<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import GoalTrackingPeoplePanel from './GoalTrackingPeoplePanel.vue';
import GoalTrackingIndicatorPanel from './GoalTrackingIndicatorPanel.vue';
import { useGoalTracking } from './use-goal-tracking';

const auth = useAuthStore();
const workspace = useGoalTracking();
const sections = computed(() => auth.user?.sysRole === 'employee'
  ? (['tracking', 'tasks'] as const)
  : (['tracking', 'map', 'tasks'] as const));
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
