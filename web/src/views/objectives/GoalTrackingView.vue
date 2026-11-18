<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import GoalTrackingPeoplePanel from './GoalTrackingPeoplePanel.vue';
import GoalTrackingCyclePanel from './GoalTrackingCyclePanel.vue';
import GoalTrackingDetailDrawer from './GoalTrackingDetailDrawer.vue';
import { formatGoalTrackingContextLabel, selectTrackingAction } from './goal-tracking';
import { useGoalTracking } from './use-goal-tracking';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const workspace = useGoalTracking();
const action = computed(() => workspace.selectedContext.value
  ? selectTrackingAction(workspace.selectedContext.value)
  : null);
const selectedIndicatorId = ref(
  typeof route.query.indicatorId === 'string' ? route.query.indicatorId : '',
);
const sections = computed(() => {
  return ['tracking', 'map', 'tasks', 'changes'] as const;
});

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

async function openTaskAction() {
  const current = action.value;
  if (!current || !('taskId' in current)) return;
  let stage: 'goal-setting' | 'goal-confirmation' | 'self-eval' | null = null;
  let periodId: string | undefined;
  if (current.kind === 'goal-setting') stage = 'goal-setting';
  else if (current.kind === 'goal-confirmation') stage = 'goal-confirmation';
  else if (current.kind === 'review') {
    stage = 'self-eval';
    periodId = current.periodId;
  }
  if (!stage) return;
  await router.push({
    name: 'TaskDetail',
    params: { id: current.taskId },
    query: { stage, periodId, returnTo: route.fullPath },
  });
}

</script>

<template>
  <PerformanceWorkspace title="目标跟进" active-section="tracking" :sections="sections">
    <template #toolbar>
      <label class="tracking-cycle-filter" for="goal-tracking-cycle">
        <span>考核周期</span>
        <select
          id="goal-tracking-cycle"
          :value="workspace.selectedCycleId.value"
          data-testid="goal-tracking-cycle"
          :disabled="workspace.cyclesLoading.value || !workspace.contexts.value.length"
          @change="workspace.selectCycle(($event.target as HTMLSelectElement).value)"
        >
          <option v-if="!workspace.contexts.value.length" value="">暂无考核周期</option>
          <option v-for="context in workspace.contexts.value" :key="context.id" :value="context.id">
            {{ formatGoalTrackingContextLabel(context) }}
          </option>
        </select>
      </label>
    </template>
    <template #actions>
      <el-button
        v-if="workspace.selectedPersonId.value === auth.user?.id && action && ['goal-setting', 'goal-confirmation', 'review'].includes(action.kind)"
        type="primary"
        data-testid="goal-tracking-primary-action"
        @click="openTaskAction"
      >{{ action.label }}</el-button>
    </template>
    <template #context>
      <GoalTrackingPeoplePanel
        :groups="workspace.peopleGroups.value"
        :selected-id="workspace.selectedPersonId.value"
        @select="workspace.selectPerson"
      />
    </template>
    <div class="goal-tracking-view">
      <GoalTrackingCyclePanel
        :person="workspace.selectedPerson.value"
        :contexts="workspace.contexts.value"
        :selected-context="workspace.selectedContext.value"
        :result="workspace.result.value"
        :is-self="workspace.selectedPersonId.value === auth.user?.id"
        :cycles-loading="workspace.cyclesLoading.value"
        :cycles-error="workspace.cyclesError.value"
        :loading="workspace.loading.value"
        :error="workspace.error.value"
        :notice="workspace.notice.value"
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

.tracking-cycle-filter {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #4d576b;
  font-size: 13px;
  white-space: nowrap;
}

.tracking-cycle-filter select {
  width: min(340px, 48vw);
  height: 36px;
  padding: 0 30px 0 10px;
  border: 1px solid #dce2ec;
  border-radius: 6px;
  background: #fff;
  color: #253047;
  font-size: 13px;
}

.tracking-cycle-filter select:focus-visible {
  outline: 2px solid #5873df;
  outline-offset: 1px;
}

@media (max-width: 768px) {
  .tracking-cycle-filter span { display: none; }
  .tracking-cycle-filter select { width: 190px; }
}

@media (max-width: 768px) {
  .goal-tracking-view {
    min-height: auto;
    padding: 10px;
  }
}
</style>
