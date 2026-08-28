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
  fixedFrequency.value === 'monthly' ? '固定按月评分' : '按整个周期评分'
));

function updateFrequency(value: ScoringFrequency) {
  emit('update:scoringFrequency', value);
  emit('change', value);
}

function handleFrequencyChange(value: string | number | boolean | undefined) {
  if (value === 'monthly' || value === 'cycle') updateFrequency(value);
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
  <section data-testid="cycle-scoring-settings" class="cycle-scoring-settings" aria-label="评分频率设置">
    <div class="cycle-scoring-settings__heading">
      <strong>评分频率</strong>
      <span>结果审核按整个周期统一进行</span>
    </div>

    <el-radio-group
      v-if="canChooseFrequency"
      :model-value="scoringFrequency"
      @update:model-value="handleFrequencyChange"
    >
      <el-radio-button data-testid="cycle-scoring-monthly" value="monthly">按月度评分</el-radio-button>
      <el-radio-button data-testid="cycle-scoring-cycle" value="cycle">按整个周期评分</el-radio-button>
    </el-radio-group>
    <p v-else class="cycle-scoring-settings__fixed">{{ fixedFrequencyCopy }}</p>

    <div data-testid="cycle-review-frequency" class="cycle-scoring-settings__review">
      结果审核频率：按周期审核（固定）
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

.cycle-scoring-settings__heading span,
.cycle-scoring-settings__review {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.cycle-scoring-settings__fixed {
  margin: 0;
  color: var(--el-color-primary-dark-2);
  font-size: 14px;
  font-weight: 600;
}
</style>
