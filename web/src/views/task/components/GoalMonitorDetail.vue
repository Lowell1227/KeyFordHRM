<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  GOAL_STEP_LABELS,
  goalPlansApi,
  type GoalPlanDetail,
} from '@/api/goal-plans.api';
import IndicatorSnapshot from './IndicatorSnapshot.vue';
import type { IndicatorInstance } from '@/types/api.types';
const route = useRoute(),
  router = useRouter();
const plan = ref<GoalPlanDetail | null>(null),
  loading = ref(false),
  error = ref('');
const instances = computed<IndicatorInstance[]>(
  () =>
    plan.value?.indicatorInstances.map((i) => ({
      ...i,
      taskId: plan.value!.id,
    })) ?? [],
);
let serial = 0;
async function load() {
  const request = ++serial;
  plan.value = null;
  loading.value = true;
  error.value = '';
  try {
    const result = await goalPlansApi.findOne(String(route.params.id));
    if (request === serial) plan.value = result;
  } catch {
    if (request === serial)
      error.value = '目标计划加载失败或无权查看，请返回计划进度重试';
  } finally {
    if (request === serial) loading.value = false;
  }
}
function goBack() {
  const raw = route.query.returnTo;
  const parsed =
    typeof raw === 'string' ? new URL(raw, window.location.origin) : null;
  router.push(
    parsed?.origin === window.location.origin && parsed.pathname === '/tasks'
      ? `${parsed.pathname}${parsed.search}`
      : '/tasks?goalView=monitor',
  );
}
watch(() => route.params.id, load, { immediate: true });
</script>
<template>
  <section
    v-loading="loading"
    class="goal-monitor"
    data-testid="goal-monitor-detail"
  >
    <el-button @click="goBack">返回计划进度</el-button
    ><el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    /><template v-if="plan"
      ><p>
        {{ plan.employeeName }} · {{ plan.deptName }} · {{ plan.cycleName }}
      </p>
      <el-alert
        :title="GOAL_STEP_LABELS[plan.currentStep]"
        type="info"
        :closable="false" />
      <p data-testid="goal-current-handler">
        当前办理人：{{ plan.currentHandlerName || '—' }}
      </p>
      <IndicatorSnapshot
        :instances="instances"
        :can-confirm="false"
        :can-edit="false"
        :can-reject="false"
        :show-operation-history="true"
        :flow-records="plan.flowRecords"
        :task-status="plan.status"
        title="目标计划"
    /></template>
  </section>
</template>
<style scoped>
.goal-monitor {
  min-width: 0;
  overflow-wrap: anywhere;
}
.goal-monitor > p {
  line-height: 1.7;
}
</style>
