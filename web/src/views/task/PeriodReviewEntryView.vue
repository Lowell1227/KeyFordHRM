<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { periodReviewsApi } from '@/api/period-reviews.api';
import type { PeriodReviewDetail } from '@/types/api.types';
import EmployeePeriodReviewWorkspace from './components/EmployeePeriodReviewWorkspace.vue';
import ManagerPeriodReviewWorkspace from './components/ManagerPeriodReviewWorkspace.vue';

const route = useRoute();
const router = useRouter();
const detail = ref<PeriodReviewDetail | null>(null);
const loading = ref(false);
const error = ref('');
let loadSequence = 0;
const periodId = computed(() =>
  typeof route.params.periodId === 'string' ? route.params.periodId : '',
);
const taskId = computed(() =>
  typeof route.params.id === 'string' ? route.params.id : '',
);
const label = computed(() =>
  detail.value?.period.periodType === 'cycle'
    ? '整周期'
    : (detail.value?.period.periodKey ?? ''),
);

async function load() {
  const sequence = ++loadSequence;
  const requestedTask = taskId.value,
    requestedPeriod = periodId.value;
  loading.value = true;
  error.value = '';
  detail.value = null;
  try {
    const next = await periodReviewsApi.findOne(requestedPeriod);
    if (sequence !== loadSequence) return;
    if (
      next.period.id !== requestedPeriod ||
      next.period.taskId !== requestedTask
    ) {
      error.value = '该期间不属于当前绩效任务，请返回工作台重新选择。';
    } else if (!next.permissions.viewerRole) {
      error.value = '评价页面版本尚未匹配，请刷新或联系管理员。';
    } else detail.value = next;
  } catch (cause) {
    if (sequence !== loadSequence) return;
    const failure = cause as {
      message?: string;
      response?: { data?: { message?: string } };
    };
    error.value =
      failure.response?.data?.message ||
      failure.message ||
      '本期评价读取失败，请重试。';
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}
watch([taskId, periodId], load, { immediate: true });
</script>

<template>
  <section class="period-review-entry" v-loading="loading">
    <header
      class="period-review-entry__context"
      data-testid="period-review-entry-context"
    >
      <el-button link @click="router.push('/tasks')">返回绩效工作台</el-button>
      <div v-if="detail">
        <strong>{{ detail.context.cycleName }}</strong
        ><span>{{ detail.context.employeeName }} · {{ label }}</span>
      </div>
    </header>
    <el-alert
      v-if="error"
      data-testid="period-review-entry-error"
      :title="error"
      type="warning"
      :closable="false"
      show-icon
    />
    <template v-else-if="detail && !loading">
      <ManagerPeriodReviewWorkspace
        v-if="detail.permissions.viewerRole === 'manager'"
        :key="periodId"
        :period-id="periodId"
        :task-id="taskId"
        @submitted="load"
        @returned="load"
      />
      <EmployeePeriodReviewWorkspace
        v-else
        :key="periodId"
        :period-id="periodId"
        @submitted="load"
      />
    </template>
  </section>
</template>

<style scoped>
.period-review-entry {
  min-width: 0;
  display: grid;
  gap: 16px;
}
.period-review-entry__context {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
}
.period-review-entry__context > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.period-review-entry__context span {
  color: var(--text-secondary);
  font-size: 13px;
}
@media (max-width: 768px) {
  .period-review-entry__context {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
