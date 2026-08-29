<script setup lang="ts">
import { computed, watch } from 'vue';
import type { CycleType, ScoringFrequency } from '@/types/enums';

const props = defineProps<{
  cycleType: CycleType;
  scoringFrequency: ScoringFrequency;
}>();

const emit = defineEmits<{
  'update:scoringFrequency': [value: ScoringFrequency];
  change: [value: ScoringFrequency];
}>();

const canChooseFrequency = computed(() => (
  props.cycleType === 'quarterly'
  || props.cycleType === 'semiannual'
  || props.cycleType === 'annual'
));

const fixedFrequency = computed<ScoringFrequency>(() => (
  props.cycleType === 'monthly' ? 'monthly' : 'cycle'
));

const fixedFrequencyCopy = computed(() => (
  fixedFrequency.value === 'monthly'
    ? '月度周期固定开启'
    : '该周期只在周期结束统一评分'
));

function updateFrequency(value: ScoringFrequency) {
  emit('update:scoringFrequency', value);
  emit('change', value);
}

function handleMonthlyReviewChange(value: string | number | boolean) {
  if (typeof value === 'boolean') updateFrequency(value ? 'monthly' : 'cycle');
}

watch(
  () => props.cycleType,
  () => {
    if (!canChooseFrequency.value && props.scoringFrequency !== fixedFrequency.value) {
      updateFrequency(fixedFrequency.value);
    }
  },
  { immediate: true },
);
</script>

<template>
  <section data-testid="cycle-scoring-settings" class="cycle-scoring-settings" aria-label="复盘与评分设置">
    <div class="cycle-scoring-settings__heading">
      <strong>复盘与评分</strong>
      <span data-testid="cycle-review-frequency">结果统一按周期审核</span>
    </div>

    <div class="cycle-scoring-settings__control">
      <el-switch
        data-testid="cycle-monthly-review-switch"
        :model-value="scoringFrequency === 'monthly'"
        :disabled="!canChooseFrequency"
        active-text="每月复盘并评分"
        inactive-text="周期结束统一评分"
        @change="handleMonthlyReviewChange"
      />
      <p v-if="!canChooseFrequency" class="cycle-scoring-settings__fixed">{{ fixedFrequencyCopy }}</p>
    </div>
  </section>
</template>

<style scoped>
.cycle-scoring-settings {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.cycle-scoring-settings__heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.cycle-scoring-settings__heading span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.cycle-scoring-settings__control {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.cycle-scoring-settings__fixed {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

@media (max-width: 767px) {
  .cycle-scoring-settings__heading,
  .cycle-scoring-settings__control {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
